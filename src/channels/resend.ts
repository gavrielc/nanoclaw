/**
 * Resend (email) channel adapter (v2) — uses Chat SDK bridge.
 * Self-registers on import.
 */
import { ResendAdapter } from '@resend/chat-sdk-adapter';
import type { AdapterPostableMessage, ChatInstance, StateAdapter } from 'chat';

import { readEnvFile } from '../env.js';
import { log } from '../log.js';
import type { ChannelDefaults, ChannelRegistration } from './adapter.js';
import { createChatSdkBridge } from './chat-sdk-bridge.js';
import { registerChannelAdapter } from './channel-registry.js';

/**
 * Email: every conversation is effectively a DM addressed to the bot's
 * address — the group branch is inert but required by the type. 'dm-only'
 * because email has no mention metadata.
 */
const RESEND_DEFAULTS: ChannelDefaults = {
  dm: { engageMode: 'pattern', engagePattern: '.', threads: false, unknownSenderPolicy: 'request_approval' },
  group: { engageMode: 'pattern', engagePattern: '.', threads: false, unknownSenderPolicy: 'request_approval' },
  mentions: 'dm-only',
};

/** Same lifetime as the adapter's own thread state. */
const LATEST_THREAD_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const latestThreadKey = (address: string) => `nanoclaw:resend:latest-thread:${address.toLowerCase()}`;

/**
 * Email is non-threaded here, so the bridge sends to the platform id
 * `resend:<address>`. The adapter only takes its own `resend:<address>:<hash>`
 * thread ids, so a send goes to that person's latest email thread (keeping its
 * subject and In-Reply-To), or opens a new one when there is none.
 */
class ResendChannelAdapter extends ResendAdapter {
  private threadState?: StateAdapter;

  override initialize(chat: ChatInstance): Promise<void> {
    this.threadState = chat.getState();
    // Inbound thread ids reach the Chat SDK only through processMessage:
    // record each as its sender's latest thread on the way through.
    const processMessage: ChatInstance['processMessage'] = (adapter, threadId, message, options) => {
      void this.rememberThread(threadId);
      return chat.processMessage(adapter, threadId, message, options);
    };
    return super.initialize(
      new Proxy(chat, {
        get: (target, prop) => {
          if (prop === 'processMessage') return processMessage;
          const value: unknown = Reflect.get(target, prop);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }),
    );
  }

  override async postMessage(threadId: string, message: AdapterPostableMessage) {
    return super.postMessage(await this.threadFor(threadId), message);
  }

  private async threadFor(id: string): Promise<string> {
    const [prefix, address, ...rest] = id.split(':');
    if (prefix !== 'resend' || !address || rest.length > 0) return id;
    const latest = await this.threadState?.get<string>(latestThreadKey(address));
    if (latest) return latest;
    const opened = await this.openDM(address);
    await this.rememberThread(opened);
    return opened;
  }

  private async rememberThread(threadId: string): Promise<void> {
    try {
      const { toAddress } = this.decodeThreadId(threadId);
      await this.threadState?.set(latestThreadKey(toAddress), threadId, LATEST_THREAD_TTL_MS);
      // eslint-disable-next-line no-catch-all/no-catch-all -- best effort: a lost write only means a later send opens a new thread
    } catch (err) {
      log.warn('Resend: could not record the latest email thread', { threadId, err });
    }
  }
}

export const resendRegistration: ChannelRegistration = {
  factory: () => {
    const env = readEnvFile(['RESEND_API_KEY', 'RESEND_FROM_ADDRESS', 'RESEND_FROM_NAME', 'RESEND_WEBHOOK_SECRET']);
    if (!env.RESEND_API_KEY) return null;
    const resendAdapter = new ResendChannelAdapter({
      apiKey: env.RESEND_API_KEY,
      fromAddress: env.RESEND_FROM_ADDRESS,
      fromName: env.RESEND_FROM_NAME,
      webhookSecret: env.RESEND_WEBHOOK_SECRET,
    });
    return createChatSdkBridge({
      adapter: resendAdapter,
      concurrency: 'queue',
      supportsThreads: false,
      defaults: RESEND_DEFAULTS,
    });
  },
  defaults: RESEND_DEFAULTS,
};

registerChannelAdapter('resend', resendRegistration);
