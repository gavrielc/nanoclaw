/**
 * A late click on a decided approval, end to end: the real approvals response
 * handler behind the real bridge. While an approved action is still being
 * applied (row `approved`, not yet deleted), a stale Deny must leave the card
 * showing the approval: the host does not accept it, so the card never changes.
 */
import * as fs from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Adapter, CardElement } from 'chat';

const TEST_DIR = '/tmp/nanoclaw-test-late-click';

vi.mock('../container-runner.js', () => ({ wakeContainer: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../config.js', async () => ({
  ...(await vi.importActual('../config.js')),
  DATA_DIR: '/tmp/nanoclaw-test-late-click',
}));
vi.mock('../webhook-server.js', () => ({ registerWebhookAdapter: vi.fn() }));

import { closeDb, createAgentGroup, initTestDb, runMigrations } from '../db/index.js';
import { createPendingApproval, createSession, getPendingApproval } from '../db/sessions.js';
import { registerApprovalHandler } from '../modules/approvals/primitive.js';
import { handleApprovalsResponse } from '../modules/approvals/response-handler.js';
import { grantRole } from '../modules/permissions/db/user-roles.js';
import { upsertUser } from '../modules/permissions/db/users.js';
import { dispatchResponse, registerResponseHandler } from '../response-registry.js';
import { createChatSdkBridge } from './chat-sdk-bridge.js';

registerResponseHandler(handleApprovalsResponse);

const BOT_TOKEN = 'bot-token';
const realFetch = globalThis.fetch;
const now = () => new Date().toISOString();
const cardText = (call: unknown[]) => JSON.stringify((call[2] as { card: CardElement }).card);

let finishInstall!: () => void;
const install = vi.fn(
  () =>
    new Promise<void>((resolve) => {
      finishInstall = resolve;
    }),
);
registerApprovalHandler('install_packages_late_click', install);

/** The host side, as src/index.ts wires it. */
const onAction = (questionId: string, value: string, userId: string, address?: { messageId?: string }) =>
  dispatchResponse({
    questionId,
    value,
    userId,
    channelType: 'telegram',
    messageId: address?.messageId,
    platformId: 'dm-owner',
    threadId: null,
  });

beforeEach(async () => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
  await runMigrations(await initTestDb());
  install.mockClear();
  await createAgentGroup({ id: 'ag-1', name: 'Agent', folder: 'agent', agent_provider: null, created_at: now() });
  await createSession({
    id: 'sess-1',
    agent_group_id: 'ag-1',
    messaging_group_id: null,
    thread_id: null,
    agent_provider: null,
    status: 'active',
    container_status: 'stopped',
    last_active: now(),
    created_at: now(),
  });
  await upsertUser({ id: 'telegram:owner', kind: 'telegram', display_name: 'Owner', created_at: now() });
  await grantRole({
    user_id: 'telegram:owner',
    role: 'owner',
    agent_group_id: null,
    granted_by: null,
    granted_at: now(),
  });
});

