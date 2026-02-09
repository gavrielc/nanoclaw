/**
 * Agent module - runs Claude Agent SDK directly (no containers).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '@anthropic-ai/claude-agent-sdk';

import { DATA_DIR } from './config.js';
import { logger } from './logger.js';

export interface AgentResult {
  status: 'success' | 'error';
  result: string | null;
  sessionId?: string;
  error?: string;
}

/**
 * Run the Claude agent directly via the SDK.
 * Returns results as they stream in via onResult callback.
 */
export async function runAgent(
  prompt: string,
  chatJid: string,
  options?: {
    sessionId?: string;
    isScheduledTask?: boolean;
    onResult?: (result: AgentResult) => Promise<void>;
  },
): Promise<AgentResult> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const mcpServerPath = path.join(__dirname, 'mcp-server.js');

  const ipcDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(path.join(ipcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(ipcDir, 'tasks'), { recursive: true });

  const fullPrompt = options?.isScheduledTask
    ? `[SCHEDULED TASK - This message was sent automatically, not directly from the user.]\n\n${prompt}`
    : prompt;

  let sessionId: string | undefined;
  let lastResult: string | null = null;

  try {
    for await (const message of query({
      prompt: fullPrompt,
      options: {
        cwd: process.cwd(),
        resume: options?.sessionId,
        allowedTools: [
          'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
          'WebSearch', 'WebFetch',
          'Task', 'TaskOutput', 'TaskStop',
          'TodoWrite', 'NotebookEdit',
          'mcp__nanoclaw__*',
        ],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        mcpServers: {
          nanoclaw: {
            command: 'node',
            args: [mcpServerPath],
            env: {
              NANOCLAW_CHAT_JID: chatJid,
              NANOCLAW_IPC_DIR: ipcDir,
            },
          },
        },
      },
    })) {
      if (message.type === 'system' && message.subtype === 'init') {
        sessionId = message.session_id;
        logger.debug({ sessionId }, 'Agent session initialized');
      }

      if (message.type === 'result') {
        const textResult = 'result' in message ? (message as { result?: string }).result ?? null : null;
        lastResult = textResult;
        logger.debug({ hasResult: !!textResult }, 'Agent result received');

        if (options?.onResult) {
          await options.onResult({
            status: 'success',
            result: textResult,
            sessionId,
          });
        }
      }
    }

    return { status: 'success', result: lastResult, sessionId };
  } catch (err) {
    logger.error({ err }, 'Agent query error');
    return {
      status: 'error',
      result: null,
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
