/**
 * Stores the host's Dial API key in the OneCLI vault and prints the secret id.
 * An existing Dial entry is updated in place, so its id and every grant stay,
 * including another install's on a shared gateway. The key is read from the
 * host auth file and never reaches argv or stdout.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createOneCliCredentialConnection } from '../../add-onecli/scripts/provider-credentials.js';

export const DIAL_SECRET = {
  name: 'Dial API',
  type: 'generic',
  hostPattern: 'api.getdial.ai',
  injectionConfig: { headerName: 'Authorization', valueFormat: 'Bearer {value}' },
} as const;

export function dialAuthFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'dial', 'auth.v1.json');
}

export async function storeDialKey(
  authFile = dialAuthFile(),
  fetchImpl: typeof fetch = globalThis.fetch,
  root = process.cwd(),
): Promise<string> {
  let key = '';
  try {
    const value = (JSON.parse(fs.readFileSync(authFile, 'utf8')) as { apiKey?: unknown }).apiKey;
    key = typeof value === 'string' ? value.trim() : '';
  } catch {
    // Reported below without echoing the file.
  }
  if (!key)
    throw new Error('no Dial API key in the host auth file — sign in with dial auth login / verify-otp, then re-run');
  const vault = createOneCliCredentialConnection(DIAL_SECRET, undefined, undefined, fetchImpl, root);
  return vault.save(key, await vault.find());
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  storeDialKey().then(
    (id) => console.log(id),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    },
  );
}
