/**
 * Telegram Channel for NanoClaw
 *
 * Uses Telegram Bot API with long polling.
 * Requires TELEGRAM_BOT_TOKEN in environment.
 *
 * Security: validates sender against allowedUsers list.
 */
import https from 'https';

import { logger } from '../logger.js';
import { BaseChannel, ChannelConfig, InboundMessage } from './base.js';

export interface TelegramChannelConfig extends ChannelConfig {
  botToken: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
      title?: string;
    };
    date: number;
    text?: string;
  };
}

export class TelegramChannel extends BaseChannel {
  private telegramConfig: TelegramChannelConfig;
  private lastUpdateId = 0;
  private polling = false;
  private abortController: AbortController | null = null;

  constructor(config: TelegramChannelConfig) {
    super('telegram', config);
    this.telegramConfig = config;
  }

  async start(): Promise<void> {
    if (!this.telegramConfig.botToken) {
      logger.error('Telegram bot token not configured');
      return;
    }

    this.polling = true;
    logger.info('Telegram channel started (long polling)');
    this.pollLoop();
  }

  async stop(): Promise<void> {
    this.polling = false;
    if (this.abortController) {
      this.abortController.abort();
    }
    logger.info('Telegram channel stopped');
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.telegramConfig.botToken}/sendMessage`;

    const body = JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 10000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode === 200) {
              logger.info({ chatId }, 'Telegram message sent');
              resolve();
            } else {
              logger.error(
                { chatId, status: res.statusCode, body: data },
                'Telegram send failed',
              );
              reject(new Error(`Telegram API error: ${res.statusCode}`));
            }
          });
        },
      );
      req.on('error', (err) => {
        logger.error({ chatId, err }, 'Telegram send error');
        reject(err);
      });
      req.write(body);
      req.end();
    });
  }

  private async pollLoop(): Promise<void> {
    while (this.polling) {
      try {
        const updates = await this.getUpdates();
        for (const update of updates) {
          this.handleUpdate(update);
        }
      } catch (err) {
        if (this.polling) {
          logger.error({ err }, 'Telegram polling error');
          // Backoff on error
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }
  }

  private getUpdates(): Promise<TelegramUpdate[]> {
    const url = `https://api.telegram.org/bot${this.telegramConfig.botToken}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=30`;

    return new Promise((resolve, reject) => {
      const req = https.request(url, { timeout: 35000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.ok && Array.isArray(parsed.result)) {
              resolve(parsed.result);
            } else {
              reject(new Error(`Telegram API error: ${data}`));
            }
          } catch {
            reject(new Error('Failed to parse Telegram response'));
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  private handleUpdate(update: TelegramUpdate): void {
    this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);

    if (!update.message?.text) return;

    const msg = update.message;
    const senderId = String(msg.from.id);
    const senderName = [msg.from.first_name, msg.from.last_name]
      .filter(Boolean)
      .join(' ');

    const inbound: InboundMessage = {
      id: String(msg.message_id),
      channel: 'telegram',
      chatId: String(msg.chat.id),
      senderId,
      senderName,
      content: msg.text || '',
      timestamp: new Date(msg.date * 1000).toISOString(),
      isFromMe: false,
      raw: update,
    };

    this.emitMessage(inbound);
  }
}
