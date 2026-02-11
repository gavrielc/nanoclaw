/**
 * Lightweight HTTP API for NanoClaw.
 * External systems (voice plugin, webhooks, etc.) submit messages here
 * and receive structured responses (text + actions).
 */
import http from 'node:http';
import fs from 'fs';

import { API_PORT, ENV_FILE_PATH } from './config.js';
import { logger } from './logger.js';

export interface ApiResponse {
  text: string;
  actions: unknown[];
}

export type ProcessMessageFn = (
  text: string,
  channel: string,
  context: Record<string, unknown>,
) => Promise<ApiResponse>;

let server: http.Server | null = null;

const MAX_BODY_SIZE = 64 * 1024; // 64KB

function loadApiToken(): string | null {
  try {
    const content = fs.readFileSync(ENV_FILE_PATH, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('NANOCLAW_API_TOKEN=')) {
        return trimmed.slice('NANOCLAW_API_TOKEN='.length).trim();
      }
    }
  } catch {
    // env file may not exist yet
  }
  return null;
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

export function startApiServer(processMessage: ProcessMessageFn): void {
  const apiToken = loadApiToken();
  if (!apiToken) {
    logger.warn(
      'NANOCLAW_API_TOKEN not set in env file — API requests will be rejected',
    );
  }

  server = http.createServer(async (req, res) => {
    const url = new URL(
      req.url || '/',
      `http://${req.headers.host || 'localhost'}`,
    );

    // GET /api/health
    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, {
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // POST /api/message
    if (req.method === 'POST' && url.pathname === '/api/message') {
      // Auth check
      if (!apiToken) {
        sendJson(res, 503, { error: 'API token not configured' });
        return;
      }

      const authHeader = req.headers.authorization;
      if (
        !authHeader ||
        !authHeader.startsWith('Bearer ') ||
        authHeader.slice(7) !== apiToken
      ) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }

      // Parse body
      let body: {
        text?: string;
        channel?: string;
        context?: Record<string, unknown>;
        async?: boolean;
      };
      try {
        const raw = await readBody(req);
        body = JSON.parse(raw);
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }

      if (!body.text || typeof body.text !== 'string') {
        sendJson(res, 400, { error: 'Missing required field: text' });
        return;
      }

      const text = body.text;
      const channel = body.channel || 'api';
      const context = body.context || {};

      // Async mode: return ACK immediately, process in background
      if (body.async) {
        logger.info(
          { channel, textLength: text.length },
          'API message received (async)',
        );
        sendJson(res, 202, { status: 'accepted' });
        processMessage(text, channel, context).catch((err) =>
          logger.error({ err }, 'Async API message processing failed'),
        );
        return;
      }

      // Sync mode: wait for agent response
      logger.info(
        { channel, textLength: text.length },
        'API message received (sync)',
      );
      try {
        const response = await processMessage(text, channel, context);
        sendJson(res, 200, response);
      } catch (err) {
        logger.error({ err }, 'API message processing failed');
        sendJson(res, 500, { error: 'Processing failed' });
      }
      return;
    }

    // Not found
    sendJson(res, 404, { error: 'Not found' });
  });

  server.listen(API_PORT, () => {
    logger.info({ port: API_PORT }, 'HTTP API server started');
  });
}

export function stopApiServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => {
      logger.info('HTTP API server stopped');
      resolve();
    });
  });
}
