/**
 * Read-only HTTP API for operational visibility.
 * Node.js native http — zero new dependencies.
 * All endpoints require X-OS-SECRET header (fail-closed).
 */
import http from 'http';

import { OPS_HTTP_PORT } from './config.js';
import {
  getAllGovTasks,
  getGovActivities,
  getGovActivitiesForContext,
  getGovApprovals,
  getGovTaskById,
  getGovTaskExecutionSummary,
  getGovTasksByState,
  getProductById,
  listProducts,
} from './gov-db.js';
import { routeWriteAction } from './ops-actions.js';
import { routeWorkerCallback } from './worker-callbacks.js';
import { handleSseConnection, startSseIdleCheck } from './ops-events.js';
import {
  getAllWorkers,
  getWorkerById as getWorkerByIdDb,
} from './worker-db.js';
import { getDispatchesByWorkerId } from './gov-db.js';
import { isTunnelUp } from './worker-tunnels.js';
import { POLICY_VERSION } from './governance/policy-version.js';
import { logger } from './logger.js';
import { searchMemoriesByKeywords } from './memory-db.js';
import { computeEmbedding } from './memory/embedding.js';
import { semanticRecall } from './memory/recall.js';
import {
  countDenials24h,
  getAllBreakers,
  getAllQuotasToday,
  getDenialsByCode24h,
} from './limits-db.js';
import {
  countExtCallsByProvider,
  countTasksByProduct,
  countTasksByState,
  getFailedDispatches,
  getL3CallsLast24h,
  getTopDenials24h,
  getTopEmbeds24h,
  getTopExtCalls24h,
  getTopQuotaUsedToday,
  getWipLoad,
} from './ops-metrics.js';

const startTime = Date.now();

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'X-OS-SECRET, Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  });
  res.end(JSON.stringify(body));
}

function authenticate(req: http.IncomingMessage): boolean {
  const secret = process.env.OS_HTTP_SECRET || '';
  if (!secret) return false; // fail-closed: no secret configured = deny all
  return req.headers['x-os-secret'] === secret;
}

function parseUrl(url: string): { pathname: string; params: URLSearchParams } {
  const parsed = new URL(url, 'http://localhost');
  return { pathname: parsed.pathname, params: parsed.searchParams };
}

function handleHealth(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  json(res, 200, {
    status: 'ok',
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    version: POLICY_VERSION,
  });
}

function handleStats(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  json(res, 200, {
    tasks: {
      by_state: countTasksByState(),
      by_product: countTasksByProduct(),
    },
    ext_calls: {
      by_provider: countExtCallsByProvider(),
      l3_last_24h: getL3CallsLast24h(),
    },
    wip_load: getWipLoad(),
    failed_dispatches: getFailedDispatches(),
    limits: {
      denials_24h: countDenials24h(),
      denials_by_code_24h: getDenialsByCode24h(),
      quotas_today: getAllQuotasToday(),
      breakers: getAllBreakers(),
    },
    top_keys: {
      quota_used_today: getTopQuotaUsedToday(),
      denials_24h: getTopDenials24h(),
      ext_calls_24h: getTopExtCalls24h(),
      embeds_24h: getTopEmbeds24h(),
    },
  });
}

function handleTasks(
  params: URLSearchParams,
  res: http.ServerResponse,
): void {
  let tasks = getAllGovTasks();

  const state = params.get('state');
  if (state) tasks = tasks.filter((t) => t.state === state);

  const type = params.get('type');
  if (type) tasks = tasks.filter((t) => t.task_type === type);

  const productId = params.get('product_id');
  if (productId) tasks = tasks.filter((t) => t.product_id === productId);

  const limit = Math.min(parseInt(params.get('limit') || '50', 10) || 50, 200);
  tasks = tasks.slice(0, limit);

  json(res, 200, tasks);
}

function handleTaskById(
  id: string,
  res: http.ServerResponse,
): void {
  const task = getGovTaskById(id);
  if (!task) {
    json(res, 404, { error: 'Task not found' });
    return;
  }
  json(res, 200, task);
}

function handleTaskActivities(
  id: string,
  res: http.ServerResponse,
): void {
  const task = getGovTaskById(id);
  if (!task) {
    json(res, 404, { error: 'Task not found' });
    return;
  }
  json(res, 200, getGovActivities(id));
}

