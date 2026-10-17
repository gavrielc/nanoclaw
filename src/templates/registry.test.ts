import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  copyTemplate,
  ensureTemplateLocal,
  fetchTemplateIndex,
  listTemplatesFromDir,
  parseTemplateIndex,
  templateDescription,
  type ClonedRegistry,
} from './registry.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-registry-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function writeTemplate(base: string, ref: string, manifest: Record<string, unknown> = {}): void {
  fs.mkdirSync(path.join(base, ref), { recursive: true });
  fs.writeFileSync(
    path.join(base, ref, 'plugin.json'),
    JSON.stringify({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
      name: ref.split('/').pop(),
      ...manifest,
    }),
  );
}

/** A clone stand-in over a fixed source dir; records how often it ran. */
function fakeClone(source: string): { clone: () => Promise<ClonedRegistry>; calls: () => number } {
  let calls = 0;
  return {
    clone: async () => {
      calls++;
      const dir = fs.mkdtempSync(path.join(root, 'clone-'));
      fs.cpSync(source, dir, { recursive: true });
      return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
    },
    calls: () => calls,
  };
}

describe('listTemplatesFromDir / copyTemplate', () => {
  it('finds nested templates by plugin.json and copies one without git metadata', () => {
    const source = path.join(root, 'source');
    const destination = path.join(root, 'destination');
    fs.mkdirSync(path.join(source, 'sales', 'sdr'), { recursive: true });
    fs.writeFileSync(path.join(source, 'sales', 'sdr', 'plugin.json'), '{"name":"sdr"}');
    // A context/instructions.md INSIDE a plugin (the NanoClaw extension dir)
    // must not trip the legacy detection.
    fs.mkdirSync(path.join(source, 'sales', 'sdr', 'ai.nanoco.nanoclaw', 'context'), { recursive: true });
    fs.writeFileSync(
      path.join(source, 'sales', 'sdr', 'ai.nanoco.nanoclaw', 'context', 'instructions.md'),
      'Sell well.',
    );
    fs.mkdirSync(path.join(source, 'sales', 'sdr', '.git'), { recursive: true });
    fs.writeFileSync(path.join(source, 'sales', 'sdr', '.git', 'config'), 'ignored');

    expect(listTemplatesFromDir(source)).toEqual([{ ref: 'sales/sdr', name: 'sdr' }]);

    copyTemplate(source, 'sales/sdr', destination);
    expect(fs.readFileSync(path.join(destination, 'sales', 'sdr', 'plugin.json'), 'utf8')).toBe('{"name":"sdr"}');
    expect(fs.existsSync(path.join(destination, 'sales', 'sdr', '.git'))).toBe(false);
    expect(() => copyTemplate(source, '../escape', destination)).toThrow('escapes the templates directory');
  });

  it('emits the migration error for a pre-plugin template layout', () => {
    const source = path.join(root, 'source');
    fs.mkdirSync(path.join(source, 'sales', 'sdr', 'context'), { recursive: true });
    fs.writeFileSync(path.join(source, 'sales', 'sdr', 'context', 'instructions.md'), 'Sell well.');

    expect(() => listTemplatesFromDir(source)).toThrow(/predate the plugin format.*sales\/sdr.*Re-fetch/s);
  });
});

describe('templateDescription', () => {
  it("reads the manifest's description, and is undefined without one", () => {
    const base = path.join(root, 'templates');
    writeTemplate(base, 'sales/sdr', { description: 'Books meetings' });
    writeTemplate(base, 'ops/bare');

    expect(templateDescription('sales/sdr', base)).toBe('Books meetings');
    expect(templateDescription('ops/bare', base)).toBeUndefined();
    expect(templateDescription('missing/one', base)).toBeUndefined();
  });
});

describe('ensureTemplateLocal', () => {
  it('fetches a template that is not local, without leaving staging behind', async () => {
    const library = path.join(root, 'library');
    const base = path.join(root, 'templates');
    writeTemplate(library, 'sales/sdr', { description: 'Books meetings' });
    const { clone, calls } = fakeClone(library);

    const result = await ensureTemplateLocal('sales/sdr', { base, clone });

    expect(result).toEqual({ dir: path.join(base, 'sales', 'sdr'), fetched: true });
    expect(templateDescription('sales/sdr', base)).toBe('Books meetings');
    expect(fs.readdirSync(path.join(base, 'sales'))).toEqual(['sdr']);
    expect(calls()).toBe(1);
  });

  it('uses the local copy and never fetches when one exists', async () => {
    const base = path.join(root, 'templates');
    writeTemplate(base, 'sales/sdr', { description: 'Edited locally' });
    const { clone, calls } = fakeClone(path.join(root, 'unused'));

    expect(await ensureTemplateLocal('sales/sdr', { base, clone })).toEqual({
      dir: path.join(base, 'sales', 'sdr'),
      fetched: false,
    });
    expect(templateDescription('sales/sdr', base)).toBe('Edited locally');
    expect(calls()).toBe(0);
  });

  it('rejects a ref the library does not have, and writes nothing', async () => {
    const library = path.join(root, 'library');
    const base = path.join(root, 'templates');
    writeTemplate(library, 'sales/sdr');
    const { clone } = fakeClone(library);

    await expect(ensureTemplateLocal('sales/nope', { base, clone })).rejects.toThrow(
      '"sales/nope" is not in the template library',
    );
    expect(fs.existsSync(path.join(base, 'sales', 'nope'))).toBe(false);
  });

  it('rejects a malformed ref before cloning', async () => {
    const { clone, calls } = fakeClone(path.join(root, 'unused'));

    await expect(ensureTemplateLocal('../etc', { base: root, clone })).rejects.toThrow('Invalid template ref');
    expect(calls()).toBe(0);
  });
});

describe('the library index', () => {
  const index = {
    schema: 1,
    categories: {
      sales: [{ ref: 'sales/sdr', name: 'sdr', version: '1.0.0', description: 'Books meetings' }],
      data: [
        { ref: 'data/analyst', name: 'analyst', version: '1.0.0', description: 'Checks pipelines' },
        { ref: '../escape', name: 'bad', version: '1.0.0', description: 'Dropped' },
        { ref: 'data/no-description', name: 'x' },
      ],
    },
  };

  it('flattens the categories, sorted by ref, dropping malformed entries', () => {
    expect(parseTemplateIndex(index)).toEqual([
      { ref: 'data/analyst', name: 'analyst', description: 'Checks pipelines' },
      { ref: 'sales/sdr', name: 'sdr', description: 'Books meetings' },
    ]);
  });

  it('refuses an index schema it does not know', () => {
    expect(() => parseTemplateIndex({ schema: 2, categories: {} })).toThrow(/update NanoClaw/);
  });

  it('fetches the index, and reports an HTTP failure plainly', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify(index)));
    expect((await fetchTemplateIndex(ok)).map((t) => t.ref)).toEqual(['data/analyst', 'sales/sdr']);

    const notFound = vi.fn(async () => new Response('', { status: 404 }));
    await expect(fetchTemplateIndex(notFound)).rejects.toThrow('HTTP 404');
  });
});
