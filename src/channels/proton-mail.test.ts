/**
 * Unit tests for the proton-mail adapter's pure helpers — the parts that decide
 * what reaches the agent (quote stripping, auto-reply filtering) and how replies
 * thread back (subjects, slash-command answers). No network.
 */
import { describe, it, expect } from 'vitest';

import {
  cardSubject,
  checkSenderAuth,
  classifyAttachment,
  frameInbound,
  isLoopbackHost,
  matchCardReply,
  newCardToken,
  renderCardText,
  retryDelayMs,
  singleSender,
  tlsOptions,
  type CardRef,
  htmlToText,
  matchCommandReply,
  normalizeAddress,
  optionToCommand,
  renderAskQuestion,
  replySubject,
  shouldSkipInbound,
  stripQuotedReply,
} from './proton-mail.js';
import { normalizeOptions } from './ask-question.js';

describe('normalizeAddress', () => {
  it('lowercases and trims', () => {
    expect(normalizeAddress('  Someone@Example.COM ')).toBe('someone@example.com');
  });
});

describe('replySubject', () => {
  it('prefixes Re: once', () => {
    expect(replySubject('Hello')).toBe('Re: Hello');
    expect(replySubject('Re: Hello')).toBe('Re: Hello');
    expect(replySubject('RE: Hello')).toBe('RE: Hello');
    expect(replySubject('AW: Hallo')).toBe('AW: Hallo');
  });
  it('handles a missing subject', () => {
    expect(replySubject(undefined)).toBe('Re: (no subject)');
    expect(replySubject('   ')).toBe('Re: (no subject)');
  });
});

describe('stripQuotedReply', () => {
  it('cuts at an "On … wrote:" marker', () => {
    const text = 'Yes, do it.\n\nOn Mon, 1 Sep 2026 at 10:00, Agent <a@x.com> wrote:\n> Shall I proceed?\n> Thanks';
    expect(stripQuotedReply(text)).toBe('Yes, do it.');
  });
  it('cuts at an Outlook "Original Message" marker', () => {
    const text = 'Approved\r\n\r\n-----Original Message-----\r\nFrom: Agent\r\nSubject: Plan';
    expect(stripQuotedReply(text)).toBe('Approved');
  });
  it('cuts at an Outlook web rule followed by a From: header block', () => {
    const text =
      'Hello testing your reply. \n\n\nS\n\n\n\n' +
      '-'.repeat(80) +
      '\n\nFrom: agent@proton.me <agent@proton.me>\nSent: Sunday, 06 September 2026 06:29\nTo: Owner\nSubject: Message\n\nHi there';
    expect(stripQuotedReply(text)).toBe('Hello testing your reply. \n\n\nS'.trimEnd());
  });
  it('cuts at a bare From:/Sent: header block', () => {
    expect(stripQuotedReply('Yes\n\nFrom: A <a@x.com>\nDate: Mon\nSubject: hi\n\nold')).toBe('Yes');
  });
  it('does not treat a From: mention in prose as a quote header', () => {
    const text = 'From: my point of view this is fine.\nLet me know.';
    expect(stripQuotedReply(text)).toBe(text);
  });
  it('drops a trailing quoted block without a marker', () => {
    expect(stripQuotedReply('Sounds good\n\n> earlier\n> lines\n')).toBe('Sounds good');
  });
  it('keeps a message that is only a quote', () => {
    expect(stripQuotedReply('> just forwarding this\n> as is')).toBe('> just forwarding this\n> as is');
  });
});

describe('htmlToText', () => {
  it('flattens tags and entities', () => {
    const html = '<html><style>p{}</style><body><p>Hi &amp; bye</p><div>Line<br>two</div></body></html>';
    expect(htmlToText(html)).toBe('Hi & bye\nLine\ntwo');
  });
});

