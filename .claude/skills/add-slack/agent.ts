/**
 * Slack MCP Tools for Container Agent
 *
 * Provides Slack capabilities to agents running in containers.
 * Tools communicate with the host via IPC files.
 */

import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

const IPC_DIR = '/workspace/ipc';
const TASKS_DIR = path.join(IPC_DIR, 'tasks');
const RESULTS_DIR = path.join(IPC_DIR, 'slack_results');

function writeIpcFile(dir: string, data: object): string {
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);
  const tempPath = `${filepath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filepath);
  return filename;
}

function waitForResult(requestId: string, timeoutMs = 30000): Promise<{ success: boolean; message: string; data?: unknown }> {
  const resultFile = path.join(RESULTS_DIR, `${requestId}.json`);
  const start = Date.now();

  return new Promise((resolve) => {
    const check = () => {
      if (fs.existsSync(resultFile)) {
        try {
          const result = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
          fs.unlinkSync(resultFile);
          resolve(result);
          return;
        } catch {
          // File not ready yet, continue polling
        }
      }
      if (Date.now() - start > timeoutMs) {
        resolve({ success: false, message: 'Request timed out waiting for host response' });
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

interface SlackToolContext {
  groupFolder: string;
  isMain: boolean;
}

export function createSlackTools(ctx: SlackToolContext) {
  const { isMain } = ctx;

  // Only main group can use Slack tools
  if (!isMain) {
    return [];
  }

  return [
    tool(
      'slack_send_message',
      `Send a message to a Slack channel or thread.

Use this to:
- Post updates or notifications to OTHER channels (not the current conversation)
- Reply in specific threads
- Send proactive notifications

IMPORTANT: Do NOT use this to echo your response to the user - that happens automatically.
Only use this for messages to DIFFERENT channels or for proactive notifications.

Channel can be specified as #channel-name or channel ID (C01234567).`,
      {
        channel: z.string().describe('Channel name (e.g., "#general") or ID (e.g., "C01234567")'),
        text: z.string().describe('Message text to send. Supports Slack markdown: *bold*, _italic_, \`code\`, ```code block```'),
        thread_ts: z.string().optional().describe('Thread timestamp to reply in a thread (e.g., "1234567890.123456")')
      },
      async (args) => {
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        writeIpcFile(TASKS_DIR, {
          type: 'slack_send_message',
          requestId,
          channel: args.channel,
          text: args.text,
          thread_ts: args.thread_ts,
        });

        const result = await waitForResult(requestId);
        return {
          content: [{
            type: 'text',
            text: result.success
              ? `Message sent to ${args.channel}`
              : `Error: ${result.message}`
          }],
          isError: !result.success
        };
      }
    ),

    tool(
      'slack_list_channels',
      'List available Slack channels the bot can access. Returns channel names, IDs, and membership status.',
      {},
      async () => {
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        writeIpcFile(TASKS_DIR, {
          type: 'slack_list_channels',
          requestId,
        });

        const result = await waitForResult(requestId);
        if (!result.success) {
          return { content: [{ type: 'text', text: `Error: ${result.message}` }], isError: true };
        }

        const channels = (result.data as { channels: Array<{ id: string; name: string; is_member: boolean }> }).channels;
        const formatted = channels.map(c =>
          `- #${c.name} (${c.id})${c.is_member ? ' [member]' : ''}`
        ).join('\n');
        return { content: [{ type: 'text', text: `Available channels:\n${formatted}` }] };
      }
    ),

    tool(
      'slack_read_messages',
      `Read recent messages from a Slack channel.

Returns messages with timestamps, text content, and user information.
Use the timestamp (ts) to reply in threads or add reactions.`,
      {
        channel: z.string().describe('Channel ID (e.g., "C01234567"). Use slack_list_channels to find IDs.'),
        limit: z.number().optional().default(10).describe('Number of messages to fetch (1-100, default 10)')
      },
      async (args) => {
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        writeIpcFile(TASKS_DIR, {
          type: 'slack_read_messages',
          requestId,
          channel: args.channel,
          limit: Math.min(Math.max(args.limit || 10, 1), 100),
        });

        const result = await waitForResult(requestId);
        if (!result.success) {
          return { content: [{ type: 'text', text: `Error: ${result.message}` }], isError: true };
        }

        const messages = (result.data as { messages: Array<{ ts: string; text: string; user_name: string }> }).messages;
        if (messages.length === 0) {
          return { content: [{ type: 'text', text: 'No messages found in channel.' }] };
        }

        const formatted = messages.map(m =>
          `[${m.ts}] ${m.user_name}: ${m.text}`
        ).join('\n\n');
        return { content: [{ type: 'text', text: `Recent messages:\n\n${formatted}` }] };
      }
    ),

    tool(
      'slack_get_channel_info',
      'Get information about a Slack channel including topic, purpose, and member count.',
      {
        channel: z.string().describe('Channel ID (e.g., "C01234567")')
      },
      async (args) => {
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        writeIpcFile(TASKS_DIR, {
          type: 'slack_get_channel_info',
          requestId,
          channel: args.channel,
        });

        const result = await waitForResult(requestId);
        if (!result.success) {
          return { content: [{ type: 'text', text: `Error: ${result.message}` }], isError: true };
        }

        const info = result.data as { id: string; name: string; topic: string; purpose: string; num_members: number };
        const formatted = [
          `Channel: #${info.name} (${info.id})`,
          `Members: ${info.num_members}`,
          info.topic ? `Topic: ${info.topic}` : null,
          info.purpose ? `Purpose: ${info.purpose}` : null,
        ].filter(Boolean).join('\n');

        return { content: [{ type: 'text', text: formatted }] };
      }
    ),

    tool(
      'slack_add_reaction',
      'Add an emoji reaction to a message. Use message timestamps from slack_read_messages.',
      {
        channel: z.string().describe('Channel ID where the message is'),
        timestamp: z.string().describe('Message timestamp (ts) to react to'),
        emoji: z.string().describe('Emoji name without colons (e.g., "thumbsup", "rocket", "white_check_mark")')
      },
      async (args) => {
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        writeIpcFile(TASKS_DIR, {
          type: 'slack_add_reaction',
          requestId,
          channel: args.channel,
          timestamp: args.timestamp,
          emoji: args.emoji.replace(/:/g, ''),
        });

        const result = await waitForResult(requestId);
        return {
          content: [{
            type: 'text',
            text: result.success
              ? `Added :${args.emoji}: reaction`
              : `Error: ${result.message}`
          }],
          isError: !result.success
        };
      }
    ),
  ];
}
