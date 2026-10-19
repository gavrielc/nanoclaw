/**
 * Outbound email through the real Resend channel: registration factory, Chat SDK
 * bridge, and the installed `@resend/chat-sdk-adapter`, with only Resend's HTTP
 * API stubbed. Email is non-threaded, so the router hands `deliver()` a null
 * thread id and the platform id `resend:<address>`, which is not one of the
 * adapter's own thread ids.
 */
import crypto from 'crypto';

import type { Chat } from 'chat';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChannelAdapter, InboundMessage } from './adapter.js';

const { WEBHOOK_SECRET } = vi.hoisted(() => ({
  WEBHOOK_SECRET: `whsec_${Buffer.from('resend-test-signing-key').toString('base64')}`,
}));

vi.mock('../env.js', () => ({
  readEnvFile: () => ({
    RESEND_API_KEY: 're_test_key',
    RESEND_FROM_ADDRESS: 'bot@mail.example.com',
    RESEND_FROM_NAME: 'NanoClaw',
    RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET,
  }),
}));

vi.mock('../webhook-server.js', () => ({
  registerWebhookAdapter: vi.fn(),
}));

import { resendRegistration } from './resend.js';

interface SentEmail {
  to: string[];
  subject: string;
  text: string;
  headers?: Record<string, string>;
}

const INBOUND_EMAIL = {
  id: 'inbound-1',
  object: 'email',
  from: 'Owner <owner@example.com>',
  to: ['bot@mail.example.com'],
  subject: 'Weekly plan',
  text: 'Can you draft the weekly plan?',
  html: null,
  message_id: '<root-1@example.com>',
  headers: {},
  attachments: [],
  created_at: '2026-10-19T10:00:00.000Z',
};

let sent: SentEmail[];

function stubResendApi(): void {
  sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/emails') && init?.method === 'POST') {
        sent.push(JSON.parse(String(init.body)) as SentEmail);
        return Response.json({ id: `sent-${sent.length}` });
      }
      if (url.endsWith(`/emails/receiving/${INBOUND_EMAIL.id}`)) return Response.json(INBOUND_EMAIL);
      return new Response('{"message":"unexpected request"}', { status: 404 });
    }),
  );
}

/** A webhook request signed the way Resend (svix) signs it. */
function signedWebhook(): Request {
  const body = JSON.stringify({
    type: 'email.received',
    created_at: INBOUND_EMAIL.created_at,
    data: { email_id: INBOUND_EMAIL.id, attachments: [] },
  });
  const id = 'msg_test_1';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(WEBHOOK_SECRET.slice('whsec_'.length), 'base64');
  const signature = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return new Request('https://host.example.com/webhook/resend', {
    method: 'POST',
    headers: { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` },
    body,
  });
}

describe('resend channel delivery', () => {
  let bridge: ChannelAdapter;
  let inbound: Array<{ platformId: string; message: InboundMessage }>;

  beforeEach(async () => {
    const { initTestDb } = await import('../db/connection.js');
    const { runMigrations } = await import('../db/migrations/index.js');
    await runMigrations(await initTestDb());
    stubResendApi();
    inbound = [];
    bridge = (await resendRegistration.factory())!;
    await bridge.setup({
      onInbound: (platformId, _threadId, message) => {
        inbound.push({ platformId, message });
      },
      onInboundEvent: () => {},
      onMetadata: () => {},
      onAction: () => {},
    });
  });

  afterEach(async () => {
    await bridge.teardown();
    vi.unstubAllGlobals();
    const { closeDb } = await import('../db/connection.js');
    await closeDb();
  });

  it('sends to a platform id with no thread (the "Connect yourself" hello)', async () => {
    const id = await bridge.deliver('resend:owner@example.com', null, {
      kind: 'chat',
      content: { text: 'Hi, I am your assistant.' },
    });

    expect(id).toBe('sent-1');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['owner@example.com']);
    expect(sent[0].text).toContain('Hi, I am your assistant.');
  });

  it('replies inside the email thread the person last wrote in', async () => {
    const { registerWebhookAdapter } = await import('../webhook-server.js');
    const chat = vi.mocked(registerWebhookAdapter).mock.calls.at(-1)![0] as Chat;
    const handler = (chat.webhooks as Record<string, (r: Request) => Promise<Response>>).resend;

    expect((await handler(signedWebhook())).status).toBe(200);
    await vi.waitFor(() => expect(inbound).toHaveLength(1));
    expect(inbound[0].platformId).toBe('resend:owner@example.com');

    await bridge.deliver(inbound[0].platformId, null, { kind: 'chat', content: { text: 'Here is the plan.' } });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['owner@example.com']);
    expect(sent[0].subject).toBe('Re: Weekly plan');
    expect(sent[0].headers?.['In-Reply-To']).toBe('<root-1@example.com>');
  });

  it('keeps later sends to the same person in one thread', async () => {
    await bridge.deliver('resend:owner@example.com', null, { kind: 'chat', content: { text: 'First.' } });
    await bridge.deliver('resend:owner@example.com', null, { kind: 'chat', content: { text: 'Second.' } });

    expect(sent).toHaveLength(2);
    const root = sent[0].headers?.['In-Reply-To'];
    expect(root).toBeDefined();
    expect(sent[1].headers?.References?.split(' ')).toContain(root);
  });
});
