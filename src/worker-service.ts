/**
 * Worker Service — HTTP server on 127.0.0.1 only.
 *
 * Routes:
 * - GET  /worker/health           — unauthenticated health check
 * - POST /worker/dispatch         — HMAC auth, receive task + run container
 * - POST /worker/callback/response — HMAC auth, receive ext_call response from CP
 */
import http from 'http';
import fs from 'fs';
import path from 'path';

import { WORKER_PORT, NONCE_CLEANUP_OLDER_THAN_MS, NONCE_CAP, NONCE_CLEANUP_INTERVAL_MS } from './config.js';
import { verifyWorkerRequest } from './worker-auth.js';
import { isNonceUsed, recordNonce, cleanupOldNonces, capNonces, createWorkersSchema } from './worker-db.js';
import { logger } from './logger.js';

const startTime = Date.now();
let activeTasks = 0;

/** Read shared secret at call time so tests can set env after import */
function getSharedSecret(): string {
  return process.env.WORKER_SHARED_SECRET || '';
}
function getCallbackUrl(): string {
  return process.env.WORKER_CP_CALLBACK_URL || '';
}

export interface WorkerServiceDeps {
  /** Run a container for a dispatched task. Returns when container completes. */
  runTask: (payload: DispatchPayload) => Promise<void>;
}

export interface DispatchPayload {
  taskId: string;
  groupFolder: string;
  prompt: string;
  sessionId?: string;
  isMain: boolean;
  ipcSecret: string;
  govSnapshot?: unknown;
  extSnapshot?: unknown;
}

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

function verifyAuth(
  headers: http.IncomingHttpHeaders,
  body: string,
): { ok: boolean; error?: string } {
  const secret = getSharedSecret();
  if (!secret) return { ok: false, error: 'NO_SECRET_CONFIGURED' };

  const h: Record<string, string | undefined> = {};
  for (const key of ['x-worker-hmac', 'x-worker-timestamp', 'x-worker-requestid']) {
    h[key] = headers[key] as string | undefined;
  }

  return verifyWorkerRequest(h, body, secret, isNonceUsed, recordNonce);
}

function handleHealth(_req: http.IncomingMessage, res: http.ServerResponse): void {
  json(res, 200, {
    status: 'ok',
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    active_tasks: activeTasks,
  });
}

async function handleDispatch(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: WorkerServiceDeps,
): Promise<void> {
  const body = await readBody(req);
  const auth = verifyAuth(req.headers, body);
  if (!auth.ok) {
    json(res, 401, { error: auth.error });
    return;
  }

  let payload: DispatchPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    json(res, 400, { error: 'Invalid JSON' });
    return;
  }

  // Respond immediately — task runs async
  json(res, 200, { ok: true, status: 'accepted' });

  activeTasks++;
  try {
    await deps.runTask(payload);
  } catch (err) {
    logger.error({ taskId: payload.taskId, err }, 'Worker task execution failed');
  } finally {
    activeTasks--;
  }

  // Notify CP of completion
  const callbackUrl = getCallbackUrl();
  if (callbackUrl) {
    try {
      const { makeWorkerHeaders } = await import('./worker-auth.js');
      const completionBody = JSON.stringify({
        taskId: payload.taskId,
        groupFolder: payload.groupFolder,
        status: 'completed',
      });
      const headers = makeWorkerHeaders(completionBody, getSharedSecret());
      const url = new URL('/ops/worker/completion', callbackUrl);

      const completionReq = http.request(url, {
        method: 'POST',
        headers,
      });
      completionReq.on('error', (err) => {
        logger.warn({ err }, 'Failed to notify CP of task completion');
      });
      completionReq.end(completionBody);
    } catch (err) {
      logger.warn({ err }, 'Failed to send completion callback');
    }
  }

  // Cleanup nonces after each dispatch
  runNonceCleanup();
}

async function handleCallbackResponse(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await readBody(req);
  const auth = verifyAuth(req.headers, body);
  if (!auth.ok) {
    json(res, 401, { error: auth.error });
    return;
  }

  let data: { groupFolder: string; requestId: string; response: unknown };
  try {
    data = JSON.parse(body);
  } catch {
    json(res, 400, { error: 'Invalid JSON' });
    return;
  }

  // Write response to local IPC directory (atomic tmp+rename)
  const dir = path.join('data', 'ipc', data.groupFolder, 'responses');
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `${data.requestId}.json.tmp`);
  const finalPath = path.join(dir, `${data.requestId}.json`);
  fs.writeFileSync(tempPath, JSON.stringify(data.response, null, 2));
  fs.renameSync(tempPath, finalPath);

  json(res, 200, { ok: true });
}

function route(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: WorkerServiceDeps,
): void {
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/worker/health') {
    return handleHealth(req, res);
  }

  if (req.method === 'POST' && pathname === '/worker/dispatch') {
    handleDispatch(req, res, deps).catch((err) => {
      logger.error({ err }, 'Worker dispatch handler error');
      if (!res.headersSent) json(res, 500, { error: 'Internal error' });
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/worker/callback/response') {
    handleCallbackResponse(req, res).catch((err) => {
      logger.error({ err }, 'Worker callback handler error');
      if (!res.headersSent) json(res, 500, { error: 'Internal error' });
    });
    return;
  }

  json(res, 404, { error: 'Not found' });
}

/**
 * Run nonce cleanup: delete old entries + enforce cap.
 */
export function runNonceCleanup(): void {
  const deleted = cleanupOldNonces(NONCE_CLEANUP_OLDER_THAN_MS);
  const capped = capNonces(NONCE_CAP);
  if (deleted > 0 || capped > 0) {
    logger.info({ deleted, capped }, 'Nonce cleanup completed');
  }
}

let nonceCleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the worker HTTP server. Binds to 127.0.0.1 ONLY.
 * Returns the server instance for shutdown.
 */
export function startWorkerService(
  deps: WorkerServiceDeps,
  port?: number,
): http.Server {
  const listenPort = port ?? WORKER_PORT;
  const server = http.createServer((req, res) => route(req, res, deps));

  // Nonce cleanup: run at startup + every NONCE_CLEANUP_INTERVAL_MS (default 6h)
  runNonceCleanup();
  if (nonceCleanupInterval) clearInterval(nonceCleanupInterval);
  nonceCleanupInterval = setInterval(runNonceCleanup, NONCE_CLEANUP_INTERVAL_MS);

  server.listen(listenPort, '127.0.0.1', () => {
    logger.info({ port: listenPort }, 'Worker service started on 127.0.0.1');
  });

  return server;
}
