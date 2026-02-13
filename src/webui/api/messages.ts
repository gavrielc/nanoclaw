import type { FastifyInstance } from 'fastify';
import { getMessagesForGroup } from '../../db.js';

export function registerMessageRoutes(app: FastifyInstance): void {
  app.get<{
    Querystring: { group: string; limit?: string; before?: string };
  }>('/api/messages', async (req, reply) => {
    const { group, limit: limitStr, before } = req.query;
    if (!group) {
      return reply.status(400).send({ error: 'group query parameter required' });
    }

    const limit = Math.min(parseInt(limitStr || '50', 10) || 50, 200);
    const messages = getMessagesForGroup(group, limit + 1, before);
    const hasMore = messages.length > limit;
    if (hasMore) messages.pop();

    // Return in chronological order (query returns DESC)
    messages.reverse();

    return { messages, hasMore };
  });
}