describe('shouldSkipInbound', () => {
  it('keeps ordinary mail', () => {
    expect(shouldSkipInbound({ fromAddress: 'friend@example.com' })).toBeNull();
    expect(shouldSkipInbound({ fromAddress: 'friend@example.com', autoSubmitted: 'no' })).toBeNull();
  });
  it('drops our own echo', () => {
    expect(shouldSkipInbound({ fromAddress: 'me@proton.me', loopHeader: 'proton-mail' })).toBe('own echo');
  });
  it('drops bounces and auto-replies', () => {
    expect(shouldSkipInbound({ fromAddress: 'MAILER-DAEMON@mx.proton.me' })).toBe('system sender');
    expect(shouldSkipInbound({ fromAddress: 'noreply@shop.example' })).toBe('system sender');
    expect(shouldSkipInbound({ fromAddress: 'x@y.z', autoSubmitted: 'auto-replied' })).toMatch(/auto-submitted/);
    expect(shouldSkipInbound({ fromAddress: 'x@y.z', precedence: 'bulk' })).toBe('precedence: bulk');
  });
  it('drops mail with no sender', () => {
    expect(shouldSkipInbound({})).toBe('no sender');
  });
  it('drops bounces, delivery reports, lists and auto-replies (RFC 3834)', () => {
    expect(shouldSkipInbound({ fromAddress: 'bounces+123@mailer.example' })).toBe('system sender');
    expect(shouldSkipInbound({ fromAddress: 'x@y.z', returnPath: ' <>' })).toMatch(/bounce/);
    expect(shouldSkipInbound({ fromAddress: 'x@y.z', returnPath: ' <x@y.z>' })).toBeNull();
    expect(
      shouldSkipInbound({ fromAddress: 'x@y.z', contentType: 'multipart/report; report-type=delivery-status' }),
    ).toBe('delivery report');
    expect(shouldSkipInbound({ fromAddress: 'x@y.z', precedence: 'list' })).toBe('precedence: list');
    expect(shouldSkipInbound({ fromAddress: 'x@y.z', listId: '<news.example.com>' })).toBe('mailing list');
    expect(shouldSkipInbound({ fromAddress: 'x@y.z', autoReply: 'yes' })).toBe('auto-reply');
  });
});

describe('classifyAttachment', () => {
  it('maps content types', () => {
    expect(classifyAttachment('image/png')).toBe('image');
    expect(classifyAttachment('video/mp4')).toBe('video');
    expect(classifyAttachment('audio/ogg')).toBe('audio');
    expect(classifyAttachment('application/pdf')).toBe('document');
    expect(classifyAttachment(undefined)).toBe('document');
  });
});

describe('ask_question over email', () => {
  const options = normalizeOptions(['Approve', 'Reject all']);

  it('renders slash commands per option', () => {
    expect(optionToCommand('Reject all')).toBe('/reject-all');
    // Only typeable characters: no ellipsis, emoji or punctuation.
    expect(optionToCommand('Reject with reason…')).toBe('/reject-with-reason');
    expect(optionToCommand('✅ Yes, go!')).toBe('/yes-go');
    const body = renderAskQuestion('Deploy?', 'Ship v2 now?', options);
    expect(body).toContain('Deploy?');
    expect(body).toContain('Ship v2 now?');
    expect(body).toContain('  /approve');
    expect(body).toContain('  /reject-all');
  });

  it('matches the first non-empty line as a command', () => {
    expect(matchCommandReply('\n  /Approve \n\nthanks', options)?.value).toBe('Approve');
    expect(matchCommandReply('/reject-all', options)?.value).toBe('Reject all');
  });

  it('takes the first word of the first line, so a note after the command is fine', () => {
    expect(matchCommandReply('/approve thanks', options)?.value).toBe('Approve');
  });

  it('ignores prose and unknown commands', () => {
    expect(matchCommandReply('approve', options)).toBeUndefined();
    expect(matchCommandReply('/maybe', options)).toBeUndefined();
    expect(matchCommandReply('', options)).toBeUndefined();
  });
});

describe('frameInbound', () => {
  it('puts the body first so a slash command stays a command', () => {
    expect(frameInbound('admin', '/clear')).toBe('/clear\n\nSubject: admin');
    expect(frameInbound(undefined, 'hello')).toBe('hello');
    expect(frameInbound('Only a subject', '')).toBe('Subject: Only a subject');
    expect(frameInbound('S', 'b', ['big.pdf (too large)'])).toBe(
      'b\n\nSubject: S\n\n[attachments not delivered: big.pdf (too large)]',
    );
  });
});

