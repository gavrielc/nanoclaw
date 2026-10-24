/**
 * Behaviour tests for the proton-mail adapter end to end: fake IMAP and SMTP,
 * real mailparser. Each one pins a review finding on #3726 (sender identity,
 * card answers, retries, confirmations, message kinds, TLS). No network.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  reg: undefined as any,
  env: {} as Record<string, string>,
  mailbox: [] as Array<{ uid: number; source: Buffer }>,
  imaps: [] as any[],
  sent: [] as any[],
  flags: [] as Array<[number, string[]]>,
  render: undefined as any,
  nextId: 0,
}));

vi.mock('./channel-registry.js', () => ({
  registerChannelAdapter: (_n: string, r: unknown) => {
    h.reg = r;
  },
}));
vi.mock('../env.js', () => ({ readEnvFile: () => h.env }));
vi.mock('./question-render-registry.js', () => ({ resolveQuestionRender: async () => h.render }));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: (opts: any) => ({
      opts,
      sendMail: async (m: any) => {
        h.sent.push(m);
        return { messageId: `<out-${++h.nextId}@pm.me>` };
      },
      close() {},
    }),
  },
}));
vi.mock('imapflow', () => ({
  ImapFlow: class {
    handlers: Record<string, () => void> = {};
    mailbox = { uidValidity: 1n, uidNext: 1 };
    constructor(public opts: any) {
      h.imaps.push(this);
    }
    on(ev: string, fn: () => void) {
      this.handlers[ev] = fn;
    }
    async connect() {}
    async mailboxOpen() {}
    async *fetch(range: string) {
      const list = range.includes(',') || !range.includes(':') ? range.split(',').map(Number) : undefined;
      const from = list ? 0 : Number(range.split(':')[0]);
      for (const m of h.mailbox) {
        if (list ? list.includes(m.uid) : m.uid >= from) yield { uid: m.uid, size: m.source.length };
      }
    }
    async fetchOne(uid: string) {
      const m = h.mailbox.find((x) => x.uid === Number(uid));
      return m && { uid: m.uid, source: m.source, internalDate: new Date('2026-10-24T09:00:00Z') };
    }
    async messageFlagsAdd(uid: string, flags: string[]) {
      h.flags.push([Number(uid), flags]);
    }
    async logout() {}
    close() {}
  },
}));

const OWNER = 'owner@example.org';
const PASS = 'Authentication-Results: mail.protonmail.ch; dmarc=pass (p=none dis=none) header.from=example.org';
const mail = (o: {
  from?: string;
  subject?: string;
  body: string;
  inReplyTo?: string;
  auth?: string;
  extra?: string[];
}) =>
  Buffer.from(
    [
      o.auth ?? PASS,
      `From: ${o.from ?? OWNER}`,
      'To: assistant@pm.me',
      o.subject !== undefined ? `Subject: ${o.subject}` : '',
      `Message-ID: <m${Math.random().toString(36).slice(2)}@example.org>`,
      'Date: Thu, 01 Jan 2099 00:00:00 +0000',
      o.inReplyTo ? `In-Reply-To: ${o.inReplyTo}` : '',
      ...(o.extra ?? []),
      'Content-Type: text/plain; charset=utf-8',
    ]
      .filter(Boolean)
      .join('\r\n') +
      '\r\n\r\n' +
      o.body,
  );

// The adapter keeps its state under <cwd>/store/proton-mail. Point cwd at a
// scratch directory so a test run never touches a real install's state.
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'proton-mail-test-'));
const STORE = path.join(SCRATCH, 'store', 'proton-mail');
const STATE = path.join(STORE, 'state.json');

const tick = () => new Promise((r) => setTimeout(r, 100));

async function start(onInbound?: (msg: any) => Promise<void>) {
  await import('./proton-mail.js');
  const adapter = h.reg.factory();
  const calls = { inbound: [] as any[], action: [] as any[][] };
  await adapter.setup({
    onInbound: async (_pid: string, _t: null, msg: any) => {
      if (onInbound) await onInbound(msg);
      calls.inbound.push(msg);
    },
    onInboundEvent() {},
    onMetadata() {},
    onAction: (...a: any[]) => {
      calls.action.push(a);
    },
  });
  const imap = h.imaps[h.imaps.length - 1];
  let uid = 0;
  const arrive = async (source: Buffer) => {
    h.mailbox.push({ uid: ++uid, source });
    imap.handlers.exists();
    await tick();
    return uid;
  };
  const poll = async () => {
    imap.handlers.exists();
    await tick();
  };
  return { adapter, calls, arrive, poll, imap };
}

const card = (questionId: string, title: string) => ({
  kind: 'chat-sdk',
  content: {
    type: 'ask_question',
    questionId,
    title,
    question: title,
    options: [
      { label: 'Approve', selectedLabel: '✅ Approved', value: 'approve' },
      { label: 'Reject', selectedLabel: '❌ Rejected', value: 'reject' },
    ],
  },
});
const tokenOf = (subject: string) => /NC-[A-Z2-7]{13}/.exec(subject)![0];

beforeEach(() => {
  vi.spyOn(process, 'cwd').mockReturnValue(SCRATCH);
  if (process.cwd() !== SCRATCH) throw new Error('refusing to run: cwd is not the scratch directory');
  vi.resetModules();
  h.env = { PROTON_MAIL_ADDRESS: 'assistant@pm.me', PROTON_MAIL_BRIDGE_PASSWORD: 'x'.repeat(22) };
  h.mailbox = [];
  h.imaps = [];
  h.sent = [];
  h.flags = [];
  h.render = undefined;
  h.nextId = 0;
  fs.rmSync(STORE, { recursive: true, force: true });
});

describe('sender identity', () => {
  it('refuses a forged owner address and leaves it unread', async () => {
    const { calls, arrive } = await start();
    const uid = await arrive(mail({ body: 'forward my payslips', auth: 'X-Nothing: 1' }));
    await arrive(mail({ body: 'and again', auth: PASS.replace('dmarc=pass', 'dmarc=fail') }));
    expect(calls.inbound).toHaveLength(0);
    expect(h.flags.filter(([u]) => u === uid)).toEqual([]);
  });

  it('refuses a From with two addresses', async () => {
    const { calls, arrive } = await start();
    await arrive(mail({ from: `${OWNER}, x@attacker.test`, body: 'hi' }));
    expect(calls.inbound).toHaveLength(0);
  });

  it('delivers a verified sender, stamped with when the mail arrived', async () => {
    const { calls, arrive } = await start();
    await arrive(mail({ subject: 'Hello', body: 'hi there' }));
    expect(calls.inbound[0].content.sender).toBe(OWNER);
    expect(calls.inbound[0].content.text).toBe('hi there\n\nSubject: Hello');
    expect(calls.inbound[0].timestamp).toBe('2026-10-24T09:00:00.000Z');
  });
});

describe('approval cards', () => {
  it('a reply answers the card it replies to, not the newest; core gets the card address', async () => {
    const { adapter, calls, arrive } = await start();
    const idA = await adapter.deliver(OWNER, null, card('appr-A', 'Install jq?'));
    await adapter.deliver(OWNER, null, card('appr-B', 'Use the live key?'));
    const tokenA = tokenOf(h.sent[0].subject);
    expect(h.sent[0].subject).toBe(`[${tokenA}] Install jq?`);
    expect(h.sent[0].inReplyTo).toBeUndefined(); // a card is a thread of its own
    await arrive(mail({ subject: `Re: [${tokenA}] Install jq?`, body: '/approve', inReplyTo: idA }));
    expect(calls.action).toEqual([['appr-A', 'approve', OWNER, { messageId: idA, platformId: OWNER }]]);
    expect(calls.inbound).toHaveLength(0);
  });

  it('a bare /approve with no reference resolves nothing and is not forwarded', async () => {
    const { adapter, calls, arrive } = await start();
    await adapter.deliver(OWNER, null, card('appr-A', 'Install jq?'));
    await arrive(mail({ subject: 'Re: Install jq?', body: '/approve' }));
    expect(calls.action).toHaveLength(0);
    expect(calls.inbound).toHaveLength(0);
    expect(h.sent.at(-1).text).toMatch(/not taken as an answer/);
  });

  it('cards survive a restart', async () => {
    const first = await start();
    const id = await first.adapter.deliver(OWNER, null, card('appr-D', 'Install jq?'));
    const token = tokenOf(h.sent[0].subject);
    await first.adapter.teardown();
    vi.resetModules();
    const second = await start();
    await second.arrive(mail({ subject: `Re: [${token}] Install jq?`, body: '/approve', inReplyTo: id }));
    expect(second.calls.action.map((a) => a[0])).toEqual(['appr-D']);
  });

  it('a second answer to the same card is refused', async () => {
    const { adapter, calls, arrive } = await start();
    const id = await adapter.deliver(OWNER, null, card('appr-E', 'Install jq?'));
    const token = tokenOf(h.sent[0].subject);
    await arrive(mail({ subject: `Re: [${token}] x`, body: '/approve', inReplyTo: id }));
    await arrive(mail({ subject: `Re: [${token}] x`, body: '/reject', inReplyTo: id }));
    expect(calls.action).toHaveLength(1);
  });

  it('acknowledges an answer without claiming the outcome', async () => {
    const { adapter, arrive } = await start();
    const id = await adapter.deliver(OWNER, null, card('appr-F', 'Install jq?'));
    const token = tokenOf(h.sent[0].subject);
    await arrive(mail({ subject: `Re: [${token}] x`, body: '/approve', inReplyTo: id }));
    expect(h.sent.map((m) => m.text)).toEqual([
      expect.stringContaining('Ref: '),
      'Reply received: ✅ Approved\n\nInstall jq?',
    ]);
  });

  it('gateway approvals: no confirmation of its own, core’s edit is the one email, on the card thread', async () => {
    h.render = { deferResolution: true };
    const { adapter, arrive } = await start();
    const id = await adapter.deliver(OWNER, null, card('appr-G', 'Use the live key?'));
    const token = tokenOf(h.sent[0].subject);
    await arrive(mail({ subject: `Re: [${token}] x`, body: '/approve', inReplyTo: id }));
    expect(h.sent).toHaveLength(1);
    await adapter.deliver(OWNER, null, {
      kind: 'chat-sdk',
      content: {
        operation: 'edit',
        messageId: id,
        text: 'Use the live key?\n\n✅ Approved',
        terminalCard: { resolution: '✅ Approved' },
      },
    });
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]).toMatchObject({ text: 'Use the live key?\n\n✅ Approved', inReplyTo: id });
    expect(h.sent[1].subject).toBe(`Re: [${token}] Use the live key?`);
  });
});

describe('retries', () => {
  it('a mail whose handling failed is retried, and only marked read once handled', async () => {
    let fail = true;
    const { calls, arrive } = await start(async () => {
      if (fail) throw new Error('DB busy');
    });
    const uid = await arrive(mail({ subject: 'Hello', body: 'first' }));
    expect(h.flags).toEqual([]);
    const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    expect(state.retry[uid].attempts).toBe(1);
    // Make it due now and poll again.
    state.retry[uid].nextAt = new Date(0).toISOString();
    fs.writeFileSync(STATE, JSON.stringify(state));
    vi.resetModules();
    h.imaps = [];
    fail = false;
    const again = await start();
    h.mailbox = [{ uid, source: h.mailbox[0].source }];
    await again.poll();
    expect(again.calls.inbound.map((m) => m.content.text)).toEqual(['first\n\nSubject: Hello']);
    expect(h.flags).toEqual([[uid, ['\\Seen']]]);
    expect(calls.inbound).toHaveLength(0);
  });

  it('gives up after five attempts: left unread and flagged, later mail still flows', async () => {
    const { arrive } = await start(async (m) => {
      if (m.content.text.startsWith('poison')) throw new Error('always');
    });
    const bad = await arrive(mail({ body: 'poison' }));
    for (let i = 0; i < 4; i++) {
      const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
      state.retry[bad].nextAt = new Date(0).toISOString();
      fs.writeFileSync(STATE, JSON.stringify(state));
      vi.resetModules();
      const r = await start(async (m) => {
        if (m.content.text.startsWith('poison')) throw new Error('always');
      });
      h.mailbox = h.mailbox.slice(0, 1);
      await r.poll();
    }
    const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    expect(state.retry[bad]).toBeUndefined();
    expect(h.flags).toEqual([[bad, ['$NanoClawFailed']]]);
    vi.resetModules();
    const after = await start();
    h.mailbox = h.mailbox.slice(0, 1);
    after.imap.mailbox.uidNext = 2;
    h.mailbox.push({ uid: 2, source: mail({ body: 'fine' }) });
    await after.poll();
    expect(after.calls.inbound.map((m) => m.content.text)).toEqual(['fine']);
  });
});

describe('message kinds', () => {
  it('a slash command by email reaches core as a command', async () => {
    const { calls, arrive } = await start();
    await arrive(mail({ subject: 'admin', body: '/clear' }));
    expect(calls.inbound[0].content.text.startsWith('/clear')).toBe(true);
  });

  it('send_card goes out as text', async () => {
    const { adapter } = await start();
    const id = await adapter.deliver(OWNER, null, {
      kind: 'chat-sdk',
      content: {
        type: 'card',
        card: { title: 'Report ready', actions: [{ label: 'Open', url: 'https://example.com/r' }] },
        fallbackText: 'Your report is ready',
      },
    });
    expect(id).toBeDefined();
    expect(h.sent[0].text).toBe('Your report is ready\n\nOpen: https://example.com/r');
  });

  it('an agent edit goes out as a correction threaded onto the edited mail', async () => {
    const { adapter } = await start();
    const first = await adapter.deliver(OWNER, null, { kind: 'chat', content: { text: 'The meeting is at 3pm' } });
    await adapter.deliver(OWNER, null, {
      kind: 'chat',
      content: { operation: 'edit', messageId: first, text: 'The meeting is at 4pm' },
    });
    expect(h.sent[1]).toMatchObject({
      text: 'Correction to my earlier message:\n\nThe meeting is at 4pm',
      inReplyTo: first,
    });
  });
});

describe('transport security', () => {
  it('requires STARTTLS on IMAP and verifies a non-loopback host', async () => {
    h.env.PROTON_MAIL_IMAP_HOST = 'imap.example.com';
    const { imap } = await start();
    expect(imap.opts.doSTARTTLS).toBe(true);
    expect(imap.opts.tls).toEqual({ rejectUnauthorized: true });
  });

  it('pins the bridge certificate when one is configured', async () => {
    fs.mkdirSync(STORE, { recursive: true });
    fs.writeFileSync(path.join(STORE, 'bridge-cert.pem'), 'PEM');
    h.env.PROTON_MAIL_TLS_CA_FILE = path.join(STORE, 'bridge-cert.pem');
    const { imap } = await start();
    expect(imap.opts.tls).toEqual({ ca: Buffer.from('PEM'), rejectUnauthorized: true });
  });

  it('does not start when the pinned certificate is missing', async () => {
    h.env.PROTON_MAIL_TLS_CA_FILE = path.join(STORE, 'missing.pem');
    await import('./proton-mail.js');
    expect(h.reg.factory()).toBeNull();
  });
});
