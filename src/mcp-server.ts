/**
 * Stdio MCP Server for NanoClaw
 * Provides tools for sending messages and managing scheduled tasks.
 * Runs as a subprocess spawned by the Claude Agent SDK.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { CronExpressionParser } from 'cron-parser';

const ipcDir = process.env.NANOCLAW_IPC_DIR!;
const chatJid = process.env.NANOCLAW_CHAT_JID!;

const MESSAGES_DIR = path.join(ipcDir, 'messages');
const TASKS_DIR = path.join(ipcDir, 'tasks');

function writeIpcFile(dir: string, data: object): string {
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);
  const tempPath = `${filepath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filepath);
  return filename;
}

const server = new McpServer({
  name: 'nanoclaw',
  version: '1.0.0',
});

server.tool(
  'send_message',
  "Send a message to the user or group immediately while you're still running. Use this for progress updates or to send multiple messages. Note: when running as a scheduled task, your final output is NOT sent to the user — use this tool if you need to communicate.",
  { text: z.string().describe('The message text to send') },
  async (args) => {
    writeIpcFile(MESSAGES_DIR, {
      type: 'message',
      chatJid,
      text: args.text,
      timestamp: new Date().toISOString(),
    });
    return { content: [{ type: 'text' as const, text: 'Message sent.' }] };
  },
);

server.tool(
  'schedule_task',
  `Schedule a recurring or one-time task. The task will run as a full agent with access to all tools.

CONTEXT MODE:
\u2022 "chat": Task runs with access to the chat's conversation session. Use for tasks needing context.
\u2022 "isolated": Task runs in a fresh session. Include all context in the prompt.

SCHEDULE VALUE FORMAT (all times are LOCAL timezone):
\u2022 cron: Standard cron expression (e.g., "0 9 * * *" for daily at 9am)
\u2022 interval: Milliseconds between runs (e.g., "3600000" for 1 hour)
\u2022 once: Local time WITHOUT "Z" suffix (e.g., "2026-02-01T15:30:00")`,
  {
    prompt: z.string().describe('What the agent should do when the task runs'),
    schedule_type: z.enum(['cron', 'interval', 'once']),
    schedule_value: z.string(),
    context_mode: z.enum(['chat', 'isolated']).default('isolated'),
  },
  async (args) => {
    if (args.schedule_type === 'cron') {
      try {
        CronExpressionParser.parse(args.schedule_value);
      } catch {
        return {
          content: [{ type: 'text' as const, text: `Invalid cron: "${args.schedule_value}".` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'interval') {
      const ms = parseInt(args.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        return {
          content: [{ type: 'text' as const, text: `Invalid interval: "${args.schedule_value}".` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'once') {
      const date = new Date(args.schedule_value);
      if (isNaN(date.getTime())) {
        return {
          content: [{ type: 'text' as const, text: `Invalid timestamp: "${args.schedule_value}".` }],
          isError: true,
        };
      }
    }

    writeIpcFile(TASKS_DIR, {
      type: 'schedule_task',
      prompt: args.prompt,
      schedule_type: args.schedule_type,
      schedule_value: args.schedule_value,
      context_mode: args.context_mode || 'isolated',
      chatJid,
      timestamp: new Date().toISOString(),
    });

    return {
      content: [{ type: 'text' as const, text: `Task scheduled: ${args.schedule_type} - ${args.schedule_value}` }],
    };
  },
);

server.tool(
  'list_tasks',
  'List all scheduled tasks.',
  {},
  async () => {
    const tasksFile = path.join(ipcDir, 'current_tasks.json');
    try {
      if (!fs.existsSync(tasksFile)) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
      }
      const tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));
      if (tasks.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
      }
      const formatted = tasks
        .map(
          (t: { id: string; prompt: string; schedule_type: string; schedule_value: string; status: string; next_run: string }) =>
            `- [${t.id}] ${t.prompt.slice(0, 50)}... (${t.schedule_type}: ${t.schedule_value}) - ${t.status}, next: ${t.next_run || 'N/A'}`,
        )
        .join('\n');
      return { content: [{ type: 'text' as const, text: `Scheduled tasks:\n${formatted}` }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error reading tasks: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  },
);

server.tool(
  'pause_task',
  'Pause a scheduled task.',
  { task_id: z.string() },
  async (args) => {
    writeIpcFile(TASKS_DIR, { type: 'pause_task', taskId: args.task_id, timestamp: new Date().toISOString() });
    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} pause requested.` }] };
  },
);

server.tool(
  'resume_task',
  'Resume a paused task.',
  { task_id: z.string() },
  async (args) => {
    writeIpcFile(TASKS_DIR, { type: 'resume_task', taskId: args.task_id, timestamp: new Date().toISOString() });
    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} resume requested.` }] };
  },
);

server.tool(
  'cancel_task',
  'Cancel and delete a scheduled task.',
  { task_id: z.string() },
  async (args) => {
    writeIpcFile(TASKS_DIR, { type: 'cancel_task', taskId: args.task_id, timestamp: new Date().toISOString() });
    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} cancellation requested.` }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
