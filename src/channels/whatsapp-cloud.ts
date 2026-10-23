/**
 * WhatsApp Cloud API channel adapter (v2) — uses Chat SDK bridge.
 * Uses the official Meta WhatsApp Business Cloud API (not Baileys).
 * Self-registers on import.
 */
import { createWhatsAppAdapter } from '@chat-adapter/whatsapp';
import type { ActionsElement, CardChild, CardElement } from 'chat';

import { readEnvFile } from '../env.js';
import type { ChannelDefaults, ChannelRegistration } from './adapter.js';
import { createChatSdkBridge } from './chat-sdk-bridge.js';
import { registerChannelAdapter } from './channel-registry.js';

/**
 * Dedicated business number on the official Cloud API — non-threaded, so
 * group engagement defaults to 'mention' (never sticky: one shared session
 * would stay engaged forever).
 */
const WHATSAPP_CLOUD_DEFAULTS: ChannelDefaults = {
  dm: { engageMode: 'pattern', engagePattern: '.', threads: false, unknownSenderPolicy: 'request_approval' },
  group: { engageMode: 'mention', threads: false, unknownSenderPolicy: 'request_approval' },
  mentions: 'platform',
};

/**
 * A card with reply buttons is an interactive message: its title is a
 * 60-character header and its plain text a 1,024-character body, both cut
 * past that with the buttons kept. Any other card is a text message of its
 * rendered lines with WhatsApp markup escaped, split past 4,096. These mirror
 * the adapter's own rendering (@chat-adapter/whatsapp, not exported).
 */
const CARD_HEADER_MAX = 60;
const CARD_BODY_MAX = 1024;
const TEXT_MESSAGE_MAX = 4096;

const escapeWhatsApp = (text: string) => text.replace(/[\\*_~`]/g, '\\$&');

function firstActions(children: CardChild[]): ActionsElement | undefined {
  for (const child of children) {
    if (child.type === 'actions') return child;
    const nested = child.type === 'section' ? firstActions(child.children) : undefined;
    if (nested) return nested;
  }
  return undefined;
}

function plainText(child: CardChild): string | null {
  if (child.type === 'text') return child.content;
  if (child.type === 'fields') return child.children.map((f) => `${f.label}: ${f.value}`).join('\n');
  if (child.type === 'section') return child.children.map(plainText).filter(Boolean).join('\n');
  return null;
}

function textLines(child: CardChild): string[] {
  switch (child.type) {
    case 'text': {
      const text = escapeWhatsApp(child.content);
      return [child.style === 'bold' ? `*${text}*` : child.style === 'muted' ? `_${text}_` : text];
    }
    case 'fields':
      return child.children.map((f) => `*${escapeWhatsApp(f.label)}:* ${escapeWhatsApp(f.value)}`);
    case 'actions':
      return [
        child.children
          .map((a) =>
            a.type === 'link-button' ? `${escapeWhatsApp(a.label)}: ${a.url}` : `[${escapeWhatsApp(a.label)}]`,
          )
          .join(' | '),
      ];
    case 'section':
      return child.children.flatMap(textLines);
    case 'divider':
      return ['---'];
    default:
      return [];
  }
}

export function fitsWhatsAppCard(card: CardElement): boolean {
  if (firstActions(card.children)?.children.some((a) => a.type === 'button' && a.id)) {
    const body = [card.subtitle, ...card.children.map(plainText)].filter(Boolean).join('\n');
    return (card.title?.length ?? 0) <= CARD_HEADER_MAX && body.length <= CARD_BODY_MAX;
  }
  const lines: string[] = [];
  if (card.title) lines.push(`*${escapeWhatsApp(card.title)}*`);
  if (card.subtitle) lines.push(escapeWhatsApp(card.subtitle));
  if ((card.title || card.subtitle) && card.children.length > 0) lines.push('');
  card.children.forEach((child, i) => {
    const childLines = textLines(child);
    if (childLines.length === 0) return;
    lines.push(...childLines);
    if (i < card.children.length - 1) lines.push('');
  });
  return lines.join('\n').length <= TEXT_MESSAGE_MAX;
}

export const whatsappCloudRegistration: ChannelRegistration = {
  factory: () => {
    const env = readEnvFile([
      'WHATSAPP_ACCESS_TOKEN',
      'WHATSAPP_PHONE_NUMBER_ID',
      'WHATSAPP_APP_SECRET',
      'WHATSAPP_VERIFY_TOKEN',
    ]);
    if (!env.WHATSAPP_ACCESS_TOKEN) return null;
    const whatsappAdapter = createWhatsAppAdapter({
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      appSecret: env.WHATSAPP_APP_SECRET,
      verifyToken: env.WHATSAPP_VERIFY_TOKEN,
    });
    // `@chat-adapter/whatsapp` hardcodes name = 'whatsapp', which the bridge
    // uses as channelType. Without a distinct instance the registry would key
    // this bridge under 'whatsapp' and collide with the native Baileys adapter
    // (src/channels/whatsapp.ts, also channelType 'whatsapp') — last-write-wins
    // silently kills one channel. The instance key keeps them apart while
    // channelType stays 'whatsapp' (the semantic platform key). See #2911.
    return createChatSdkBridge({
      adapter: whatsappAdapter,
      instance: 'whatsapp-cloud',
      concurrency: 'concurrent',
      supportsThreads: false,
      defaults: WHATSAPP_CLOUD_DEFAULTS,
      // Spread, so an older core without this option still type-checks (and ignores it).
      ...{ cardFits: fitsWhatsAppCard },
    });
  },
  defaults: WHATSAPP_CLOUD_DEFAULTS,
};

registerChannelAdapter('whatsapp-cloud', whatsappCloudRegistration);
