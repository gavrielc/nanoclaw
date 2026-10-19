import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { closeSessionDb, getInboundDb, initTestSessionDb } from './mailbox/sqlite/connection.js';
import { getUndeliveredMessages } from './db/messages-out.js';
import { processQuery, runPollLoop } from './poll-loop.js';
import type { AgentProvider, AgentQuery, PromptAttachment, ProviderEvent, QueryInput } from './providers/types.js';

// Structured attachments must ride both ways a batch reaches a provider: the
// opening query() and a follow-up push() into an active query.

beforeEach(() => {
  initTestSessionDb();
  getInboundDb()
    .prepare(
      `INSERT INTO destinations (name, display_name, type, channel_type, platform_id, agent_group_id)
       VALUES ('discord-test', 'Discord Test', 'channel', 'discord', 'chan-1', NULL)`,
    )
    .run();
});

afterEach(() => {
  closeSessionDb();
});

function insertPhoto(id: string): void {
  getInboundDb()
    .prepare(
      `INSERT INTO messages_in (id, kind, timestamp, status, platform_id, channel_type, content)
       VALUES (?, 'chat', datetime('now'), 'pending', 'chan-1', 'discord', ?)`,
    )
    .run(
      id,
      JSON.stringify({
        sender: 'Alice',
        text: 'what is this?',
        attachments: [{ type: 'image', name: 'cat.png', mimeType: 'image/png', localPath: `inbox/${id}/cat.png` }],
      }),
    );
}

function photo(id: string): PromptAttachment {
  return {
    sourceMessageId: id,
    filename: 'cat.png',
    mime: 'image/png',
    path: `/workspace/inbox/${id}/cat.png`,
  };
}

class RecordingProvider implements AgentProvider {
  inputs: QueryInput[] = [];

  registerMemorySessionHook(): void {}

  isSessionInvalid(): boolean {
    return false;
  }

  query(input: QueryInput): AgentQuery {
    this.inputs.push(input);
    let end: (() => void) | undefined;
    const ended = new Promise<void>((resolve) => {
      end = resolve;
    });
    const events: AsyncIterable<ProviderEvent> = {
      async *[Symbol.asyncIterator]() {
        yield { type: 'init', continuation: 'rec-session' };
        yield { type: 'result', text: '<message to="discord-test">seen</message>' };
        await ended;
      },
    };
    return { push() {}, end: () => end?.(), events, abort: () => end?.() };
  }
}

describe('structured attachments reach the provider', () => {
  it('on the opening query', async () => {
    insertPhoto('m-first');
    const provider = new RecordingProvider();
    const controller = new AbortController();
    const loop = runPollLoop({ provider, providerName: 'recording', cwd: '/tmp', signal: controller.signal }).catch(
      () => {},
    );
    const start = Date.now();
    while (getUndeliveredMessages().length === 0 && Date.now() - start < 3000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    controller.abort();
    await loop;

    expect(provider.inputs).toHaveLength(1);
    expect(provider.inputs[0].attachments).toEqual([photo('m-first')]);
  });

  it('on a follow-up pushed into an active query', async () => {
    const pushes: Array<{ message: string; attachments?: PromptAttachment[] }> = [];
    async function* events(): AsyncGenerator<ProviderEvent> {
      yield { type: 'init', continuation: 'sess-1' };
      insertPhoto('m-follow');
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    const query: AgentQuery = {
      push: (message, attachments) => {
        pushes.push({ message, attachments });
      },
      end: () => {},
      events: events(),
      abort: () => {},
    };
    const routing = { platformId: 'chan-1', channelType: 'discord', threadId: null, inReplyTo: 'm1' };

    await processQuery(query, routing, [], 'recording', undefined, 'prompt', undefined);

    expect(pushes).toHaveLength(1);
    expect(pushes[0].message).toContain('cat.png');
    expect(pushes[0].attachments).toEqual([photo('m-follow')]);
  });
});
