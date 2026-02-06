/**
 * Telegram Channel for NanoClaw
 *
 * Connects to Telegram via Grammy bot framework using long polling.
 * Receives messages and routes them through the standard message pipeline.
 */
import { Bot, GrammyError, HttpError } from 'grammy';

import { ASSISTANT_NAME, TRIGGER_PATTERN } from './config.js';
import { logger } from './logger.js';

export interface TelegramChannelDeps {
  onMessage: (
    chatJid: string,
    chatName: string,
    senderId: string,
    senderName: string,
    content: string,
    messageId: string,
  ) => void;
}

export class TelegramChannel {
  private bot: Bot;
  private botUsername = '';

  constructor(
    token: string,
    private deps: TelegramChannelDeps,
  ) {
    this.bot = new Bot(token);
  }

  async start(): Promise<void> {
    const me = await this.bot.api.getMe();
    this.botUsername = me.username || '';
    logger.info(
      { username: this.botUsername },
      'Telegram bot identity resolved',
    );

    this.bot.on('message:text', (ctx) => {
      const chatId = ctx.chat.id;
      const chatJid = `tg:${chatId}`;
      const isPrivate = ctx.chat.type === 'private';
      const content = ctx.message.text;

      // In groups, only process messages that mention the bot or match the trigger
      if (!isPrivate) {
        const mentionsBot = (ctx.message.entities || []).some(
          (e) =>
            e.type === 'mention' &&
            content.slice(e.offset, e.offset + e.length).toLowerCase() ===
              `@${this.botUsername.toLowerCase()}`,
        );
        if (!mentionsBot && !TRIGGER_PATTERN.test(content)) return;
      }

      const senderId = `tg:${ctx.from.id}`;
      const senderName =
        ctx.from.first_name +
        (ctx.from.last_name ? ` ${ctx.from.last_name}` : '');
      const messageId = String(ctx.message.message_id);
      const chatName = isPrivate
        ? senderName
        : ctx.chat.title || `Group ${chatId}`;

      this.deps.onMessage(
        chatJid,
        chatName,
        senderId,
        senderName,
        content,
        messageId,
      );
    });

    this.bot.catch((err) => {
      const e = err.error;
      if (e instanceof GrammyError) {
        logger.error({ description: e.description }, 'Telegram API error');
      } else if (e instanceof HttpError) {
        logger.error({ err: e }, 'Telegram network error');
      } else {
        logger.error({ err: e }, 'Telegram handler error');
      }
    });

    // Long polling — Grammy handles reconnection automatically
    this.bot.start({
      onStart: () => logger.info('Telegram bot polling started'),
    });
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    await this.bot.api.sendMessage(Number(chatId), text);
  }

  async setTyping(chatId: string): Promise<void> {
    await this.bot.api.sendChatAction(Number(chatId), 'typing');
  }

  stop(): void {
    this.bot.stop();
  }
}
