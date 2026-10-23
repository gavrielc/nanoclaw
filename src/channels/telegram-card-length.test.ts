/**
 * Telegram card fit against the real @chat-adapter/telegram: only fetch is
 * stubbed, so the test sees the exact MarkdownV2 text the adapter sends. A
 * card fitsTelegramMessage accepts goes out whole; one it rejects would be cut.
 */
import { createTelegramAdapter } from '@chat-adapter/telegram';
import { Actions, Button, Card, CardText, type CardChild, type CardElement } from 'chat';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../env.js', () => ({
  readEnvFile: (keys: string[]) =>
    keys.includes('TELEGRAM_BOT_TOKEN') ? { TELEGRAM_BOT_TOKEN: '100:test-token' } : {},
}));

import { gatewayApprovalPresentation } from '../gateway-approval-presentation.js';
import type { GatewayApprovalRequest } from '../gateway-providers/gateway-provider-registry.js';
import { CardTooLongError } from './ask-question.js';
import { createTelegramBridge, fitsTelegramMessage } from './telegram.js';

const calls: Array<{ method: string; body: { text?: string; reply_markup?: { inline_keyboard: unknown[][] } } }> = [];

vi.stubGlobal(
  'fetch',
  vi.fn(async (url: string, init?: { body: string }) => {
    calls.push({ method: url.slice(url.lastIndexOf('/') + 1), body: init?.body ? JSON.parse(init.body) : {} });
    const result = { message_id: calls.length, chat: { id: 42, type: 'private' }, date: 0, text: '' };
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  }),
);

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  calls.length = 0;
});

const adapter = createTelegramAdapter({ botToken: '100:test-token', mode: 'polling' });
const approve = Actions([Button({ id: 'ncq:q:0', label: 'Approve' })]);
const card = (blocks: string[], rest: CardChild[] = [approve]) =>
  Card({ title: 'Approve', children: [...blocks.map((block) => CardText(block)), ...rest] });

async function sentText(c: CardElement): Promise<string> {
  calls.length = 0;
  await adapter.postMessage('telegram:42', { card: c });
  return calls.find((call) => call.method === 'sendMessage')!.body.text!;
}

// Each `a@b.co ` renders as a 25-character mailto link, so this 1,206-character
// block, under the title, renders to exactly 4,096 characters.
const AT_LIMIT = 'a@b.co '.repeat(160) + 'x'.repeat(86);

describe('fitsTelegramMessage', () => {
  it('accepts a card that renders to exactly 4,096, which the adapter sends whole', async () => {
    expect(fitsTelegramMessage(card([AT_LIMIT]))).toBe(true);
    const text = await sentText(card([AT_LIMIT]));
    expect(text).toHaveLength(4096);
    expect(text.endsWith('x'.repeat(86))).toBe(true);
  });

  it('rejects one character more, which the adapter would cut', async () => {
    expect(fitsTelegramMessage(card([AT_LIMIT + 'x']))).toBe(false);
    expect((await sentText(card([AT_LIMIT + 'x']))).endsWith('x'.repeat(87))).toBe(false);
  });

  it('agrees with the adapter on open and decided cards of several blocks near the limit', async () => {
    const seen = new Set<boolean>();
    const decided = [CardText('Approved by admin', { style: 'muted' })];
    for (const rest of [[approve], decided]) {
      for (const cut of [7, 595, 1120]) {
        for (const tail of [60, 70, 80, 84, 86, 88, 92]) {
          const request = 'a@b.co '.repeat(160) + 'x'.repeat(tail);
          const c = card([request.slice(0, cut), request.slice(cut)], rest);
          const text = await sentText(c);
          const end = rest === decided ? 'Approved by admin' : 'x'.repeat(tail);
          const shownWhole = text.length <= 4096 && text.endsWith(end);
          expect(fitsTelegramMessage(c), `cut ${cut}, tail ${tail}`).toBe(shownWhole);
          seen.add(shownWhole);
        }
      }
    }
    expect(seen).toEqual(new Set([true, false]));
  });

  it('rejects a long escape-heavy card that a check on the bridge text would pass', async () => {
    // 2,107 characters of title plus text; MarkdownV2 escapes every dot.
    const c = card(['.'.repeat(2100)]);
    expect('Approve'.length + 2100).toBeLessThan(4096);
    expect(fitsTelegramMessage(c)).toBe(false);
    const text = await sentText(c);
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text.endsWith('\\.\\.\\.')).toBe(true);
  });

  it('rejects a button whose callback data passes 64 bytes, which the adapter refuses to send', async () => {
    // `chat:{"a":"<id>","v":"0"}` is 21 bytes plus the id.
    const button = (id: string) => Actions([Button({ id, label: 'Approve', value: '0' })]);
    expect(fitsTelegramMessage(card(['Approve?'], [button('i'.repeat(43))]))).toBe(true);
    await expect(sentText(card(['Approve?'], [button('i'.repeat(43))]))).resolves.toBeDefined();
    expect(fitsTelegramMessage(card(['Approve?'], [button('i'.repeat(44))]))).toBe(false);
    await expect(sentText(card(['Approve?'], [button('i'.repeat(44))]))).rejects.toThrow(/64 bytes/);
  });

  it('rejects a short table that the adapter would draw past the limit', () => {
    // The adapter draws tables as padded text: 875 characters render to 5,348.
    const table = `| ${'h'.repeat(60)} | h |\n|-|-|\n` + '| a | b |\n'.repeat(80);
    expect(fitsTelegramMessage(card([table]))).toBe(false);
  });
});