afterEach(async () => {
  finishInstall?.();
  vi.unstubAllGlobals();
  await closeDb();
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

async function seedApproval(approvalId: string) {
  await createPendingApproval({
    approval_id: approvalId,
    session_id: 'sess-1',
    request_id: approvalId,
    action: 'install_packages_late_click',
    payload: JSON.stringify({ packages: ['left-pad'] }),
    created_at: now(),
    title: 'Install packages',
    question: 'Install left-pad?',
    options_json: JSON.stringify([
      { label: 'Approve', selectedLabel: '✅ Approved', value: 'approve' },
      { label: 'Deny', selectedLabel: '❌ Denied', value: 'reject' },
    ]),
  });
}

describe('a late Deny while an approved action is still being applied', () => {
  it('Chat SDK path: the card stays approved, with no second edit', async () => {
    await seedApproval('appr-late-sdk');
    const editMessage = vi.fn(async () => ({ id: 'card-1', threadId: 'telegram:dm-owner', raw: {} }));
    const adapter = {
      name: 'telegram',
      initialize: async () => {},
      channelIdFromThreadId: (threadId: string) => threadId,
      editMessage,
    } as unknown as Adapter;
    const bridge = createChatSdkBridge({ adapter, instance: 'telegram-late', supportsThreads: false });
    await bridge.setup({ onInbound: () => {}, onInboundEvent: () => {}, onMetadata: () => {}, onAction });
    const chat = (bridge as unknown as { _chat: import('chat').Chat })._chat;
    const click = (index: number, messageId: string) =>
      chat.processAction(
        {
          actionId: `ncq:appr-late-sdk:${index}`,
          adapter,
          messageId,
          raw: {},
          threadId: 'telegram:dm-owner',
          user: { userId: 'owner', userName: 'owner' } as never,
          value: String(index),
        },
        undefined,
      );
    try {
      await click(0, 'card-1');
      expect(install).toHaveBeenCalledTimes(1);
      expect(editMessage).toHaveBeenCalledTimes(1);
      expect(cardText(editMessage.mock.calls[0])).toContain('✅ Approved by owner');
      expect((await getPendingApproval('appr-late-sdk'))?.status).toBe('approved');

      // The install is still running; stale Deny clicks: the same card, and a copy of it.
      await click(1, 'card-1');
      await click(1, 'card-1-copy');

      expect(editMessage).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(editMessage.mock.calls)).not.toContain('Denied');
      expect((await getPendingApproval('appr-late-sdk'))?.status).toBe('approved');
      finishInstall();
      await vi.waitFor(async () => expect(await getPendingApproval('appr-late-sdk')).toBeUndefined());
      expect(install).toHaveBeenCalledTimes(1);
    } finally {
      await bridge.teardown();
    }
  });

  it('Discord gateway path: the card stays approved, with no second edit', async () => {
    await seedApproval('appr-late-discord');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    let webhookUrl = '';
    const editMessage = vi.fn(async () => ({ id: 'card-1', threadId: 't', raw: {} }));
    const adapter = {
      name: 'discord',
      initialize: async () => {},
      handleWebhook: vi.fn(async () => new Response('ok')),
      channelIdFromThreadId: (threadId: string) => threadId,
      encodeThreadId: ({ guildId, channelId }: { guildId: string; channelId: string }) =>
        `discord:${guildId}:${channelId}`,
      editMessage,
      startGatewayListener: async (_opts: unknown, _ms: number, _signal: AbortSignal, url: string) => {
        webhookUrl = url;
        return new Response('{}');
      },
    } as unknown as Adapter;
    const bridge = createChatSdkBridge({ adapter, supportsThreads: true, botToken: BOT_TOKEN });
    await bridge.setup({ onInbound: () => {}, onInboundEvent: () => {}, onMetadata: () => {}, onAction });
    await vi.waitFor(() => expect(webhookUrl).not.toBe(''));
    const click = (index: number, messageId: string) =>
      realFetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-discord-gateway-token': BOT_TOKEN },
        body: JSON.stringify({
          type: 'GATEWAY_INTERACTION_CREATE',
          data: {
            type: 3,
            id: 'interaction-1',
            token: 'interaction-token',
            application_id: 'app-1',
            guild_id: 'G1',
            channel_id: 'C1',
            data: { custom_id: `ncq:appr-late-discord:${index}\n${index}` },
            member: { user: { id: 'owner', username: 'owner' } },
            message: { id: messageId, embeds: [{ title: 'Install packages', description: 'Install left-pad?' }] },
          },
        }),
      });
    const patches = () =>
      vi
        .mocked(globalThis.fetch)
        .mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
    try {
      await click(0, 'card-1');
      await vi.waitFor(() => expect(editMessage).toHaveBeenCalledTimes(1));
      expect(cardText(editMessage.mock.calls[0])).toContain('✅ Approved by owner');
      expect((await getPendingApproval('appr-late-discord'))?.status).toBe('approved');

      await click(1, 'card-1');
      await click(1, 'card-1-copy');
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(editMessage).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(editMessage.mock.calls)).not.toContain('Denied');
      expect(patches()).toHaveLength(1);
      expect((await getPendingApproval('appr-late-discord'))?.status).toBe('approved');
      finishInstall();
      await vi.waitFor(async () => expect(await getPendingApproval('appr-late-discord')).toBeUndefined());
      expect(install).toHaveBeenCalledTimes(1);
    } finally {
      await bridge.teardown();
    }
  });
});
