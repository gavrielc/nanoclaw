/**
 * Slack Integration IPC Handler
 *
 * Handles all slack_* IPC messages from container agents.
 * This is the entry point for Slack integration in the host process.
 *
 * INTEGRATION NOTE: Copy this file to src/slack-host.ts
 * The import path below is correct for that location.
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

interface SkillResult {
  success: boolean;
  message: string;
  data?: unknown;
}

// Write result to IPC results directory
function writeResult(dataDir: string, sourceGroup: string, requestId: string, result: SkillResult): void {
  const resultsDir = path.join(dataDir, 'ipc', sourceGroup, 'slack_results');
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(resultsDir, `${requestId}.json`), JSON.stringify(result));
}

/**
 * Handle Slack integration IPC messages
 *
 * @returns true if message was handled, false if not a Slack message
 */
export async function handleSlackIpc(
  data: Record<string, unknown>,
  sourceGroup: string,
  isMain: boolean,
  dataDir: string
): Promise<boolean> {
  const type = data.type as string;

  // Only handle slack_* types
  if (!type?.startsWith('slack_')) {
    return false;
  }

  // Only main group can use Slack integration
  if (!isMain) {
    logger.warn({ sourceGroup, type }, 'Slack integration blocked: not main group');
    return true;
  }

  const requestId = data.requestId as string;
  if (!requestId) {
    logger.warn({ type }, 'Slack integration blocked: missing requestId');
    return true;
  }

  logger.info({ type, requestId }, 'Processing Slack request');

  let result: SkillResult;

  try {
    // Check token is configured
    if (!process.env.SLACK_BOT_TOKEN) {
      result = {
        success: false,
        message: 'SLACK_BOT_TOKEN not configured. Ensure it is in .env AND synced to data/env/env'
      };
      writeResult(dataDir, sourceGroup, requestId, result);
      logger.error({ type, requestId }, 'Slack token not configured');
      return true;
    }

    // Dynamic import to avoid errors if @slack/web-api not installed
    const { WebClient } = await import('@slack/web-api');
    const client = new WebClient(process.env.SLACK_BOT_TOKEN);

    switch (type) {
      case 'slack_send_message':
        if (!data.channel || !data.text) {
          result = { success: false, message: 'Missing channel or text' };
          break;
        }
        const sendResult = await client.chat.postMessage({
          channel: data.channel as string,
          text: data.text as string,
          thread_ts: data.thread_ts as string | undefined,
        });
        result = { success: true, message: 'Message sent', data: { ts: sendResult.ts, channel: sendResult.channel } };
        break;

      case 'slack_list_channels':
        const channelsResult = await client.conversations.list({
          types: 'public_channel,private_channel',
          limit: 100,
          exclude_archived: true,
        });
        const channels = (channelsResult.channels || [])
          .filter(c => c.id && c.name)
          .map(c => ({ id: c.id, name: c.name, is_member: c.is_member }));
        result = { success: true, message: `Found ${channels.length} channels`, data: { channels } };
        break;

      case 'slack_read_messages':
        if (!data.channel) {
          result = { success: false, message: 'Missing channel' };
          break;
        }
        const historyResult = await client.conversations.history({
          channel: data.channel as string,
          limit: Math.min((data.limit as number) || 10, 100),
        });

        // Fetch user info for messages
        const userIds = new Set((historyResult.messages || []).map(m => m.user).filter(Boolean));
        const userMap: Record<string, string> = {};
        for (const userId of userIds) {
          try {
            const userInfo = await client.users.info({ user: userId as string });
            if (userInfo.user?.real_name) {
              userMap[userId as string] = userInfo.user.real_name;
            }
          } catch {
            // Ignore user lookup failures
          }
        }

        const messages = (historyResult.messages || []).map(m => ({
          ts: m.ts,
          text: m.text,
          user: m.user,
          user_name: m.user ? userMap[m.user] || m.user : 'unknown',
        }));
        result = { success: true, message: `Found ${messages.length} messages`, data: { messages } };
        break;

      case 'slack_get_channel_info':
        if (!data.channel) {
          result = { success: false, message: 'Missing channel' };
          break;
        }
        const infoResult = await client.conversations.info({
          channel: data.channel as string,
        });
        result = {
          success: true,
          message: 'Channel info retrieved',
          data: {
            id: infoResult.channel?.id,
            name: infoResult.channel?.name,
            topic: infoResult.channel?.topic?.value,
            purpose: infoResult.channel?.purpose?.value,
            num_members: infoResult.channel?.num_members,
          }
        };
        break;

      case 'slack_add_reaction':
        if (!data.channel || !data.timestamp || !data.emoji) {
          result = { success: false, message: 'Missing channel, timestamp, or emoji' };
          break;
        }
        await client.reactions.add({
          channel: data.channel as string,
          timestamp: data.timestamp as string,
          name: (data.emoji as string).replace(/:/g, ''),
        });
        result = { success: true, message: 'Reaction added' };
        break;

      default:
        return false;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ type, requestId, error: errorMessage }, 'Slack request failed');
    result = { success: false, message: errorMessage };
  }

  writeResult(dataDir, sourceGroup, requestId, result);

  if (result.success) {
    logger.info({ type, requestId }, 'Slack request completed');
  }

  return true;
}
