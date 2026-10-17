/**
 * The public template library (nanocoai/nanoclaw-templates): its index, and
 * fetching one template into the local templates/ dir. Shared by the setup
 * wizard, `ncl templates list` and the create_agent delivery action.
 */
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { TEMPLATES_DIR } from '../config.js';
import { isValidTemplateRef, resolveLocalTemplate } from './local-dir.js';
import { parsePluginManifest, PLUGIN_MANIFEST_FILE } from './manifest.js';

const execFileAsync = promisify(execFile);

const DEFAULT_TEMPLATES_SOURCE = 'https://github.com/nanocoai/nanoclaw-templates';
// Generated and kept in sync with the templates by that repo's CI.
const INDEX_URL = 'https://raw.githubusercontent.com/nanocoai/nanoclaw-templates/main/index.json';

export interface TemplateEntry {
  ref: string;
  name: string;
}

export interface LibraryTemplate extends TemplateEntry {
  description: string;
}

export interface ClonedRegistry {
  dir: string;
  cleanup: () => void;
}

// A directory is a template iff it is an Agent Plugins directory — the
// manifest is the discovery marker. The pre-plugin layout is detected only to
// point the operator at a re-fetch.
const LEGACY_MARKER = 'context/instructions.md';

/** Shallow-clone the library into a temp dir. Async because the host runs it mid-delivery. */
export async function cloneRegistry(): Promise<ClonedRegistry> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-tpl-'));
  try {
    await execFileAsync('git', ['clone', '--depth', '1', '--', DEFAULT_TEMPLATES_SOURCE, dir], {
      timeout: 60_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error('Could not clone the template library', { cause: err });
  }
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

export function listTemplatesFromDir(dir: string): TemplateEntry[] {
  if (!fs.existsSync(dir)) return [];
  const rootName = path.basename(path.resolve(dir));
  const rels = (fs.readdirSync(dir, { recursive: true }) as string[]).map((entry) => entry.split(path.sep).join('/'));

  const refs = new Set<string>();
  for (const rel of rels) {
    if (rel === PLUGIN_MANIFEST_FILE) refs.add('.');
    else if (rel.endsWith(`/${PLUGIN_MANIFEST_FILE}`)) refs.add(rel.slice(0, -(PLUGIN_MANIFEST_FILE.length + 1)));
  }

  // A context/instructions.md outside any plugin is the pre-plugin template
  // layout. Fail with a pointer instead of silently listing nothing. (The
  // same file INSIDE a plugin — e.g. ai.nanoco.nanoclaw/context/ — is fine.)
  const legacy = rels
    .filter((rel) => rel === LEGACY_MARKER || rel.endsWith(`/${LEGACY_MARKER}`))
    .map((rel) => (rel === LEGACY_MARKER ? '.' : rel.slice(0, -(LEGACY_MARKER.length + 1))))
    .filter((ref) => !isWithinTemplate(ref, refs));
  if (legacy.length > 0) {
    throw new Error(
      `Templates predate the plugin format (no ${PLUGIN_MANIFEST_FILE}): ${legacy.join(', ')}. ` +
        'Re-fetch the template library (and update NanoClaw if fetching does not help).',
    );
  }

  return [...refs]
    .map((ref) => ({ ref, name: ref === '.' ? rootName : (ref.split('/').pop() ?? ref) }))
    .sort((a, b) => a.ref.localeCompare(b.ref));
}

/** True when `ref` equals or sits anywhere below a discovered template ref. */
function isWithinTemplate(ref: string, templateRefs: Set<string>): boolean {
  if (templateRefs.has('.')) return true;
  for (let current = ref; ; ) {
    if (templateRefs.has(current)) return true;
    const cut = current.lastIndexOf('/');
    if (cut === -1) return false;
    current = current.slice(0, cut);
  }
}

/** Copy a list-derived registry template into the local template library. */
export function copyTemplate(srcDir: string, ref: string, destDir: string): string {
  if (ref === '.') throw new Error('Cannot copy the registry root as a template');
  const from = resolveLocalTemplate(ref, srcDir);
  const to = path.resolve(destDir, ref);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, filter: (src) => path.basename(src) !== '.git' });
  return to;
}

/** A local template's manifest description; undefined when it has none or the manifest is unreadable. */
export function templateDescription(ref: string, base: string = TEMPLATES_DIR): string | undefined {
  try {
    const raw: unknown = JSON.parse(
      fs.readFileSync(path.join(resolveLocalTemplate(ref, base), PLUGIN_MANIFEST_FILE), 'utf8'),
    );
    return parsePluginManifest(raw).description;
  } catch {
    return undefined;
  }
}

/** True when a well-formed ref already has a local copy. */
export function hasLocalTemplate(ref: string, base: string = TEMPLATES_DIR): boolean {
  return isValidTemplateRef(ref) && fs.existsSync(path.join(base, ref));
}

/**
 * Make `ref` available under the templates dir, fetching it from the library
 * when there is no local copy. An existing local copy always wins and is never
 * overwritten. `clone` exists so tests never touch the network.
 */
export async function ensureTemplateLocal(
  ref: string,
  opts: { base?: string; clone?: () => Promise<ClonedRegistry> } = {},
): Promise<{ dir: string; fetched: boolean }> {
  if (!isValidTemplateRef(ref)) throw new Error(`Invalid template ref: "${ref}"`);
  const base = opts.base ?? TEMPLATES_DIR;
  const dest = path.join(base, ref);
  if (fs.existsSync(dest)) return { dir: dest, fetched: false };

  const registry = await (opts.clone ?? cloneRegistry)();
  try {
    if (!fs.existsSync(path.join(registry.dir, ref, PLUGIN_MANIFEST_FILE))) {
      throw new Error(`"${ref}" is not in the template library`);
    }
    // Copy next to the destination, then rename: a crash mid-copy must not
    // leave a partial template that would win as the local copy from then on.
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const staging = fs.mkdtempSync(`${dest}.fetch-`);
    try {
      copyTemplate(registry.dir, ref, staging);
      if (!fs.existsSync(dest)) fs.renameSync(path.join(staging, ref), dest);
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  } finally {
    registry.cleanup();
  }
  return { dir: dest, fetched: true };
}

/** The library's index: every template's ref, name and description, sorted by ref. */
export async function fetchTemplateIndex(fetchImpl: typeof fetch = fetch): Promise<LibraryTemplate[]> {
  let res: Response;
  try {
    res = await fetchImpl(INDEX_URL, { signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    throw new Error('Could not reach the template library', { cause: err });
  }
  if (!res.ok) throw new Error(`Could not fetch the template library index (HTTP ${res.status})`);
  return parseTemplateIndex(await res.json());
}

/** index.json groups entries by category: `{ schema: 1, categories: { sales: [entry, …] } }`. */
export function parseTemplateIndex(raw: unknown): LibraryTemplate[] {
  const index = raw as { schema?: unknown; categories?: unknown } | null;
  if (index?.schema !== 1 || typeof index.categories !== 'object' || index.categories === null) {
    throw new Error('The template library index has a format this NanoClaw does not read; update NanoClaw');
  }
  return Object.values(index.categories)
    .flat()
    .filter(isLibraryTemplate)
    .map(({ ref, name, description }) => ({ ref, name, description }))
    .sort((a, b) => a.ref.localeCompare(b.ref));
}

function isLibraryTemplate(entry: unknown): entry is LibraryTemplate {
  const e = entry as Partial<LibraryTemplate> | null;
  return (
    typeof e?.ref === 'string' &&
    isValidTemplateRef(e.ref) &&
    typeof e.name === 'string' &&
    typeof e.description === 'string'
  );
}
