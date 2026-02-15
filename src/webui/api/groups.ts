import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';
import { getAllSessions } from '../../db.js';

export function registerGroupRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/groups', async () => {
    const groups = deps.registeredGroups();
    const sessions = getAllSessions();
    const queueState = deps.queue.getState();
    const activeJids = new Set(queueState.groups.filter((g) => g.active).map((g) => g.jid));

    return Object.entries(groups).map(([jid, group]) => ({
      jid,
      name: group.name,
      folder: group.folder,
      trigger: group.trigger,
      added_at: group.added_at,
      requiresTrigger: group.requiresTrigger,
      containerConfig: group.containerConfig,
      sessionId: sessions[group.folder] || null,
      containerActive: activeJids.has(jid),
    }));
  });

  app.get<{ Params: { folder: string } }>('/api/groups/:folder', async (req, reply) => {
    const { folder } = req.params;
    const groups = deps.registeredGroups();
    const sessions = getAllSessions();
    const queueState = deps.queue.getState();

    for (const [jid, group] of Object.entries(groups)) {
      if (group.folder === folder) {
        const activeGroup = queueState.groups.find((g) => g.jid === jid);
        return {
          jid,
          name: group.name,
          folder: group.folder,
          trigger: group.trigger,
          added_at: group.added_at,
          requiresTrigger: group.requiresTrigger,
          containerConfig: group.containerConfig,
          sessionId: sessions[group.folder] || null,
          containerActive: !!activeGroup?.active,
        };
      }
    }
    return reply.status(404).send({ error: 'Group not found' });
  });
}
