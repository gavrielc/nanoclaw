import type { FastifyInstance } from 'fastify';
import { logBuffer } from '../../logger.js';

const LEVEL_MAP: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export function registerLogRoutes(app: FastifyInstance): void {
  app.get<{
    Querystring: { level?: string; limit?: string; search?: string };
  }>('/api/logs', async (req) => {
    const { level, limit: limitStr, search } = req.query;
    const levelNum = level ? LEVEL_MAP[level] : undefined;
    const limit = Math.min(parseInt(limitStr || '500', 10) || 500, 2000);

    let entries = logBuffer.getEntries(levelNum, limit);

    if (search) {
      const lower = search.toLowerCase();
      entries = entries.filter((e) => e.msg.toLowerCase().includes(lower));
    }

    return { entries, total: logBuffer.size };
  });
}