describe('checkSenderAuth', () => {
  const genuine = [
    ' mail.protonmail.ch; dmarc=pass (p=none dis=none) header.from=example.org',
    ' mail.protonmail.ch; spf=pass smtp.mailfrom=example.org',
    ' mail.protonmail.ch; dkim=pass (2048-bit key) header.d=example.org header.b="abc"',
  ];
  const forgedFail = ' mail.protonmail.ch; dmarc=fail (p=none dis=none) header.from=example.org';

  it('accepts a mail Proton passed for the From domain, any case', () => {
    expect(checkSenderAuth('owner@example.org', genuine)).toBeNull();
    expect(checkSenderAuth('Owner@Example.ORG', genuine)).toBeNull();
  });
  it('refuses a forged From that Proton failed, though the domain says p=none', () => {
    expect(checkSenderAuth('owner@example.org', [forgedFail])).toBe('dmarc=fail');
  });
  it("refuses a forger's own pass header beside Proton's real verdict", () => {
    const forgedPass = ' mail.protonmail.ch; dmarc=pass header.from=example.org';
    expect(checkSenderAuth('owner@example.org', [forgedPass, forgedFail])).toMatch(/2 DMARC verdicts/);
  });
  it('ignores verdicts from any other authserv-id', () => {
    expect(checkSenderAuth('owner@example.org', [' mx.attacker.test; dmarc=pass header.from=example.org'])).toBe(
      'no DMARC verdict from Proton',
    );
  });
  it('refuses a pass aligned with another domain', () => {
    expect(checkSenderAuth('owner@example.org', [' mail.protonmail.ch; dmarc=pass header.from=attacker.test'])).toMatch(
      /not example\.org/,
    );
  });
});

describe('singleSender', () => {
  const addr = (...vs: Array<{ address?: string; name?: string }>) => ({
    value: vs.map((v) => ({ name: v.name ?? '', address: v.address })),
    html: '',
    text: '',
  });
  it('takes the one sender, lowercased', () => {
    expect(singleSender(addr({ address: 'Owner@Example.org', name: 'Owner' }))).toEqual({
      address: 'owner@example.org',
      name: 'Owner',
    });
  });
  it('refuses a From with several addresses', () => {
    expect(singleSender(addr({ address: 'owner@example.org' }, { address: 'x@attacker.test' }))).toEqual({
      reason: 'more than one From address',
    });
  });
  it('refuses a missing sender', () => {
    expect(singleSender(undefined)).toEqual({ reason: 'no sender' });
  });
});

describe('card tokens', () => {
  it('are NC- plus 13 base32 characters, and differ', () => {
    const a = newCardToken();
    expect(a).toMatch(/^NC-[A-Z2-7]{13}$/);
    expect(new Set(Array.from({ length: 50 }, newCardToken)).size).toBe(50);
  });
  it('go into a one-line subject', () => {
    expect(cardSubject('NC-AAAAAAAAAAAAA', 'Install\njq?')).toBe('[NC-AAAAAAAAAAAAA] Install jq?');
  });
});

