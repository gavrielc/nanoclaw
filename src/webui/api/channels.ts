import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';

export function registerChannelRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/channels', async () => {
    return deps.channels().map((ch) => ({
      name: ch.name,
      connected: ch.isConnected(),
      type: ch.name.toLowerCase().includes('telegram') ? 'telegram' : 'whatsapp',
    }));
  });
}
