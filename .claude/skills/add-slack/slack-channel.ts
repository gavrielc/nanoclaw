/**
 * Slack Channel Integration
 * Listens for Slack events and routes to agent
 *
 * INTEGRATION NOTE: Copy this file to src/slack-channel.ts
 * Used for Channel Mode and Replace Mode only.
 */
import { App, LogLevel } from '@slack/bolt';
import { logger } from './logger.js';

interface SlackChannelConfig {
  enabled: boolean;
  triggerMode: 'mention' | 'mention_strict' | 'channels' | 'dm' | 'all';
  monitoredChannels?: string[];
  triggerWord?: string;
}

export const SLACK_CHANNEL_CONFIG: SlackChannelConfig = {
  enabled: true,
  triggerMode: 'mention',  // Only respond when @mentioned
  monitoredChannels: [],
  triggerWord: undefined,
};

let slackApp: App | null = null;

export async function startSlackListener(
  onMessage: (params: {
    text: string;
    channelId: string;
    userId: string;
    userName: string;
    threadTs?: string;
    say: (text: string) => Promise<void>;
  }) => Promise<void>
): Promise<void> {
  if (!SLACK_CHANNEL_CONFIG.enabled) {
    logger.info('Slack channel disabled');
    return;
  }

  const botToken = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN;

  if (!botToken || !appToken) {
    logger.error('SLACK_BOT_TOKEN and SLACK_APP_TOKEN required for Slack Channel Mode');
    return;
  }

  slackApp = new App({
    token: botToken,
    appToken: appToken,
    socketMode: true,
    logLevel: LogLevel.INFO,
  });

  // Cache for user info to avoid repeated API calls
  const userCache: Record<string, string> = {};

  // Track threads where the bot was mentioned
  const mentionedThreads = new Set<string>();

  async function getUserName(userId: string): Promise<string> {
    if (userCache[userId]) return userCache[userId];
    try {
      const result = await slackApp!.client.users.info({ user: userId });
      const name = result.user?.real_name || result.user?.name || userId;
      userCache[userId] = name;
      return name;
    } catch {
      return userId;
    }
  }

  // Handle app mentions
  slackApp.event('app_mention', async ({ event, say }) => {
    const userId = event.user || 'unknown';
    logger.info({ channel: event.channel, user: userId }, 'Slack app mention');

    // Track this thread for future replies
    const threadId = event.thread_ts || event.ts;
    mentionedThreads.add(threadId);

    const userName = await getUserName(userId);

    await onMessage({
      text: event.text,
      channelId: event.channel,
      userId,
      userName,
      threadTs: threadId,
      say: async (text) => { await say({ text, thread_ts: event.thread_ts || event.ts }); },
    });
  });

  // Get bot's own user ID to filter out self-messages
  let botUserId: string | undefined;
  try {
    const authResult = await slackApp.client.auth.test();
    botUserId = authResult.user_id;
    logger.debug({ botUserId }, 'Bot user ID retrieved');
  } catch (err) {
    logger.warn({ err }, 'Failed to get bot user ID');
  }

  // Handle messages
  slackApp.event('message', async ({ event, say }) => {
    // Ignore bot messages and message_changed events
    if ('bot_id' in event || event.subtype) return;

    const messageEvent = event as {
      text?: string;
      channel: string;
      user?: string;
      thread_ts?: string;
      ts: string;
      channel_type?: string;
    };

    // Ignore messages from self (bot)
    if (botUserId && messageEvent.user === botUserId) return;

    // Check trigger mode
    if (SLACK_CHANNEL_CONFIG.triggerMode === 'mention') {
      // In mention mode: only respond to thread replies in threads where we were mentioned
      // Top-level @mentions are handled by app_mention event
      if (!messageEvent.thread_ts) {
        return; // Not a thread reply
      }
      if (!mentionedThreads.has(messageEvent.thread_ts)) {
        return; // Not a thread where we were mentioned
      }
      // This is a thread reply in a mentioned thread - continue processing
    }

    if (SLACK_CHANNEL_CONFIG.triggerMode === 'mention_strict') {
      // Strict mode: only respond to @mentions, even in threads
      // All interactions handled by app_mention event
      return;
    }

    if (SLACK_CHANNEL_CONFIG.triggerMode === 'channels') {
      if (!SLACK_CHANNEL_CONFIG.monitoredChannels?.includes(messageEvent.channel)) {
        return;
      }
    }

    if (SLACK_CHANNEL_CONFIG.triggerMode === 'dm') {
      if (messageEvent.channel_type !== 'im') {
        return;
      }
    }

    // 'all' mode: respond to everything

    // Check trigger word if configured
    if (SLACK_CHANNEL_CONFIG.triggerWord) {
      if (!messageEvent.text?.includes(SLACK_CHANNEL_CONFIG.triggerWord)) {
        return;
      }
    }

    logger.info({ channel: messageEvent.channel, user: messageEvent.user }, 'Slack message received');

    const userName = messageEvent.user ? await getUserName(messageEvent.user) : 'unknown';

    await onMessage({
      text: messageEvent.text || '',
      channelId: messageEvent.channel,
      userId: messageEvent.user || 'unknown',
      userName,
      threadTs: messageEvent.thread_ts || messageEvent.ts,
      say: async (text) => { await say({ text, thread_ts: messageEvent.thread_ts || messageEvent.ts }); },
    });
  });

  await slackApp.start();
  logger.info({ triggerMode: SLACK_CHANNEL_CONFIG.triggerMode }, 'Slack listener started');
}

export async function stopSlackListener(): Promise<void> {
  if (slackApp) {
    await slackApp.stop();
    slackApp = null;
  }
}
