/**
 * Message Bus for NanoClaw
 *
 * Decoupled async message routing between channels and the agent loop.
 * Inspired by nanobot's bus pattern but adapted for Node.js.
 *
 * Architecture:
 *   Channels → publishInbound() → inbound queue → agent processes
 *   Agent response → publishOutbound() → onOutbound callbacks → channels
 */
import { InboundMessage, OutboundMessage } from './channels/base.js';
import { logger } from './logger.js';

type OutboundHandler = (msg: OutboundMessage) => Promise<void>;
type InboundHandler = (msg: InboundMessage) => void;

export class MessageBus {
  private inboundHandlers: InboundHandler[] = [];
  private outboundHandlers: OutboundHandler[] = [];

  /** Register a handler for inbound messages */
  onInbound(handler: InboundHandler): void {
    this.inboundHandlers.push(handler);
  }

  /** Register a handler for outbound messages */
  onOutbound(handler: OutboundHandler): void {
    this.outboundHandlers.push(handler);
  }

  /** Publish an inbound message from a channel */
  publishInbound(msg: InboundMessage): void {
    logger.debug(
      { channel: msg.channel, chatId: msg.chatId, sender: msg.senderName },
      'Inbound message on bus',
    );

    for (const handler of this.inboundHandlers) {
      try {
        handler(msg);
      } catch (err) {
        logger.error({ err, channel: msg.channel }, 'Inbound handler error');
      }
    }
  }

  /** Publish an outbound message to be sent via a channel */
  async publishOutbound(msg: OutboundMessage): Promise<void> {
    logger.debug(
      { channel: msg.channel, chatId: msg.chatId },
      'Outbound message on bus',
    );

    for (const handler of this.outboundHandlers) {
      try {
        await handler(msg);
      } catch (err) {
        logger.error({ err, channel: msg.channel }, 'Outbound handler error');
      }
    }
  }
}
