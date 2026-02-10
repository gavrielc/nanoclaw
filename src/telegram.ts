import { Api, Bot } from 'grammy';
import {
  ASSISTANT_NAME,
  TRIGGER_PATTERN,
} from './config.js';
import {
  getAllRegisteredGroups,
  storeChatMetadata,
  storeMessageDirect,
} from './db.js';
import { logger } from './logger.js';

let bot: Bot | null = null;

// Bot pool for agent teams: send-only Api instances (no polling)
const poolApis: Api[] = [];
// Current display name for each pool bot (from getMe at startup)
const poolBotNames: string[] = [];
// Maps "{groupFolder}:{senderName}" → pool Api index for stable assignment
const senderBotMap = new Map<string, number>();
// Tracks which pool indices are already claimed this session
const assignedIndices = new Set<number>();


/** Store a placeholder message for non-text content (photos, voice, etc.) */
function storeNonTextMessage(ctx: any, placeholder: string): void {
  const chatId = `tg:${ctx.chat.id}`;
  const registeredGroups = getAllRegisteredGroups();
  if (!registeredGroups[chatId]) return;

  const timestamp = new Date(ctx.message.date * 1000).toISOString();
  const senderName =
    ctx.from?.first_name || ctx.from?.username || ctx.from?.id?.toString() || 'Unknown';
  const caption = ctx.message.caption ? ` ${ctx.message.caption}` : '';

  storeChatMetadata(chatId, timestamp);
  storeMessageDirect({
    id: ctx.message.message_id.toString(),
    chat_jid: chatId,
    sender: ctx.from?.id?.toString() || '',
    sender_name: senderName,
    content: `${placeholder}${caption}`,
    timestamp,
    is_from_me: false,
  });
}

export async function connectTelegram(botToken: string): Promise<void> {
  bot = new Bot(botToken);

  // Command to get chat ID (useful for registration)
  bot.command('chatid', (ctx) => {
    const chatId = ctx.chat.id;
    const chatType = ctx.chat.type;
    const chatName =
      chatType === 'private'
        ? ctx.from?.first_name || 'Private'
        : (ctx.chat as any).title || 'Unknown';

    ctx.reply(
      `Chat ID: \`tg:${chatId}\`\nName: ${chatName}\nType: ${chatType}`,
      { parse_mode: 'Markdown' },
    );
  });

  // Command to check bot status
  bot.command('ping', (ctx) => {
    ctx.reply(`${ASSISTANT_NAME} is online.`);
  });

  bot.on('message:text', async (ctx) => {
    // Skip commands
    if (ctx.message.text.startsWith('/')) return;

    const chatId = `tg:${ctx.chat.id}`;
    let content = ctx.message.text;
    const timestamp = new Date(ctx.message.date * 1000).toISOString();
    const senderName =
      ctx.from?.first_name ||
      ctx.from?.username ||
      ctx.from?.id.toString() ||
      'Unknown';
    const sender = ctx.from?.id.toString() || '';
    const msgId = ctx.message.message_id.toString();

    // Determine chat name
    const chatName =
      ctx.chat.type === 'private'
        ? senderName
        : (ctx.chat as any).title || chatId;

    // Translate Telegram @bot_username mentions into TRIGGER_PATTERN format.
    // Telegram @mentions (e.g., @andy_ai_bot) won't match TRIGGER_PATTERN
    // (e.g., ^@Andy\b), so we prepend the trigger when the bot is @mentioned.
    const botUsername = ctx.me?.username?.toLowerCase();
    if (botUsername) {
      const entities = ctx.message.entities || [];
      const isBotMentioned = entities.some((entity) => {
        if (entity.type === 'mention') {
          const mentionText = content
            .substring(entity.offset, entity.offset + entity.length)
            .toLowerCase();
          return mentionText === `@${botUsername}`;
        }
        return false;
      });
      if (isBotMentioned && !TRIGGER_PATTERN.test(content)) {
        content = `@${ASSISTANT_NAME} ${content}`;
      }
    }

    // Store chat metadata for discovery
    storeChatMetadata(chatId, timestamp, chatName);

    // Check if this chat is registered
    const registeredGroups = getAllRegisteredGroups();
    const group = registeredGroups[chatId];

    if (!group) {
      logger.debug(
        { chatId, chatName },
        'Message from unregistered Telegram chat',
      );
      return;
    }

    // Store message — startMessageLoop() will pick it up
    storeMessageDirect({
      id: msgId,
      chat_jid: chatId,
      sender,
      sender_name: senderName,
      content,
      timestamp,
      is_from_me: false,
    });

    logger.info(
      { chatId, chatName, sender: senderName },
      'Telegram message stored',
    );
  });

  // Handle non-text messages with placeholders so the agent knows something was sent
  bot.on('message:photo', (ctx) => storeNonTextMessage(ctx, '[Photo]'));
  bot.on('message:video', (ctx) => storeNonTextMessage(ctx, '[Video]'));
  bot.on('message:voice', (ctx) => storeNonTextMessage(ctx, '[Voice message]'));
  bot.on('message:audio', (ctx) => storeNonTextMessage(ctx, '[Audio]'));
  bot.on('message:document', (ctx) => {
    const name = ctx.message.document?.file_name || 'file';
    storeNonTextMessage(ctx, `[Document: ${name}]`);
  });
  bot.on('message:sticker', (ctx) => {
    const emoji = ctx.message.sticker?.emoji || '';
    storeNonTextMessage(ctx, `[Sticker ${emoji}]`);
  });
  bot.on('message:location', (ctx) => storeNonTextMessage(ctx, '[Location]'));
  bot.on('message:contact', (ctx) => storeNonTextMessage(ctx, '[Contact]'));

  // Handle errors gracefully
  bot.catch((err) => {
    logger.error({ err: err.message }, 'Telegram bot error');
  });

  // Start polling
  bot.start({
    onStart: (botInfo) => {
      logger.info(
        { username: botInfo.username, id: botInfo.id },
        'Telegram bot connected',
      );
      console.log(`\n  Telegram bot: @${botInfo.username}`);
      console.log(
        `  Send /chatid to the bot to get a chat's registration ID\n`,
      );
    },
  });
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
): Promise<void> {
  if (!bot) {
    logger.warn('Telegram bot not initialized');
    return;
  }

  try {
    const numericId = chatId.replace(/^tg:/, '');

    // Telegram has a 4096 character limit per message — split if needed
    const MAX_LENGTH = 4096;
    if (text.length <= MAX_LENGTH) {
      await bot.api.sendMessage(numericId, text);
    } else {
      for (let i = 0; i < text.length; i += MAX_LENGTH) {
        await bot.api.sendMessage(numericId, text.slice(i, i + MAX_LENGTH));
      }
    }
    logger.info({ chatId, length: text.length }, 'Telegram message sent');
  } catch (err) {
    logger.error({ chatId, err }, 'Failed to send Telegram message');
  }
}

