import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';
import { getAllSessions, deleteSession } from '../../db.js';

export function registerSessionRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/sessions', async () => {
    const sessions = getAllSessions();
    const groups = deps.registeredGroups();

    return Object.entries(sessions).map(([folder, sessionId]) => {
      const group = Object.values(groups).find((g) => g.folder === folder);
      return {
        groupFolder: folder,
        sessionId,
        groupName: group?.name || folder,
      };
    });
  });

  app.delete<{ Params: { folder: string } }>('/api/sessions/:folder', async (req) => {
    deleteSession(req.params.folder);
    return { ok: true };
  });
}
