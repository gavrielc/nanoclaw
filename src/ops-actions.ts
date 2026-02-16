/**
 * Write action endpoints for the cockpit.
 * Dual-secret auth (X-OS-SECRET + X-WRITE-SECRET), fail-closed.
 * Attached to the same HTTP server as ops-http.ts via routeWriteAction().
 */
import http from 'http';

import {
  getGovApprovals,
  getGovTaskById,
  logGovActivity,
  updateGovTask,
} from './gov-db.js';
import { processGovIpc } from './gov-ipc.js';
import { enforceCockpitLimits } from './limits/enforce.js';
import { logger } from './logger.js';

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'X-OS-SECRET, X-WRITE-SECRET, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(JSON.stringify(body));
}

function authenticateWrite(req: http.IncomingMessage): boolean {
  const readSecret = process.env.OS_HTTP_SECRET || '';
  // Dual-secret rotation: accept CURRENT or PREVIOUS
  const writeCurrent = process.env.COCKPIT_WRITE_SECRET_CURRENT
    || process.env.COCKPIT_WRITE_SECRET || '';
  const writePrevious = process.env.COCKPIT_WRITE_SECRET_PREVIOUS || '';

  if (!readSecret || !writeCurrent) return false; // fail-closed

  if (req.headers['x-os-secret'] !== readSecret) return false;

  const provided = req.headers['x-write-secret'] as string | undefined;
  if (!provided) return false;

  return provided === writeCurrent || (!!writePrevious && provided === writePrevious);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseUrl(url: string): string {
  return new URL(url, 'http://localhost').pathname;
}

// --- Handlers ---

async function handleActionTransition(
  body: Record<string, unknown>,
  res: http.ServerResponse,
): Promise<void> {
  const { taskId, toState, reason, expectedVersion } = body;
  if (!taskId || !toState) {
    json(res, 400, { error: 'Missing required fields: taskId, toState' });
    return;
  }

  const task = getGovTaskById(taskId as string);
  if (!task) {
    json(res, 404, { error: 'Task not found' });
    return;
  }

  const fromState = task.state;
  const prevVersion = task.version;

  await processGovIpc(
    {
      type: 'gov_transition',
      taskId: taskId as string,
      toState: toState as string,
      reason: (reason as string) || undefined,
      expectedVersion: expectedVersion !== undefined ? Number(expectedVersion) : undefined,
    },
    'main',
    true,
  );

  // Verify outcome — processGovIpc doesn't return errors
  const updated = getGovTaskById(taskId as string);
  if (!updated || updated.state !== toState) {
    json(res, 409, {
      error: 'Transition failed',
      current_state: updated?.state || fromState,
      current_version: updated?.version || prevVersion,
    });
    return;
  }

  json(res, 200, {
    ok: true,
    taskId,
    from: fromState,
    to: toState,
    version: updated.version,
  });
}

async function handleActionApprove(
  body: Record<string, unknown>,
  res: http.ServerResponse,
): Promise<void> {
  const { taskId, gate_type, notes } = body;
  if (!taskId || !gate_type) {
    json(res, 400, { error: 'Missing required fields: taskId, gate_type' });
    return;
  }

  const task = getGovTaskById(taskId as string);
  if (!task) {
    json(res, 404, { error: 'Task not found' });
    return;
  }
  if (task.state !== 'APPROVAL') {
    json(res, 409, { error: 'Task not in APPROVAL state', current_state: task.state });
    return;
  }

  const approvalsBefore = getGovApprovals(taskId as string);
  const alreadyApproved = approvalsBefore.some(
    (a) => a.gate_type === gate_type,
  );

  await processGovIpc(
    {
      type: 'gov_approve',
      taskId: taskId as string,
      gate_type: gate_type as string,
      notes: (notes as string) || undefined,
    },
    'main',
    true,
  );

  // Verify approval recorded
  const approvalsAfter = getGovApprovals(taskId as string);
  const wasRecorded = approvalsAfter.some(
    (a) => a.gate_type === gate_type,
  );

  if (!wasRecorded && !alreadyApproved) {
    json(res, 409, { error: 'Approval failed' });
    return;
  }

  json(res, 200, { ok: true, taskId, gate_type });
}

async function handleActionOverride(
  body: Record<string, unknown>,
  res: http.ServerResponse,
): Promise<void> {
  const { taskId, reason, acceptedRisk, reviewDeadlineIso } = body;
  if (!taskId || !reason || !acceptedRisk || !reviewDeadlineIso) {
    json(res, 400, {
      error: 'Missing required fields: taskId, reason, acceptedRisk, reviewDeadlineIso',
    });
    return;
  }

  const task = getGovTaskById(taskId as string);
  if (!task) {
    json(res, 404, { error: 'Task not found' });
    return;
  }

  // Only REVIEW or APPROVAL can be overridden
  if (task.state !== 'REVIEW' && task.state !== 'APPROVAL') {
    json(res, 409, {
      error: 'Override only allowed from REVIEW or APPROVAL state',
      current_state: task.state,
    });
    return;
  }

  const fromState = task.state;
  const now = new Date().toISOString();

  // Merge override into existing metadata
  let existingMeta: Record<string, unknown> = {};
  try {
    if (task.metadata) existingMeta = JSON.parse(task.metadata);
  } catch { /* ignore */ }

  const metadata = JSON.stringify({
    ...existingMeta,
    override: {
      used: true,
      by: 'founder',
      reason,
      acceptedRisk,
      reviewDeadlineIso,
      timestamp: now,
    },
  });

  // Atomic: set state + metadata in one optimistic-locked call
  const updated = updateGovTask(taskId as string, task.version, {
    state: 'DONE',
    metadata,
  });

  if (!updated) {
    json(res, 409, {
      error: 'Version conflict (concurrent update)',
      current_version: task.version,
    });
    return;
  }

  // Log both override and transition activities
  logGovActivity({
    task_id: taskId as string,
    action: 'override',
    from_state: fromState,
    to_state: 'DONE',
    actor: 'founder',
    reason: reason as string,
    created_at: now,
  });
  logGovActivity({
    task_id: taskId as string,
    action: 'transition',
    from_state: fromState,
    to_state: 'DONE',
    actor: 'founder',
    reason: null,
    created_at: now,
  });

  logger.info(
    { taskId, from: fromState, to: 'DONE', override: true },
    'Founder override applied',
  );

  json(res, 200, {
    ok: true,
    taskId,
    from: fromState,
    to: 'DONE',
    override: true,
  });
}

// --- Router ---

export async function routeWriteAction(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const pathname = parseUrl(req.url || '/');

  if (!authenticateWrite(req)) {
    json(res, 401, { error: 'Unauthorized' });
    return;
  }

  // Rate limit cockpit writes
  const sourceIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.socket.remoteAddress || 'unknown';
  const limitResult = enforceCockpitLimits('cockpit_write', sourceIp);
  if (!limitResult.allowed) {
    json(res, 429, { error: 'Rate limit exceeded', detail: limitResult.detail });
    return;
  }

  let body: Record<string, unknown>;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    json(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  switch (pathname) {
    case '/ops/actions/transition':
      return handleActionTransition(body, res);
    case '/ops/actions/approve':
      return handleActionApprove(body, res);
    case '/ops/actions/override':
      return handleActionOverride(body, res);
    default:
      json(res, 404, { error: 'Not found' });
  }
}
