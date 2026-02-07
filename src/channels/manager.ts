/**
 * Channel Manager for NanoClaw
 *
 * Manages all communication channels and routes messages through the message bus.
 * Inspired by nanobot's ChannelManager pattern.
 */
import { ASSISTANT_NAME } from '../config.js';
import { logger } from '../logger.js';
import { MessageBus } from '../message-bus.js';
import { BaseChannel, InboundMessage, OutboundMessage } from './base.js';

export class ChannelManager {
  private channels = new Map<string, BaseChannel>();
  private bus: MessageBus;

  constructor(bus: MessageBus) {
    this.bus = bus;

    // Subscribe to outbound messages to route them to the correct channel
    this.bus.onOutbound(async (msg: OutboundMessage) => {
      await this.routeOutbound(msg);
    });
  }

  /** Register a channel */
  addChannel(channel: BaseChannel): void {
    this.channels.set(channel.channelType, channel);

    // Forward inbound messages to the bus
    channel.on('message', (msg: InboundMessage) => {
      this.bus.publishInbound(msg);
    });

    logger.info({ channel: channel.channelType }, 'Channel registered');
  }

  /** Get a specific channel by type */
  getChannel<T extends BaseChannel>(channelType: string): T | undefined {
    return this.channels.get(channelType) as T | undefined;
  }

  /** Start all enabled channels */
  async startAll(): Promise<void> {
    const startPromises: Promise<void>[] = [];

    for (const [name, channel] of this.channels) {
      logger.info({ channel: name }, 'Starting channel');
      startPromises.push(
        channel.start().catch((err) => {
          logger.error({ channel: name, err }, 'Failed to start channel');
        }),
      );
    }

    await Promise.all(startPromises);
    logger.info(
      { channels: Array.from(this.channels.keys()) },
      'All channels started',
    );
  }

  /** Stop all channels gracefully */
  async stopAll(): Promise<void> {
    const stopPromises: Promise<void>[] = [];

    for (const [name, channel] of this.channels) {
      logger.info({ channel: name }, 'Stopping channel');
      stopPromises.push(
        channel.stop().catch((err) => {
          logger.error({ channel: name, err }, 'Failed to stop channel');
        }),
      );
    }

    await Promise.all(stopPromises);
  }

  /** Send a message via the appropriate channel */
  async sendMessage(
    channel: string,
    chatId: string,
    text: string,
  ): Promise<void> {
    const ch = this.channels.get(channel);
    if (!ch) {
      logger.error({ channel }, 'Channel not found for outbound message');
      return;
    }
    await ch.sendMessage(chatId, `${ASSISTANT_NAME}: ${text}`);
  }

  /** Route an outbound message to the correct channel */
  private async routeOutbound(msg: OutboundMessage): Promise<void> {
    const channel = this.channels.get(msg.channel);
    if (!channel) {
      logger.error(
        { channel: msg.channel },
        'No channel found for outbound message',
      );
      return;
    }
    await channel.sendMessage(msg.chatId, msg.content);
  }
}
