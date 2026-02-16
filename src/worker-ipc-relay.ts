/**
 * Worker IPC Relay — Watches local IPC files and forwards to CP via HTTP.
 *
 * When the container writes a task IPC file (e.g., gov_transition, ext_call),
 * this relay reads it, POSTs to the CP callback URL, writes the response
 * back to the local IPC responses directory, and deletes the original file.
 */
import fs from 'fs';
import http from 'http';
import path from 'path';

import { makeWorkerHeaders } from './worker-auth.js';
import { logger } from './logger.js';

export interface IpcRelayDeps {
  callbackUrl: string;
  sharedSecret: string;
  workerId: string;
}

/**
 * Start watching a group's IPC tasks directory for new files.
 * Returns a stop function to cease watching.
 */
export function startIpcRelay(
  groupFolder: string,
  deps: IpcRelayDeps,
): () => void {
  const tasksDir = path.join('data', 'ipc', groupFolder, 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });

  let stopped = false;
  const processed = new Set<string>();

  const poll = async () => {
    if (stopped) return;

    try {
      const files = fs.readdirSync(tasksDir).filter(
        (f) => f.endsWith('.json') && !processed.has(f),
      );

      for (const file of files) {
        if (stopped) break;
        processed.add(file);

        const filePath = path.join(tasksDir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const data = JSON.parse(content);

          // Forward to CP
          const result = await forwardToCP(data, groupFolder, deps);

          // Write response if provided
          if (result && data.request_id) {
            const respDir = path.join('data', 'ipc', groupFolder, 'responses');
            fs.mkdirSync(respDir, { recursive: true });
            const tempPath = path.join(respDir, `${data.request_id}.json.tmp`);
            const finalPath = path.join(respDir, `${data.request_id}.json`);
            fs.writeFileSync(tempPath, JSON.stringify(result, null, 2));
            fs.renameSync(tempPath, finalPath);
          }

          // Delete processed file
          fs.unlinkSync(filePath);
        } catch (err) {
          logger.warn({ file, err }, 'IPC relay: failed to process file');
        }
      }
    } catch (err) {
      if (!stopped) {
        logger.debug({ err }, 'IPC relay: error reading tasks dir');
      }
    }

    if (!stopped) {
      setTimeout(poll, 1000);
    }
  };

  poll();

  return () => {
    stopped = true;
  };
}

function forwardToCP(
  data: unknown,
  groupFolder: string,
  deps: IpcRelayDeps,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const headers = makeWorkerHeaders(body, deps.sharedSecret, deps.workerId);
    headers['X-Worker-GroupFolder'] = groupFolder;

    const url = new URL('/ops/worker/ipc', deps.callbackUrl);

    const req = http.request(url, {
      method: 'POST',
      headers,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const responseBody = Buffer.concat(chunks).toString();
          const parsed = JSON.parse(responseBody);
          resolve(parsed);
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', (err) => {
      logger.warn({ err }, 'IPC relay: failed to forward to CP');
      reject(err);
    });

    req.end(body);
  });
}
