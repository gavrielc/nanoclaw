import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';
import { getDbStats } from '../../db.js';
import * as config from '../../config.js';

export function registerDebugRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/debug', async () => {
    return {
      queue: deps.queue.getState(),
      db: getDbStats(),
      env: {
        ASSISTANT_NAME: config.ASSISTANT_NAME,
        CONTAINER_IMAGE: config.CONTAINER_IMAGE,
        CONTAINER_TIMEOUT: String(config.CONTAINER_TIMEOUT),
        MAX_CONCURRENT_CONTAINERS: String(config.MAX_CONCURRENT_CONTAINERS),
        IDLE_TIMEOUT: String(config.IDLE_TIMEOUT),
        TIMEZONE: config.TIMEZONE,
        NODE_ENV: process.env.NODE_ENV,
        LOG_LEVEL: process.env.LOG_LEVEL,
      },
      process: {
        pid: process.pid,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        nodeVersion: process.version,
      },
    };
  });
}
