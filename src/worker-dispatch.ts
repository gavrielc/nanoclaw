/**
 * Worker Dispatch — CP-side remote dispatch logic.
 *
 * selectWorker(): round-robin among online workers with capacity
 * dispatchToWorker(): POST to worker via tunnel, increment WIP
 */
import http from 'http';

import { getOnlineWorkers, getWorkerById, updateWorkerWip, workerServesGroup } from './worker-db.js';
import type { Worker } from './worker-db.js';
import { makeWorkerHeaders } from './worker-auth.js';
import { isTunnelUp } from './worker-tunnels.js';
import { logger } from './logger.js';

let rrIndex = 0;

export interface DispatchResult {
  ok: boolean;
  status: 'dispatched' | 'tunnel_down' | 'http_error' | 'no_capacity';
  error?: string;
}

/**
 * Select a worker with capacity via round-robin.
 * Deny-by-default: worker must have the group in its groups_json.
 * Returns null if no suitable worker is available.
 */
export function selectWorker(group?: string): Worker | null {
  const workers = getOnlineWorkers();
  if (workers.length === 0) return null;

  // Round-robin starting from last index
  for (let i = 0; i < workers.length; i++) {
    const idx = (rrIndex + i) % workers.length;
    const w = workers[idx];
    if (w.current_wip >= w.max_wip) continue;
    // Deny-by-default: skip workers that don't serve this group
    if (group && !workerServesGroup(w, group)) continue;
    rrIndex = (idx + 1) % workers.length;
    return w;
  }

  return null;
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

/**
 * Dispatch a task to a remote worker via its SSH tunnel.
 */
export async function dispatchToWorker(
  workerId: string,
  payload: DispatchPayload,
): Promise<DispatchResult> {
  const worker = getWorkerById(workerId);
  if (!worker) {
    return { ok: false, status: 'http_error', error: 'Worker not found' };
  }

  if (!isTunnelUp(workerId)) {
    return { ok: false, status: 'tunnel_down' };
  }

  try {
    const result = await postToWorker(worker, payload);
    if (result.ok) {
      updateWorkerWip(workerId, 1);
    }
    return result;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ workerId, err }, 'dispatchToWorker HTTP error');
    return { ok: false, status: 'http_error', error: errMsg };
  }
}

function postToWorker(
  worker: Worker,
  payload: DispatchPayload,
): Promise<DispatchResult> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const headers = makeWorkerHeaders(body, worker.shared_secret);

    const req = http.request({
      hostname: '127.0.0.1',
      port: worker.local_port,
      path: '/worker/dispatch',
      method: 'POST',
      headers,
      timeout: 10000,
    }, (res) => {
      res.resume();
      if (res.statusCode === 200) {
        resolve({ ok: true, status: 'dispatched' });
      } else {
        resolve({
          ok: false,
          status: 'http_error',
          error: `Worker returned ${res.statusCode}`,
        });
      }
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end(body);
  });
}
