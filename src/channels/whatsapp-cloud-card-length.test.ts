/**
 * WhatsApp Cloud card fit against the real @chat-adapter/whatsapp: only fetch
 * is stubbed, so the test sees the exact messages the adapter sends. A card
 * with reply buttons is an interactive message (60-character header,
 * 1,024-character body, both cut); any other card is a text message, split
 * past 4,096.
 */
import { createWhatsAppAdapter } from '@chat-adapter/whatsapp';
import { Actions, Button, Card, CardText, type CardChild, type CardElement } from 'chat';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../env.js', () => ({
  readEnvFile: () => ({
    WHATSAPP_ACCESS_TOKEN: 'test-access-token',
    WHATSAPP_PHONE_NUMBER_ID: 'test-phone-number-id',
    WHATSAPP_APP_SECRET: 'test-app-secret',
    WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
  }),
}));

import { gatewayApprovalPresentation } from '../gateway-approval-presentation.js';
import type { GatewayApprovalRequest } from '../gateway-providers/gateway-provider-registry.js';
import type { ChannelAdapter } from './adapter.js';
import { CardTooLongError } from './ask-question.js';
import { fitsWhatsAppCard, whatsappCloudRegistration } from './whatsapp-cloud.js';

interface Sent {
  type?: string;
  text?: { body: string };
  interactive?: { header?: { text: string }; body: { text: string } };
}

const sent: Sent[] = [];

vi.stubGlobal(
  'fetch',
  vi.fn(async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }), { status: 200 });
  }),
);

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  sent.length = 0;
});

const adapter = createWhatsAppAdapter({
  accessToken: 'test-access-token',
  phoneNumberId: 'test-phone-number-id',
  appSecret: 'test-app-secret',
  verifyToken: 'test-verify-token',
});
const approve = Actions([Button({ id: 'ncq:q:0', label: 'Approve' })]);
const card = (title: string, blocks: string[], rest: CardChild[] = [approve]) =>
  Card({ title, children: [...blocks.map((block) => CardText(block)), ...rest] });

async function post(c: CardElement): Promise<Sent[]> {
  sent.length = 0;
  await adapter.postMessage('whatsapp:test-phone-number-id:15550001111', { card: c });
  return [...sent];
}

describe('fitsWhatsAppCard with reply buttons', () => {
  it('accepts a 60-character title and a 1,024-character body, which the adapter sends whole', async () => {
    const c = card('T'.repeat(60), ['a'.repeat(500), 'b'.repeat(523)]);
    expect(fitsWhatsAppCard(c)).toBe(true);
    const [message] = await post(c);
    expect(message.interactive?.header?.text).toBe('T'.repeat(60));
    expect(message.interactive?.body.text).toBe(`${'a'.repeat(500)}\n${'b'.repeat(523)}`);
  });

  it('rejects a 61-character title or a 1,025-character body, which the adapter would cut', async () => {
    expect(fitsWhatsAppCard(card('T'.repeat(61), ['Approve?']))).toBe(false);
    const long = card('Approve', ['a'.repeat(500), 'b'.repeat(524)]);
    expect(fitsWhatsAppCard(long)).toBe(false);
    expect((await post(long))[0].interactive?.body.text.endsWith('…')).toBe(true);
  });
});

describe('fitsWhatsAppCard without reply buttons', () => {
  it('rejects a long escape-heavy part that a check on the bridge text would pass', async () => {
    // 2,100 characters of text; WhatsApp markup escaping doubles every `*`.
    const c = card('Request ref appr-1, part 1 of 2', ['*'.repeat(2100)], []);
    expect(fitsWhatsAppCard(c)).toBe(false);
    expect(await post(c)).toHaveLength(2);
  });

  it('agrees with the adapter on text messages near the limit, decided cards included', async () => {
    const seen = new Set<boolean>();
    const decided = [CardText('Approved by admin', { style: 'muted' })];
    for (const rest of [[], decided]) {
      for (const size of [4000, 4040, 4060, 4066, 4067, 4080, 4100]) {
        // `*` is escaped, so each `*x` counts three characters.
        const c = card('Request ref abc123, part 1', ['*x'.repeat(600), 'y'.repeat(size - 1800 - 34)], rest);
        const oneMessage = (await post(c)).length === 1;
        expect(fitsWhatsAppCard(c), `size ${size}`).toBe(oneMessage);
        seen.add(oneMessage);
      }
    }
    expect(seen).toEqual(new Set([true, false]));
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

describe('WhatsApp Cloud approval cards through the bridge', () => {
  let bridge: ChannelAdapter;
  const ask = async (title: string, question: string) => {
    bridge ??= (await whatsappCloudRegistration.factory())!;
    return bridge.deliver('whatsapp:test-phone-number-id:15550001111', null, {
      kind: 'chat-sdk',
      content: {
        type: 'ask_question',
        questionId: 'appr-long-1',
        title,
        question,
        options: [{ label: 'Approve', style: 'primary' }, { label: 'Reject' }],
      },
    });
  };

  it('posts a long gateway card in full as text messages, then a short card with the buttons', async () => {
    const { title, question } = longGatewayCard();
    expect(question.length).toBeGreaterThan(1024);
    await ask(title, question);

    const parts = sent.slice(0, -1);
    const card = sent.at(-1)!;
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.type).toBe('text');
      expect(part.text!.body.length).toBeLessThanOrEqual(4096);
    }
    expect(card.type).toBe('interactive');
    expect(card.interactive!.body.text).toContain('appr-long-1');
    expect(card.interactive!.body.text.endsWith('…')).toBe(false);
    const shown = parts.map((part) => part.text!.body).join('\n');
    for (let i = 0; i < 6; i++) expect(shown).toContain(`D${i}${'v'.repeat(596)}E${i}`);
    expect(shown).toContain('Approve once to allow this action.');
  });

  it('posts nothing when the request needs more parts than a card may have', async () => {
    await expect(ask('Approve', 'x'.repeat(100000))).rejects.toBeInstanceOf(CardTooLongError);
    expect(sent).toHaveLength(0);
  });
});