function handleProducts(
  params: URLSearchParams,
  res: http.ServerResponse,
): void {
  const status = params.get('status') || undefined;
  json(res, 200, listProducts(status));
}

function handleProductById(
  id: string,
  res: http.ServerResponse,
): void {
  const product = getProductById(id);
  if (!product) {
    json(res, 404, { error: 'Product not found' });
    return;
  }
  json(res, 200, product);
}

function handleMemories(
  params: URLSearchParams,
  res: http.ServerResponse,
): void {
  const q = params.get('q');
  if (!q) {
    json(res, 400, { error: 'Missing required query parameter: q' });
    return;
  }

  const keywords = q.split(/\s+/).filter(Boolean);
  if (keywords.length === 0) {
    json(res, 400, { error: 'Query must contain at least one keyword' });
    return;
  }

  try {
    const memories = searchMemoriesByKeywords(keywords, {
      maxLevel: params.get('level') || undefined,
      limit: Math.min(
        parseInt(params.get('limit') || '20', 10) || 20,
        100,
      ),
    });
    // Strip embedding BLOBs from response
    const sanitized = memories.map(
      ({ embedding, ...rest }) => rest,
    );
    json(res, 200, sanitized);
  } catch {
    json(res, 501, { error: 'Memory system not available' });
  }
}

function handleMemorySearch(
  params: URLSearchParams,
  res: http.ServerResponse,
): void {
  const q = params.get('q');
  if (!q) {
    json(res, 400, { error: 'Missing required query parameter: q' });
    return;
  }

  const limit = Math.min(
    parseInt(params.get('limit') || '10', 10) || 10,
    100,
  );
  const scope = params.get('scope') || undefined;
  const productId = params.get('product_id') || null;

  // Async: compute query embedding, then search
  computeEmbedding(q)
    .then((queryEmbedding) => {
      const result = semanticRecall({
        queryEmbedding,
        query: q,
        accessor_group: 'main',
        accessor_is_main: true,
        scope,
        product_id: productId,
        limit,
      });

      // Strip embedding BLOBs from response
      const memories = result.memories.map(
        ({ embedding, ...rest }) => rest,
      );

      json(res, 200, {
        mode: result.mode,
        memories,
        total_considered: result.total_considered,
        access_denials: result.access_denials,
      });
    })
    .catch(() => {
      json(res, 501, { error: 'Memory search not available' });
    });
}

function handleApprovals(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  const tasks = getGovTasksByState('APPROVAL');
  const enriched = tasks.map((t) => ({
    ...t,
    approvals: getGovApprovals(t.id),
    execution_summary: getGovTaskExecutionSummary(t.id),
    recent_activities: getGovActivitiesForContext(t.id, 10),
  }));
  json(res, 200, enriched);
}

function handleTaskApprovals(
  id: string,
  res: http.ServerResponse,
): void {
  const task = getGovTaskById(id);
  if (!task) {
    json(res, 404, { error: 'Task not found' });
    return;
  }
  json(res, 200, getGovApprovals(id));
}

// --- Worker read handlers (sanitized — no secrets) ---

function sanitizeWorker(w: ReturnType<typeof getWorkerByIdDb>) {
  if (!w) return null;
  return {
    id: w.id,
    ssh_host: w.ssh_host,
    ssh_user: w.ssh_user,
    ssh_port: w.ssh_port,
    local_port: w.local_port,
    remote_port: w.remote_port,
    status: w.status,
    max_wip: w.max_wip,
    current_wip: w.current_wip,
    groups_json: w.groups_json,
    callback_url: w.callback_url,
    tunnel_up: isTunnelUp(w.id),
    created_at: w.created_at,
    updated_at: w.updated_at,
    // Omitted: shared_secret, ssh_identity_file
  };
}

function handleWorkers(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  const workers = getAllWorkers().map(sanitizeWorker);
  json(res, 200, workers);
}

function handleWorkerById(
  id: string,
  res: http.ServerResponse,
): void {
  const worker = getWorkerByIdDb(id);
  if (!worker) {
    json(res, 404, { error: 'Worker not found' });
    return;
  }
  json(res, 200, sanitizeWorker(worker));
}

