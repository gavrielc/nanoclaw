/**
 * Worker Callbacks — CP-side handler for worker callback POSTs.
 *
 * Routes:
 * - POST /ops/worker/ipc        — Forward IPC from worker container to CP handlers
 * - POST /ops/worker/completion  — Task completed on worker, decrement WIP
 */
import http from 'http';

import { verifyWorkerRequest } from './worker-auth.js';
import { getWorkerById, isNonceUsed, recordNonce, updateWorkerWip, cleanupExpiredNonces } from './worker-db.js';
import { processGovIpc } from './gov-ipc.js';
import { processExtAccessIpc } from './ext-broker.js';
import { updateDispatchStatus } from './gov-db.js';
import { logger } from './logger.js';

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function authenticateWorker(
  headers: http.IncomingHttpHeaders,
  body: string,
): { ok: boolean; error?: string; workerId?: string } {
  const workerId = headers['x-worker-id'] as string | undefined;
  if (!workerId) {
    return { ok: false, error: 'MISSING_WORKER_ID' };
  }

  const worker = getWorkerById(workerId);
  if (!worker) {
    return { ok: false, error: 'UNKNOWN_WORKER' };
  }

  const h: Record<string, string | undefined> = {};
  for (const key of ['x-worker-hmac', 'x-worker-timestamp', 'x-worker-requestid']) {
    h[key] = headers[key] as string | undefined;
  }

  const result = verifyWorkerRequest(h, body, worker.shared_secret, isNonceUsed, recordNonce);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, workerId };
}

async function handleWorkerIpc(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await readBody(req);
  const auth = authenticateWorker(req.headers, body);
  if (!auth.ok) {
    json(res, 401, { error: auth.error });
    return;
  }

  const groupFolder = req.headers['x-worker-groupfolder'] as string;
  if (!groupFolder) {
    json(res, 400, { error: 'Missing X-Worker-GroupFolder header' });
    return;
  }

  let data: { type: string; [key: string]: unknown };
  try {
    data = JSON.parse(body);
  } catch {
    json(res, 400, { error: 'Invalid JSON' });
    return;
  }

  const isMain = groupFolder === 'main';

  // Route to appropriate handler based on IPC type
  try {
    if (data.type?.startsWith('ext_')) {
      await processExtAccessIpc(data as any, groupFolder, isMain);
    } else {
      await processGovIpc(data as any, groupFolder, isMain);
    }
    json(res, 200, { ok: true });
  } catch (err) {
    logger.error({ err, type: data.type }, 'Worker IPC callback processing error');
    json(res, 500, { error: 'Processing failed' });
  }
}

async function handleWorkerCompletion(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await readBody(req);
  const auth = authenticateWorker(req.headers, body);
  if (!auth.ok) {
    json(res, 401, { error: auth.error });
    return;
  }

  let data: { taskId: string; groupFolder: string; status: string; dispatchKey?: string };
  try {
    data = JSON.parse(body);
  } catch {
    json(res, 400, { error: 'Invalid JSON' });
    return;
  }

  // Decrement worker WIP
  if (auth.workerId) {
    updateWorkerWip(auth.workerId, -1);
  }

  // Update dispatch status if key provided
  if (data.dispatchKey) {
    updateDispatchStatus(data.dispatchKey, data.status === 'completed' ? 'DONE' : 'FAILED');
  }

  logger.info(
    { taskId: data.taskId, workerId: auth.workerId, status: data.status },
    'Worker task completion callback received',
  );

  // Periodic nonce cleanup
  cleanupExpiredNonces();

  json(res, 200, { ok: true });
}

/**
 * Route worker callback requests. Called from ops-http.ts for /ops/worker/* paths.
 */
export function routeWorkerCallback(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = url.pathname;

  if (pathname === '/ops/worker/ipc') {
    handleWorkerIpc(req, res).catch((err) => {
      logger.error({ err }, 'Worker IPC callback error');
      if (!res.headersSent) json(res, 500, { error: 'Internal error' });
    });
    return;
  }

  if (pathname === '/ops/worker/completion') {
    handleWorkerCompletion(req, res).catch((err) => {
      logger.error({ err }, 'Worker completion callback error');
      if (!res.headersSent) json(res, 500, { error: 'Internal error' });
    });
    return;
  }

  json(res, 404, { error: 'Unknown worker callback route' });
}