export async function setTelegramTyping(chatId: string): Promise<void> {
  if (!bot) return;
  try {
    const numericId = chatId.replace(/^tg:/, '');
    await bot.api.sendChatAction(numericId, 'typing');
  } catch (err) {
    logger.debug({ chatId, err }, 'Failed to send Telegram typing indicator');
  }
}

/**
 * Initialize send-only Api instances for the bot pool.
 * Each pool bot can send messages but doesn't poll for updates.
 */
export async function initBotPool(tokens: string[]): Promise<void> {
  for (const token of tokens) {
    try {
      const api = new Api(token);
      const me = await api.getMe();
      poolApis.push(api);
      poolBotNames.push(me.first_name);
      logger.info(
        { username: me.username, name: me.first_name, id: me.id, poolSize: poolApis.length },
        'Pool bot initialized',
      );
    } catch (err) {
      logger.error({ err }, 'Failed to initialize pool bot');
    }
  }
  if (poolApis.length > 0) {
    logger.info({ count: poolApis.length, names: poolBotNames }, 'Telegram bot pool ready');
  }
}

/**
 * Send a message via a pool bot assigned to the given sender name.
 * Assignment priority:
 *   1. Already assigned to this sender this session → reuse
 *   2. A pool bot whose current name matches the sender → claim it (no rename needed)
 *   3. First unassigned pool bot → claim and rename
 *   4. All claimed → wrap around (reuse + rename)
 */
export async function sendPoolMessage(
  chatId: string,
  text: string,
  sender: string,
  groupFolder: string,
): Promise<void> {
  if (poolApis.length === 0) {
    // No pool bots — fall back to main bot
    await sendTelegramMessage(chatId, text);
    return;
  }

  const key = `${groupFolder}:${sender}`;
  let idx = senderBotMap.get(key);
  if (idx === undefined) {
    // 1. Check if any pool bot already has this name (from a previous session)
    const nameMatch = poolBotNames.findIndex(
      (name, i) => name === sender && !assignedIndices.has(i),
    );
    if (nameMatch !== -1) {
      idx = nameMatch;
      assignedIndices.add(idx);
      senderBotMap.set(key, idx);
      logger.info({ sender, groupFolder, poolIndex: idx }, 'Matched pool bot by name');
    } else {
      // 2. Pick first unassigned bot
      let freeIdx = -1;
      for (let i = 0; i < poolApis.length; i++) {
        if (!assignedIndices.has(i)) {
          freeIdx = i;
          break;
        }
      }
      // 3. All assigned — wrap around to least recently used
      if (freeIdx === -1) freeIdx = assignedIndices.size % poolApis.length;

      idx = freeIdx;
      assignedIndices.add(idx);
      senderBotMap.set(key, idx);
      // Rename the bot, then wait for Telegram to propagate
      try {
        await poolApis[idx].setMyName(sender);
        poolBotNames[idx] = sender;
        await new Promise((r) => setTimeout(r, 2000));
        logger.info({ sender, groupFolder, poolIndex: idx }, 'Assigned and renamed pool bot');
      } catch (err) {
        logger.warn({ sender, err }, 'Failed to rename pool bot (sending anyway)');
      }
    }
  }

  const api = poolApis[idx];
  try {
    const numericId = chatId.replace(/^tg:/, '');
    const MAX_LENGTH = 4096;
    if (text.length <= MAX_LENGTH) {
      await api.sendMessage(numericId, text);
    } else {
      for (let i = 0; i < text.length; i += MAX_LENGTH) {
        await api.sendMessage(numericId, text.slice(i, i + MAX_LENGTH));
      }
    }
    logger.info({ chatId, sender, poolIndex: idx, length: text.length }, 'Pool message sent');
  } catch (err) {
    logger.error({ chatId, sender, err }, 'Failed to send pool message');
  }
}

export function isTelegramConnected(): boolean {
  return bot !== null;
}

export function stopTelegram(): void {
  if (bot) {
    bot.stop();
    bot = null;
    logger.info('Telegram bot stopped');
  }
}