function handleWorkerDispatches(
  id: string,
  params: URLSearchParams,
  res: http.ServerResponse,
): void {
  const worker = getWorkerByIdDb(id);
  if (!worker) {
    json(res, 404, { error: 'Worker not found' });
    return;
  }
  const limit = Math.min(parseInt(params.get('limit') || '20', 10) || 20, 100);
  json(res, 200, getDispatchesByWorkerId(id, limit));
}

function handleWorkerTunnels(
  id: string,
  res: http.ServerResponse,
): void {
  const worker = getWorkerByIdDb(id);
  if (!worker) {
    json(res, 404, { error: 'Worker not found' });
    return;
  }
  json(res, 200, {
    worker_id: id,
    tunnel_up: isTunnelUp(id),
    local_port: worker.local_port,
    remote_port: worker.remote_port,
  });
}

// Route matching: /ops/tasks/:id/activities, /ops/tasks/:id/approvals, /ops/tasks/:id, /ops/products/:id, /ops/workers/:id/*
const TASK_BY_ID = /^\/ops\/tasks\/([^/]+)$/;
const TASK_ACTIVITIES = /^\/ops\/tasks\/([^/]+)\/activities$/;
const TASK_APPROVALS = /^\/ops\/tasks\/([^/]+)\/approvals$/;
const PRODUCT_BY_ID = /^\/ops\/products\/([^/]+)$/;
const WORKER_BY_ID = /^\/ops\/workers\/([^/]+)$/;
const WORKER_DISPATCHES = /^\/ops\/workers\/([^/]+)\/dispatches$/;
const WORKER_TUNNELS = /^\/ops\/workers\/([^/]+)\/tunnels$/;

function route(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  const { pathname, params } = parseUrl(req.url || '/');

  // CORS preflight
  if (req.method === 'OPTIONS') {
    json(res, 204, '');
    return;
  }

  // POST: route worker callbacks vs write actions
  if (req.method === 'POST') {
    if (pathname.startsWith('/ops/worker/')) {
      routeWorkerCallback(req, res);
    } else {
      routeWriteAction(req, res);
    }
    return;
  }

  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  // Auth
  if (!authenticate(req)) {
    json(res, 401, { error: 'Unauthorized' });
    return;
  }

  // SSE endpoint (long-lived, authenticated)
  if (pathname === '/ops/events') {
    handleSseConnection(req, res);
    return;
  }

  // Static routes
  switch (pathname) {
    case '/ops/health':
      return handleHealth(req, res);
    case '/ops/stats':
      return handleStats(req, res);
    case '/ops/tasks':
      return handleTasks(params, res);
    case '/ops/products':
      return handleProducts(params, res);
    case '/ops/approvals':
      return handleApprovals(req, res);
    case '/ops/workers':
      return handleWorkers(req, res);
    case '/ops/memories':
      return handleMemories(params, res);
    case '/ops/memories/search':
      handleMemorySearch(params, res);
      return;
  }

  // Dynamic routes
  let match: RegExpMatchArray | null;

  match = pathname.match(WORKER_DISPATCHES);
  if (match) return handleWorkerDispatches(match[1], params, res);

  match = pathname.match(WORKER_TUNNELS);
  if (match) return handleWorkerTunnels(match[1], res);

  match = pathname.match(WORKER_BY_ID);
  if (match) return handleWorkerById(match[1], res);

  match = pathname.match(TASK_APPROVALS);
  if (match) return handleTaskApprovals(match[1], res);

  match = pathname.match(TASK_ACTIVITIES);
  if (match) return handleTaskActivities(match[1], res);

  match = pathname.match(TASK_BY_ID);
  if (match) return handleTaskById(match[1], res);

  match = pathname.match(PRODUCT_BY_ID);
  if (match) return handleProductById(match[1], res);

  json(res, 404, { error: 'Not found' });
}

/**
 * Start the ops HTTP server. Returns the server instance for shutdown.
 * Pass port=0 in tests to get a random available port.
 */
export function startOpsHttp(port?: number): http.Server {
  const listenPort = port ?? OPS_HTTP_PORT;
  const server = http.createServer(route);

  startSseIdleCheck();

  server.listen(listenPort, () => {
    logger.info({ port: listenPort }, 'Ops HTTP server started');
  });

  return server;
}
