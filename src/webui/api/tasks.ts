import type { FastifyInstance } from 'fastify';
import { getAllTasks, getTaskById, getTaskRunLogs, updateTask, deleteTask } from '../../db.js';

export function registerTaskRoutes(app: FastifyInstance): void {
  app.get('/api/tasks', async () => {
    const tasks = getAllTasks();
    return tasks.map((t) => ({
      ...t,
      recentRuns: getTaskRunLogs(t.id, 5),
    }));
  });

  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const task = getTaskById(req.params.id);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    return {
      ...task,
      recentRuns: getTaskRunLogs(task.id, 20),
    };
  });

  app.post<{ Params: { id: string } }>('/api/tasks/:id/pause', async (req, reply) => {
    const task = getTaskById(req.params.id);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    updateTask(req.params.id, { status: 'paused' });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/tasks/:id/resume', async (req, reply) => {
    const task = getTaskById(req.params.id);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    updateTask(req.params.id, { status: 'active' });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const task = getTaskById(req.params.id);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    deleteTask(req.params.id);
    return { ok: true };
  });
}
