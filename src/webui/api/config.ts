import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import * as config from '../../config.js';

const GROUPS_DIR = config.GROUPS_DIR;

export function registerConfigRoutes(app: FastifyInstance): void {
  app.get('/api/config', async () => {
    return {
      values: {
        ASSISTANT_NAME: {
          value: config.ASSISTANT_NAME,
          env: 'ASSISTANT_NAME',
          description: 'Bot name used in triggers and message prefixes',
        },
        CONTAINER_IMAGE: {
          value: config.CONTAINER_IMAGE,
          env: 'CONTAINER_IMAGE',
          description: 'Docker image for agent containers',
        },
        CONTAINER_TIMEOUT: {
          value: config.CONTAINER_TIMEOUT,
          env: 'CONTAINER_TIMEOUT',
          description: 'Max container runtime (ms)',
        },
        MAX_CONCURRENT_CONTAINERS: {
          value: config.MAX_CONCURRENT_CONTAINERS,
          env: 'MAX_CONCURRENT_CONTAINERS',
          description: 'Maximum parallel containers',
        },
        IDLE_TIMEOUT: {
          value: config.IDLE_TIMEOUT,
          env: 'IDLE_TIMEOUT',
          description: 'Container idle timeout before stdin close (ms)',
        },
        TIMEZONE: {
          value: config.TIMEZONE,
          env: 'TZ',
          description: 'Timezone for scheduled tasks',
        },
        WEBUI_PORT: {
          value: config.WEBUI_PORT,
          env: 'WEBUI_PORT',
          description: 'WebUI server port',
        },
        WEBUI_HOST: {
          value: config.WEBUI_HOST,
          env: 'WEBUI_HOST',
          description: 'WebUI server bind address',
        },
        TELEGRAM_BOT_TOKEN: {
          value: config.TELEGRAM_BOT_TOKEN ? '***configured***' : '',
          env: 'TELEGRAM_BOT_TOKEN',
          description: 'Telegram bot token',
        },
      },
    };
  });

  // Read a group's CLAUDE.md
  app.get<{ Params: { folder: string } }>(
    '/api/config/groups/:folder/claude-md',
    async (req, reply) => {
      const filePath = path.join(GROUPS_DIR, req.params.folder, 'CLAUDE.md');
      if (!fs.existsSync(filePath)) {
        return { content: '', exists: false };
      }
      return { content: fs.readFileSync(filePath, 'utf-8'), exists: true };
    },
  );

  // Write a group's CLAUDE.md
  app.put<{ Params: { folder: string }; Body: { content: string } }>(
    '/api/config/groups/:folder/claude-md',
    async (req, reply) => {
      const { content } = req.body || {};
      if (content === undefined) return reply.status(400).send({ error: 'content required' });

      const groupDir = path.join(GROUPS_DIR, req.params.folder);
      if (!fs.existsSync(groupDir)) {
        return reply.status(404).send({ error: 'Group folder not found' });
      }

      fs.writeFileSync(path.join(groupDir, 'CLAUDE.md'), content);
      return { ok: true };
    },
  );

  // Read global CLAUDE.md
  app.get('/api/config/global/claude-md', async () => {
    const filePath = path.join(GROUPS_DIR, 'global', 'CLAUDE.md');
    if (!fs.existsSync(filePath)) {
      return { content: '', exists: false };
    }
    return { content: fs.readFileSync(filePath, 'utf-8'), exists: true };
  });

  // Write global CLAUDE.md
  app.put<{ Body: { content: string } }>(
    '/api/config/global/claude-md',
    async (req, reply) => {
      const { content } = req.body || {};
      if (content === undefined) return reply.status(400).send({ error: 'content required' });

      const globalDir = path.join(GROUPS_DIR, 'global');
      fs.mkdirSync(globalDir, { recursive: true });
      fs.writeFileSync(path.join(globalDir, 'CLAUDE.md'), content);
      return { ok: true };
    },
  );
}
