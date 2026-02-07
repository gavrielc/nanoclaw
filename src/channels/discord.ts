/**
 * Discord Channel for NanoClaw
 *
 * Uses Discord Gateway WebSocket API with minimal dependencies.
 * Requires DISCORD_BOT_TOKEN in environment.
 *
 * Security: validates sender against allowedUsers list.
 */
import https from 'https';
import { WebSocket } from 'ws';

import { logger } from '../logger.js';
import { BaseChannel, ChannelConfig, InboundMessage } from './base.js';

export interface DiscordChannelConfig extends ChannelConfig {
  botToken: string;
}

const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
// Intents: GUILDS (1) + GUILD_MESSAGES (512) + DIRECT_MESSAGES (4096) + MESSAGE_CONTENT (32768)
const INTENTS = 1 | 512 | 4096 | 32768;

export class DiscordChannel extends BaseChannel {
  private discordConfig: DiscordChannelConfig;
  private ws: WebSocket | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private lastSequence: number | null = null;
  private botUserId: string | null = null;
  private running = false;

  constructor(config: DiscordChannelConfig) {
    super('discord', config);
    this.discordConfig = config;
  }

  async start(): Promise<void> {
    if (!this.discordConfig.botToken) {
      logger.error('Discord bot token not configured');
      return;
    }

    this.running = true;
    this.connect();
    logger.info('Discord channel started');
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.ws) {
      this.ws.close(1000);
      this.ws = null;
    }
    logger.info('Discord channel stopped');
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    const url = `https://discord.com/api/v10/channels/${chatId}/messages`;
    const body = JSON.stringify({ content: text });

    return new Promise((resolve, reject) => {
      const req = https.request(
        url,
        {
          method: 'POST',
          headers: {
            Authorization: `Bot ${this.discordConfig.botToken}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 10000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode === 200 || res.statusCode === 201) {
              logger.info({ chatId }, 'Discord message sent');
              resolve();
            } else {
              logger.error(
                { chatId, status: res.statusCode, body: data },
                'Discord send failed',
              );
              reject(new Error(`Discord API error: ${res.statusCode}`));
            }
          });
        },
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  private connect(): void {
    this.ws = new WebSocket(GATEWAY_URL);

    this.ws.on('message', (data: Buffer) => {
      try {
        const payload = JSON.parse(data.toString());
        this.handleGatewayEvent(payload);
      } catch (err) {
        logger.error({ err }, 'Discord gateway parse error');
      }
    });

    this.ws.on('close', (code) => {
      logger.info({ code }, 'Discord gateway closed');
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
      if (this.running) {
        // Reconnect after delay
        setTimeout(() => this.connect(), 5000);
      }
    });

    this.ws.on('error', (err) => {
      logger.error({ err }, 'Discord gateway error');
    });
  }

  private handleGatewayEvent(payload: {
    op: number;
    d: any;
    s: number | null;
    t: string | null;
  }): void {
    if (payload.s !== null) {
      this.lastSequence = payload.s;
    }

    switch (payload.op) {
      case 10: // Hello
        this.startHeartbeat(payload.d.heartbeat_interval);
        this.identify();
        break;

      case 11: // Heartbeat ACK
        break;

      case 0: // Dispatch
        if (payload.t === 'READY') {
          this.botUserId = payload.d.user?.id;
          logger.info(
            { botUser: payload.d.user?.username },
            'Discord bot ready',
          );
        } else if (payload.t === 'MESSAGE_CREATE') {
          this.handleMessage(payload.d);
        }
        break;
    }
  }

  private startHeartbeat(intervalMs: number): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.heartbeatInterval = setInterval(() => {
      this.ws?.send(JSON.stringify({ op: 1, d: this.lastSequence }));
    }, intervalMs);
  }

  private identify(): void {
    this.ws?.send(
      JSON.stringify({
        op: 2,
        d: {
          token: this.discordConfig.botToken,
          intents: INTENTS,
          properties: {
            os: 'linux',
            browser: 'nanoclaw',
            device: 'nanoclaw',
          },
        },
      }),
    );
  }

  private handleMessage(data: {
    id: string;
    channel_id: string;
    author: { id: string; username: string; bot?: boolean };
    content: string;
    timestamp: string;
  }): void {
    // Ignore messages from bots (including self)
    if (data.author.bot) return;
    if (data.author.id === this.botUserId) return;

    const inbound: InboundMessage = {
      id: data.id,
      channel: 'discord',
      chatId: data.channel_id,
      senderId: data.author.id,
      senderName: data.author.username,
      content: data.content,
      timestamp: new Date(data.timestamp).toISOString(),
      isFromMe: false,
      raw: data,
    };

    this.emitMessage(inbound);
  }
}
