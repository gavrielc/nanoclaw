/**
 * SSH Tunnel Manager — Maintains local port forwards to remote workers.
 *
 * CP→Worker: ssh -NL {local_port}:127.0.0.1:{remote_port} user@host
 * Health checks via HTTP GET through the tunnel.
 */
import { spawn, ChildProcess } from 'child_process';
import http from 'http';

import { WORKER_HEALTH_INTERVAL, WORKER_TUNNEL_RECONNECT_MAX } from './config.js';
import { getWorkerById, updateWorkerStatus } from './worker-db.js';
import type { Worker } from './worker-db.js';
import { logger } from './logger.js';
import { emitOpsEvent } from './ops-events.js';

interface TunnelState {
  workerId: string;
  process: ChildProcess | null;
  status: 'up' | 'down' | 'connecting';
  failCount: number;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

const tunnels = new Map<string, TunnelState>();
let healthInterval: ReturnType<typeof setInterval> | null = null;

export interface TunnelManagerDeps {
  getWorkerById: (id: string) => Worker | undefined;
  updateWorkerStatus: (id: string, status: Worker['status']) => void;
}

/**
 * Start the tunnel manager: creates tunnels for all online workers
 * and begins periodic health checks.
 */
export function startTunnelManager(deps: TunnelManagerDeps): void {
  if (healthInterval) return;

  healthInterval = setInterval(() => {
    for (const [workerId, state] of tunnels) {
      if (state.status === 'up' || state.status === 'connecting') {
        checkTunnelHealth(workerId, deps);
      }
    }
  }, WORKER_HEALTH_INTERVAL);
}

/**
 * Ensure a tunnel exists for the given worker. Spawns SSH if not already up.
 */
export function ensureTunnel(
  workerId: string,
  deps: TunnelManagerDeps,
): void {
  const existing = tunnels.get(workerId);
  if (existing && (existing.status === 'up' || existing.status === 'connecting')) {
    return;
  }

  const worker = deps.getWorkerById(workerId);
  if (!worker) {
    logger.warn({ workerId }, 'ensureTunnel: worker not found');
    return;
  }

  spawnTunnel(worker, deps);
}

function spawnTunnel(worker: Worker, deps: TunnelManagerDeps): void {
  const state: TunnelState = tunnels.get(worker.id) || {
    workerId: worker.id,
    process: null,
    status: 'connecting',
    failCount: 0,
    reconnectAttempts: 0,
    reconnectTimer: null,
  };

  state.status = 'connecting';
  tunnels.set(worker.id, state);

  const args = [
    '-NL',
    `${worker.local_port}:127.0.0.1:${worker.remote_port}`,
    '-p', String(worker.ssh_port),
    `${worker.ssh_user}@${worker.ssh_host}`,
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'BatchMode=yes',
  ];

  if (worker.ssh_identity_file) {
    args.push('-i', worker.ssh_identity_file);
  }

  const proc = spawn('ssh', args, {
    stdio: 'ignore',
    detached: false,
  });

  state.process = proc;

  proc.on('error', (err) => {
    logger.error({ workerId: worker.id, err }, 'SSH tunnel process error');
    state.status = 'down';
    state.process = null;
    scheduleReconnect(worker.id, deps);
  });

  proc.on('exit', (code) => {
    logger.warn({ workerId: worker.id, code }, 'SSH tunnel process exited');
    state.status = 'down';
    state.process = null;
    deps.updateWorkerStatus(worker.id, 'offline');
    emitOpsEvent('tunnel:status', { workerId: worker.id, status: 'down', exitCode: code });
    emitOpsEvent('worker:status', { workerId: worker.id, status: 'offline', reason: 'tunnel_exited' });
    scheduleReconnect(worker.id, deps);
  });

  // After a short delay, check if tunnel is actually forwarding
  setTimeout(() => {
    if (state.status === 'connecting') {
      checkTunnelHealth(worker.id, deps);
    }
  }, 2000);
}

function scheduleReconnect(
  workerId: string,
  deps: TunnelManagerDeps,
): void {
  const state = tunnels.get(workerId);
  if (!state) return;

  state.reconnectAttempts++;
  if (state.reconnectAttempts > WORKER_TUNNEL_RECONNECT_MAX) {
    logger.error(
      { workerId, attempts: state.reconnectAttempts },
      'SSH tunnel max reconnects exceeded, giving up',
    );
    state.status = 'down';
    deps.updateWorkerStatus(workerId, 'offline');
    return;
  }

  // Exponential backoff: 5s, 10s, 20s, 40s, max 60s
  const delay = Math.min(5000 * Math.pow(2, state.reconnectAttempts - 1), 60000);
  logger.info(
    { workerId, attempt: state.reconnectAttempts, delayMs: delay },
    'Scheduling SSH tunnel reconnect',
  );

  state.reconnectTimer = setTimeout(() => {
    const worker = deps.getWorkerById(workerId);
    if (worker) spawnTunnel(worker, deps);
  }, delay);
}

function checkTunnelHealth(
  workerId: string,
  deps: TunnelManagerDeps,
): void {
  const state = tunnels.get(workerId);
  if (!state) return;

  const worker = deps.getWorkerById(workerId);
  if (!worker) return;

  const req = http.get(
    `http://127.0.0.1:${worker.local_port}/worker/health`,
    { timeout: 5000 },
    (res) => {
      if (res.statusCode === 200) {
        const wasDown = state.status !== 'up';
        state.status = 'up';
        state.failCount = 0;
        state.reconnectAttempts = 0;
        deps.updateWorkerStatus(workerId, 'online');
        if (wasDown) {
          emitOpsEvent('tunnel:status', { workerId, status: 'up' });
          emitOpsEvent('worker:status', { workerId, status: 'online' });
        }
      } else {
        handleHealthFailure(workerId, state, deps);
      }
      res.resume();
    },
  );

  req.on('error', () => {
    handleHealthFailure(workerId, state, deps);
  });

  req.on('timeout', () => {
    req.destroy();
    handleHealthFailure(workerId, state, deps);
  });
}

function handleHealthFailure(
  workerId: string,
  state: TunnelState,
  deps: TunnelManagerDeps,
): void {
  state.failCount++;
  if (state.failCount >= 3) {
    logger.warn({ workerId, failCount: state.failCount }, 'SSH tunnel health check failed 3x, killing tunnel');
    closeTunnel(workerId);
    deps.updateWorkerStatus(workerId, 'offline');
    emitOpsEvent('tunnel:status', { workerId, status: 'down', reason: 'health_check_failed', failCount: state.failCount });
    emitOpsEvent('worker:status', { workerId, status: 'offline', reason: 'health_check_failed' });
  }
}

export function closeTunnel(workerId: string): void {
  const state = tunnels.get(workerId);
  if (!state) return;

  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  if (state.process) {
    state.process.kill('SIGTERM');
    state.process = null;
  }

  state.status = 'down';
}

export function isTunnelUp(workerId: string): boolean {
  const state = tunnels.get(workerId);
  return state?.status === 'up';
}

export function shutdownAllTunnels(): void {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }

  for (const [workerId] of tunnels) {
    closeTunnel(workerId);
  }
  tunnels.clear();
}
