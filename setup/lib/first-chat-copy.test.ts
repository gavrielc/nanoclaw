import { describe, expect, it } from 'vitest';

import { CHAT_LATER, FIRST_CHAT_COPY, fill, SLOW_MODEL } from './first-chat-copy.js';

const PLACEHOLDERS = new Set(['time', 'minutes']);

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('fill', () => {
  it('fills named placeholders wherever a translation puts them', () => {
    expect(fill('Still waiting after {time}. Keep waiting?', { time: '2m 0s' })).toBe(
      'Still waiting after 2m 0s. Keep waiting?',
    );
    expect(fill('{time}: still waiting', { time: '2m 0s' })).toBe('2m 0s: still waiting');
  });

  it('leaves an unknown placeholder visible instead of dropping text', () => {
    expect(fill('After {time}', {})).toBe('After {time}');
    expect(fill('{toString} {__proto__}', {})).toBe('{toString} {__proto__}');
  });
});

describe('FIRST_CHAT_COPY', () => {
  it('uses only the known placeholders', () => {
    for (const text of strings(FIRST_CHAT_COPY)) {
      for (const [, name] of text.matchAll(/\{(\w+)\}/g)) expect(PLACEHOLDERS.has(name)).toBe(true);
    }
  });

  it('has a whole sentence for every stage, so no sentence is built from a stage phrase', () => {
    for (const stage of Object.values(FIRST_CHAT_COPY.stages)) {
      expect(stage.running).toMatch(/…$/);
      expect(stage.stillWaiting).toMatch(/^Still .+\{time\}.+Keep waiting\?$/);
      expect(stage.skipped).toMatch(/^Your assistant .+\.$/);
    }
  });

  it('defines each repeated sentence once and reuses it', () => {
    expect(FIRST_CHAT_COPY.slowModelHint).toBe(SLOW_MODEL);
    expect(FIRST_CHAT_COPY.keepWaitingHint).toContain(SLOW_MODEL);
    expect(FIRST_CHAT_COPY.skipHint).toBe(CHAT_LATER);
    expect(FIRST_CHAT_COPY.skippedNext).toContain(CHAT_LATER);
  });
});

describe('keep-waiting option text', () => {
  it('reads as two whole sentences', () => {
    expect(fill(FIRST_CHAT_COPY.keepWaitingHint, { minutes: 2 })).toBe(
      '2 more minutes. A local model can take several minutes to load and read its first prompt.',
    );
    expect(FIRST_CHAT_COPY.skipHint).toBe('Chat with it later using `pnpm run chat hi`.');
  });
});
