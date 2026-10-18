import { afterAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readInbound } from './connection.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-inbound-'));
const dbPath = path.join(dir, 'inbound.db');
const seed = new Database(dbPath);
seed.exec('CREATE TABLE messages_in (id TEXT PRIMARY KEY, seq INTEGER)');
seed.exec("INSERT INTO messages_in VALUES ('m1', 2)");
seed.close();

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function sqliteError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/** A read that fails with `code` for its first `failures` attempts, then reads the real row count. */
function flakyRead(code: string, failures: number) {
  let attempts = 0;
  const read = (db: Database) => {
    attempts++;
    if (attempts <= failures) throw sqliteError(code);
    return (db.prepare('SELECT count(*) AS c FROM messages_in').get() as { c: number }).c;
  };
  return { read, attempts: () => attempts };
}

describe('readInbound', () => {
  test('retries a read caught mid host write (hot journal) and returns the real rows', () => {
    const flaky = flakyRead('SQLITE_READONLY_ROLLBACK', 2);
    expect(readInbound(flaky.read, dbPath)).toBe(1);
    expect(flaky.attempts()).toBe(3);
  });

  test('retries a torn page read', () => {
    const flaky = flakyRead('SQLITE_CORRUPT', 1);
    expect(readInbound(flaky.read, dbPath)).toBe(1);
    expect(flaky.attempts()).toBe(2);
  });

  test('throws any other error at once', () => {
    const flaky = flakyRead('SQLITE_ERROR', 1);
    expect(() => readInbound(flaky.read, dbPath)).toThrow('SQLITE_ERROR');
    expect(flaky.attempts()).toBe(1);
  });

  test('gives up on a mid-write error that does not clear', () => {
    const flaky = flakyRead('SQLITE_READONLY_ROLLBACK', Number.POSITIVE_INFINITY);
    const started = Date.now();
    expect(() => readInbound(flaky.read, dbPath)).toThrow('SQLITE_READONLY_ROLLBACK');
    expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
    expect(flaky.attempts()).toBeGreaterThan(1);
  });

  test('opens the file read-only', () => {
    expect(() => readInbound((db) => db.exec("INSERT INTO messages_in VALUES ('m2', 4)"), dbPath)).toThrow(/readonly/);
  });
});