describe('matchCardReply', () => {
  const options = normalizeOptions([
    { label: 'Approve', selectedLabel: '✅ Approved', value: 'approve' },
    { label: 'Reject', selectedLabel: '❌ Rejected', value: 'reject' },
  ]);
  const card = (token: string, over: Partial<CardRef> = {}): CardRef => ({
    questionId: `q-${token}`,
    address: 'owner@example.org',
    messageId: `<${token}@pm.me>`,
    subject: `[${token}] Install jq?`,
    title: 'Install jq?',
    options,
    sentAt: new Date().toISOString(),
    ...over,
  });
  const A = 'NC-AAAAAAAAAAAAA';
  const B = 'NC-BBBBBBBBBBBBB';
  const cards = { [A]: card(A), [B]: card(B) };
  const reply = (over: { subject?: string; body?: string; inReplyTo?: string; from?: string }) =>
    matchCardReply({
      cards,
      fromAddress: over.from ?? 'owner@example.org',
      subject: over.subject ?? `Re: [${A}] Install jq?`,
      body: over.body ?? '/approve',
      inReplyTo: over.inReplyTo ?? `<${A}@pm.me>`,
    });

  it('answers the card the reply names — never a newer one', () => {
    const m = reply({});
    expect(m.kind).toBe('answer');
    if (m.kind === 'answer') {
      expect(m.card.questionId).toBe(`q-${A}`);
      expect(m.option.value).toBe('approve');
    }
  });
  it("refuses a reply to one card carrying another card's token", () => {
    expect(reply({ subject: `Re: [${B}] x` })).toMatchObject({ kind: 'refused', reason: /not a reply/ });
  });
  it('refuses a command without a token, without guessing a card', () => {
    expect(reply({ subject: 'Re: Install jq?' })).toMatchObject({ kind: 'refused', notify: true });
  });
  it('refuses another sender, silently', () => {
    expect(reply({ from: 'x@example.org' })).toMatchObject({ kind: 'refused', notify: false });
  });
  it('refuses an answered card', () => {
    const m = matchCardReply({
      cards: { [A]: card(A, { answeredAt: new Date().toISOString() }) },
      fromAddress: 'owner@example.org',
      subject: `Re: [${A}] x`,
      body: '/approve',
      inReplyTo: `<${A}@pm.me>`,
    });
    expect(m).toMatchObject({ kind: 'refused', reason: /already answered/ });
  });
  it('refuses an unknown command', () => {
    expect(reply({ body: '/maybe' })).toMatchObject({ kind: 'refused' });
  });
  it('passes prose on a card thread through to the agent', () => {
    expect(reply({ body: 'Why does it need jq?' })).toEqual({ kind: 'none' });
    expect(reply({ subject: 'Lunch?', body: 'hello', inReplyTo: undefined })).toEqual({ kind: 'none' });
  });
  it('accepts the token on the first line when a client drops the subject', () => {
    expect(reply({ subject: 'Re: x', body: `/approve ${A}` }).kind).toBe('answer');
  });
});

describe('renderCardText', () => {
  it('uses the fallback text and adds links it leaves out', () => {
    const card = { title: 'Report', actions: [{ label: 'Open', url: 'https://example.com/r' }] };
    expect(renderCardText(card, 'Your report is ready')).toBe('Your report is ready\n\nOpen: https://example.com/r');
    expect(renderCardText(card, 'See https://example.com/r')).toBe('See https://example.com/r');
  });
  it('builds text from the card when there is no fallback', () => {
    const card = {
      title: 'Report',
      description: 'Weekly',
      children: ['Line one', { text: 'Line two' }],
      actions: [{ label: 'Bad', url: 'javascript:alert(1)' }],
    };
    expect(renderCardText(card)).toBe('Report\n\nWeekly\n\nLine one\n\nLine two');
  });
});

describe('tlsOptions', () => {
  it('verifies against a pinned certificate wherever the bridge is', () => {
    const ca = Buffer.from('pem');
    expect(tlsOptions('127.0.0.1', { ca })).toEqual({ ca, rejectUnauthorized: true });
  });
  it('verifies by default except on loopback', () => {
    expect(tlsOptions('imap.example.com', {})).toEqual({ rejectUnauthorized: true });
    expect(tlsOptions('127.0.0.1', {})).toEqual({ rejectUnauthorized: false });
    expect(tlsOptions('localhost', {})).toEqual({ rejectUnauthorized: false });
  });
  it('lets an explicit setting win', () => {
    expect(tlsOptions('127.0.0.1', { rejectUnauthorized: true })).toEqual({ rejectUnauthorized: true });
    expect(tlsOptions('imap.example.com', { rejectUnauthorized: false })).toEqual({ rejectUnauthorized: false });
  });
  it('knows loopback', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('10.0.0.1')).toBe(false);
  });
});

describe('retryDelayMs', () => {
  it('backs off exponentially, capped at an hour', () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(2)).toBe(120_000);
    expect(retryDelayMs(20)).toBe(3_600_000);
  });
});
