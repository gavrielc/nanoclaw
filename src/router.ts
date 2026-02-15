import { ASSISTANT_NAME, ASSISTANT_HAS_OWN_NUMBER } from './config.js';
import { Channel, NewMessage } from './types.js';

export function isDirectChat(jid: string): boolean {
  return !jid.endsWith('@g.us');
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMessages(messages: NewMessage[]): string {
  const lines = messages.map((m) =>
    `<message sender="${escapeXml(m.sender_name)}" time="${m.timestamp}">${escapeXml(m.content)}</message>`,
  );
  return `<messages>\n${lines.join('\n')}\n</messages>`;
}

export function stripInternalTags(text: string): string {
  return text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
}

export function formatOutbound(channel: Channel, rawText: string, jid?: string): string {
  const text = stripInternalTags(rawText);
  if (!text) return '';
  // Skip prefix if: channel says no, assistant has own number, or it's a direct chat
  const skipPrefix =
    channel.prefixAssistantName === false ||
    ASSISTANT_HAS_OWN_NUMBER ||
    (jid && isDirectChat(jid));
  const prefix = skipPrefix ? '' : `${ASSISTANT_NAME}: `;
  return `${prefix}${text}`;
}

export function routeOutbound(
  channels: Channel[],
  jid: string,
  text: string,
): Promise<void> {
  const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
  if (!channel) throw new Error(`No channel for JID: ${jid}`);
  return channel.sendMessage(jid, text);
}

export function findChannel(
  channels: Channel[],
  jid: string,
): Channel | undefined {
  return channels.find((c) => c.ownsJid(jid));
}
