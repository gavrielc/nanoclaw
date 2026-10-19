/**
 * This install's record of the OneCLI secrets its provider logins saved, by
 * agent provider name. A group is granted the ones for the provider it runs;
 * every other secret is attached only by the skill that adds it. Imported by
 * the skill's setup scripts as well, so it uses node builtins only.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ProviderCredentialRecord {
  providers: Record<string, string[]>;
  /** Providers whose secrets were matched by saved name once; never matched again. */
  matched: string[];
}

export function providerCredentialFile(dataDir: string): string {
  return path.join(dataDir, 'onecli', 'provider-credentials.json');
}

const isIds = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((id) => typeof id === 'string');

/** A missing file is an empty record; an unreadable one throws rather than guess. */
export function readProviderCredentials(dataDir: string): ProviderCredentialRecord {
  const file = providerCredentialFile(dataDir);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { providers: {}, matched: [] };
    throw err;
  }
  const parsed = JSON.parse(raw) as Partial<ProviderCredentialRecord> | null;
  const providers = parsed?.providers;
  if (
    !providers ||
    typeof providers !== 'object' ||
    Array.isArray(providers) ||
    !Object.values(providers).every(isIds) ||
    !isIds(parsed.matched)
  ) {
    throw new Error(`${file} must hold provider names mapped to OneCLI secret ids`);
  }
  return { providers, matched: parsed.matched };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// The lock names its writer: host, pid, and a token for this run (a later
// process can reuse a crashed one's pid).
const RUN = randomUUID();
const owner = () => `${os.hostname()} ${process.pid} ${RUN}`;

/** A writer on this host that is gone, or a lock left empty more than 10s ago. */
function isStale(lock: string): boolean {
  let content: string;
  let mtimeMs: number;
  try {
    content = fs.readFileSync(lock, 'utf8').trim();
    mtimeMs = fs.statSync(lock).mtimeMs;
  } catch {
    return false;
  }
  if (!content) return Date.now() - mtimeMs > 10_000;
  const [host, pid, run] = content.split(' ');
  if (host !== os.hostname() || !/^\d+$/.test(pid ?? '')) return false;
  if (Number(pid) === process.pid) return run !== RUN;
  try {
    process.kill(Number(pid), 0);
    return false;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

// Only the holder of the reclaim guard may delete a stale lock, and it checks
// again under the guard, so a reclaim never deletes a lock another writer just took.
function reclaim(lock: string): void {
  const guard = `${lock}.reclaim`;
  try {
    fs.writeFileSync(guard, owner(), { flag: 'wx', mode: 0o600 });
  } catch {
    return;
  }
  try {
    if (isStale(lock)) fs.rmSync(lock, { force: true });
  } finally {
    fs.rmSync(guard, { force: true });
  }
}

/**
 * Read, change and write the record under a lock file, so the host process and
 * a setup script never drop each other's ids. Waiting never blocks the event
 * loop; a lock whose writer is gone is taken over.
 */
export async function updateProviderCredentials(
  dataDir: string,
  change: (record: ProviderCredentialRecord) => void,
  opts: { lockTimeoutMs?: number } = {},
): Promise<ProviderCredentialRecord> {
  const file = providerCredentialFile(dataDir);
  // Mode 0700 matches the staged-file directory this shares.
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`;
  const deadline = Date.now() + (opts.lockTimeoutMs ?? 5_000);
  for (;;) {
    try {
      fs.writeFileSync(lock, owner(), { flag: 'wx', mode: 0o600 });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (isStale(lock)) reclaim(lock);
      if (Date.now() > deadline) {
        throw new Error(
          `${lock} is held; retry, or delete it (and any .reclaim beside it) if no NanoClaw setup or host is running`,
        );
      }
      await sleep(25);
    }
  }
  try {
    const record = readProviderCredentials(dataDir);
    change(record);
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
    return record;
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

/** Adds ids to a provider's entry, or replaces the entry. */
export async function recordProviderCredentials(
  dataDir: string,
  provider: string,
  ids: string[],
  opts: { replace?: boolean } = {},
): Promise<void> {
  await updateProviderCredentials(dataDir, (record) => {
    record.providers[provider] = [...new Set([...(opts.replace ? [] : (record.providers[provider] ?? [])), ...ids])];
  });
}

// The names NanoClaw's provider setup gives the secrets it saves. Names only:
// a typed key under another name may be one user's in a per-user setup.
const SAVED: Record<string, (name: string) => boolean> = {
  claude: (name) => name === 'Anthropic',
  codex: (name) => /^(codex|openai)$/i.test(name),
  opencode: (name) => name.startsWith('OpenCode '),
};

export function isSavedProviderCredential(provider: string, secret: { name?: unknown }): boolean {
  return typeof secret.name === 'string' && (SAVED[provider]?.(secret.name) ?? false);
}

/** Pulls the secret id out of `onecli secrets create` output (JSON, possibly with a `hint` key). */
export function createdSecretId(output: string): string | null {
  try {
    const parsed = JSON.parse(output) as { id?: unknown; data?: { id?: unknown } };
    const id = parsed.id ?? parsed.data?.id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}
