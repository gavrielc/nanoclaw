import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Secrets reach onecli through a file or stdin, never argv: any local user can
// read a running command's arguments with `ps`. A failed call is rethrown
// redacted, since Node's error repeats the command line and stderr.

const MARK = '[redacted]';

// `text` without whitespace, then without backslash runs or the n/r/t a
// backslash escapes, with `\uXXXX` decoded and `%xx` upper-cased; plus the
// span each kept character came from. A value wrapped across lines (even
// inside an escape), or escaped (JSON, shell) any number of times, reduces to
// the same characters.
function skeleton(text: string): { chars: string; from: number[]; to: number[] } {
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i])) at.push(i);
  const t = at.map((i) => text[i]).join('');
  let chars = '';
  const from: number[] = [];
  const to: number[] = [];
  const keep = (c: string, start: number, end: number) => {
    chars += c;
    from.push(at[start]);
    to.push(at[end] + 1);
  };
  for (let i = 0; i < t.length; i++) {
    const start = i;
    if (t[i] === '\\') {
      while (t[i + 1] === '\\') i++;
      const hex = /^u([0-9a-fA-F]{4})/.exec(t.slice(i + 1, i + 6));
      if (hex) {
        i += 5;
        const c = String.fromCharCode(parseInt(hex[1], 16));
        if (!/[\s\\]/.test(c)) keep(c, start, i);
      } else if (/[nrt]/.test(t[i + 1] ?? '')) i++;
    } else if (/^%[0-9a-fA-F]{2}/.test(t.slice(i, i + 3))) {
      for (const j of [i, i + 1, i + 2]) keep(t[j].toUpperCase(), j, j);
      i += 2;
    } else keep(t[i], i, i);
  }
  return { chars, from, to };
}

/** `text` without any secret, raw, URL-encoded or base64, even wrapped or escaped. */
export function redact(text: string, secrets: string[]): string {
  const { chars, from, to } = skeleton(text);
  const spans: Array<[number, number]> = [];
  for (const secret of secrets) {
    const bytes = Buffer.from(secret);
    for (const form of [secret, encodeURIComponent(secret), bytes.toString('base64'), bytes.toString('base64url')]) {
      const needle = skeleton(form).chars;
      if (!needle) continue;
      for (let k = chars.indexOf(needle); k !== -1; k = chars.indexOf(needle, k + needle.length))
        spans.push([from[k], to[k + needle.length - 1]]);
    }
  }
  let out = '';
  let pos = 0;
  for (const [start, end] of spans.sort((a, b) => a[0] - b[0])) {
    if (end <= pos) continue;
    out += start >= pos ? text.slice(pos, start) + MARK : '';
    pos = end;
  }
  return out + text.slice(pos);
}

/** A copy of a child-process error with only redacted text and the exit status; no `cause`. */
export function redactedError(error: unknown, secrets: string[]): Error {
  const source = (error ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (value === undefined || value === null ? undefined : redact(String(value), secrets));
  const copy = new Error(text(error instanceof Error ? error.message : error) ?? 'Command failed') as Error &
    Record<string, unknown>;
  for (const key of ['cmd', 'stdout', 'stderr']) if (source[key] !== undefined) copy[key] = text(source[key]);
  for (const key of ['status', 'signal', 'code']) if (source[key] !== undefined) copy[key] = source[key];
  return copy;
}

/** `onecli secrets create <args> --file <0600 file holding value>`; returns stdout. */
export function createSecret(args: string[], value: string, env?: NodeJS.ProcessEnv): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onecli-secret-'));
  const file = path.join(dir, 'value');
  try {
    fs.writeFileSync(file, value, { mode: 0o600 });
    return execFileSync('onecli', ['secrets', 'create', ...args, '--file', file], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw redactedError(error, [value]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** `onecli auth login` with the API key on stdin. */
export function login(apiKey: string, env?: NodeJS.ProcessEnv): void {
  try {
    execFileSync('onecli', ['auth', 'login'], { input: `${apiKey}\n`, env, stdio: ['pipe', 'ignore', 'pipe'] });
  } catch (error) {
    throw redactedError(error, [apiKey]);
  }
}
