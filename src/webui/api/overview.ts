import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';
import { getAllTasks, getDbStats } from '../../db.js';

export function registerOverviewRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/overview', async () => {
    const tasks = getAllTasks();
    const queueState = deps.queue.getState();
    const dbStats = getDbStats();

    return {
      uptime: process.uptime(),
      channels: deps.channels().map((ch) => ({
        name: ch.name,
        connected: ch.isConnected(),
      })),
      groups: {
        total: Object.keys(deps.registeredGroups()).length,
        active: queueState.groups.filter((g) => g.active).length,
      },
      queue: {
        activeCount: queueState.activeCount,
        maxConcurrent: queueState.maxConcurrent,
        waitingCount: queueState.waitingCount,
      },
      tasks: {
        active: tasks.filter((t) => t.status === 'active').length,
        paused: tasks.filter((t) => t.status === 'paused').length,
        completed: tasks.filter((t) => t.status === 'completed').length,
      },
      messages: { total: dbStats.messages || 0 },
      containers: { running: queueState.activeCount },
    };
  });
}