/** The review case: a 572-character resource and six 600-character details. */
function longGatewayCard() {
  const summary = {
    agent: 'agent',
    action: 'Post a comment',
    resource: 'POST api.example.com/' + 'r'.repeat(551),
    reason: 'The gateway policy requires human approval for this request.',
    details: Array.from({ length: 6 }, (_, i) => ({ label: `Field ${i}`, value: `D${i}${'v'.repeat(596)}E${i}` })),
  };
  return gatewayApprovalPresentation({ title: 'Credentials Request', question: '', summary } as GatewayApprovalRequest);
}

describe('Telegram approval cards through the bridge', () => {
  const bridge = createTelegramBridge()!;
  const sends = () => calls.filter((c) => c.method === 'sendMessage').map((c) => c.body);
  const buttons = (body: { reply_markup?: { inline_keyboard: unknown[][] } }) =>
    body.reply_markup?.inline_keyboard.flat() ?? [];
  const ask = (title: string, question: string) =>
    bridge.deliver('telegram:42', null, {
      kind: 'chat-sdk',
      content: {
        type: 'ask_question',
        questionId: 'appr-long-1',
        title,
        question,
        options: [{ label: 'Approve', style: 'primary' }, { label: 'Reject' }],
      },
    });

  it('posts a long gateway card in full across parts, then a short card with the buttons', async () => {
    const { title, question } = longGatewayCard();
    expect(question.length).toBeGreaterThan(4096);
    await ask(title, question);

    const messages = sends();
    const parts = messages.slice(0, -1);
    expect(parts.length).toBeGreaterThan(1);
    for (const message of messages) expect(message.text!.length).toBeLessThanOrEqual(4096);
    for (const part of parts) expect(buttons(part)).toHaveLength(0);
    expect(buttons(messages.at(-1)!)).toHaveLength(2);
    expect(messages.at(-1)!.text).toContain('appr\\-long\\-1');
    const shown = parts.map((part) => part.text).join('\n');
    for (let i = 0; i < 6; i++) expect(shown).toContain(`D${i}${'v'.repeat(596)}E${i}`);
    expect(shown).toContain('Approve once to allow this action\\.');
  });

  it('posts nothing when the request needs more parts than a card may have', async () => {
    await expect(ask('Approve', '.'.repeat(60000))).rejects.toBeInstanceOf(CardTooLongError);
    expect(sends()).toHaveLength(0);
  });
});
