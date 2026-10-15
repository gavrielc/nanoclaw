import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DIAL_SECRET, dialAuthFile, storeDialKey } from './dial-secret.js';

let root: string;
let auth: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dial-secret-'));
  fs.writeFileSync(path.join(root, '.env'), 'ONECLI_URL=http://gw.test:10254\n');
  auth = path.join(root, 'auth.v1.json');
  fs.writeFileSync(auth, JSON.stringify({ apiKey: 'sk_dial_fixture' }));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const existing = (over: Record<string, unknown> = {}) => ({
  id: 'sec-dial',
  name: 'Dial API',
  type: 'generic',
  hostPattern: 'api.getdial.ai',
  scope: 'project',
  valueSource: 'inline',
  injectionConfig: DIAL_SECRET.injectionConfig,
  ...over,
});
function gateway(rows: unknown[]) {
  return vi.fn(
    async (_url: string, init: RequestInit) =>
      new Response(JSON.stringify(init.method === 'GET' ? rows : init.method === 'POST' ? { id: 'sec-new' } : {})),
  );
}
const writes = (f: ReturnType<typeof gateway>) => f.mock.calls.filter(([, init]) => init.method !== 'GET');

describe('add-dial-tool: storing the Dial key', () => {
  it('updates an existing Dial secret in place, so its id and every grant stay', async () => {
    const f = gateway([existing()]);
    await expect(storeDialKey(auth, f as unknown as typeof fetch, root)).resolves.toBe('sec-dial');
    expect(writes(f)).toEqual([
      ['http://gw.test:10254/v1/secrets/sec-dial', expect.objectContaining({ method: 'PATCH' })],
    ]);
    expect(JSON.parse(writes(f)[0][1].body as string)).toMatchObject({ value: 'sk_dial_fixture' });
  });

  it('creates the secret with bearer injection on api.getdial.ai when there is none', async () => {
    const f = gateway([]);
    await expect(storeDialKey(auth, f as unknown as typeof fetch, root)).resolves.toBe('sec-new');
    expect(JSON.parse(writes(f)[0][1].body as string)).toEqual({
      name: 'Dial API',
      type: 'generic',
      valueSource: 'inline',
      hostPattern: 'api.getdial.ai',
      value: 'sk_dial_fixture',
      injectionConfig: { headerName: 'Authorization', valueFormat: 'Bearer {value}' },
    });
  });

  it.each([
    ['no auth file', () => fs.rmSync(auth)],
    ['an empty key', () => fs.writeFileSync(auth, JSON.stringify({ apiKey: ' ' }))],
    ['an unreadable file', () => fs.writeFileSync(auth, 'not json sk_dial_fixture')],
  ])('stops with %s, before any request and without echoing the file', async (_name, prepare) => {
    prepare();
    const f = gateway([]);
    const err = await storeDialKey(auth, f as unknown as typeof fetch, root).catch((e: Error) => e);
    expect(String(err)).toContain('no Dial API key in the host auth file');
    expect(String(err)).not.toContain('sk_dial_fixture');
    expect(f).not.toHaveBeenCalled();
  });

  it('refuses duplicate or differently scoped Dial secrets instead of guessing', async () => {
    await expect(
      storeDialKey(auth, gateway([existing(), existing({ id: 'sec-2' })]) as unknown as typeof fetch, root),
    ).rejects.toThrow('Multiple Dial API credentials');
    await expect(
      storeDialKey(auth, gateway([existing({ hostPattern: 'evil.example' })]) as unknown as typeof fetch, root),
    ).rejects.toThrow('unexpected metadata in: hostPattern');
  });

  it('reads the auth file where the dial CLI writes it', () => {
    expect(dialAuthFile({ XDG_DATA_HOME: '/x' })).toBe('/x/dial/auth.v1.json');
    expect(dialAuthFile({})).toBe(path.join(os.homedir(), '.local', 'share', 'dial', 'auth.v1.json'));
  });
});
