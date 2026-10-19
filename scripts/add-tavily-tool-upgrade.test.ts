// Behavior tests for the Tavily paid-key upgrade the agent walks the user
// through (upgrade-instructions.md, written per group by Phase 5). On OneCLI
// 1.44+ a new secret reaches no agent until it is attached, so the user must
// attach the saved key to their group before the keyless header is dropped.
// The attach block runs under `sh` against a stub `onecli` that logs calls.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SKILL_DIR = path.resolve(__dirname, '../.claude/skills/add-tavily-tool');
const doc = fs.readFileSync(path.join(SKILL_DIR, 'upgrade-instructions.md'), 'utf8');
const skill = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
const blocks = [...doc.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
const ATTACH = blocks.find((b) => b.includes('grants attach-secret')) ?? '';

let root: string;
let calls: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tavily-upgrade-'));
  calls = path.join(root, 'calls.log');
  fs.writeFileSync(calls, '');
  fs.mkdirSync(path.join(root, 'bin'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function run(secretName: string, attachExit = 0) {
  fs.writeFileSync(
    path.join(root, 'bin', 'onecli'),
    `#!/usr/bin/env bash
echo "onecli $*" >> "$CALLS"
case "$1 $2" in
  "secrets list") [ "$3 $4" = "--max 0" ] || exit 7; echo '{"hint":"h","data":[{"id":"sec-model","name":"Anthropic","hostPattern":"api.anthropic.com"},{"id":"sec-tavily","name":"${secretName}","hostPattern":"mcp.tavily.com"}]}' ;;
  "agents list") [ "$3 $4" = "--max 0" ] || exit 7; echo '{"hint":"h","data":[{"id":"oc-other","identifier":"ag-other"},{"id":"oc-research","identifier":"ag-research"}]}' ;;
  "agents grants") exit ${attachExit} ;;
esac
`,
    { mode: 0o755 },
  );
  const r = spawnSync('sh', ['-c', ATTACH.replaceAll('{{AGENT_GROUP_ID}}', 'ag-research')], {
    env: { ...process.env, PATH: `${path.join(root, 'bin')}:${process.env.PATH}`, CALLS: calls },
    encoding: 'utf8',
  });
  return { status: r.status, lines: fs.readFileSync(calls, 'utf8').trim().split('\n') };
}

describe('Tavily paid-key upgrade on OneCLI grants', () => {
  it('attaches the saved key, found by its host, to this group only', () => {
    for (const name of ['Tavily', 'tavily']) {
      fs.writeFileSync(calls, '');
      const { status, lines } = run(name);
      expect(status).toBe(0);
      expect(lines.filter((l) => l.includes('attach-secret'))).toEqual([
        'onecli agents grants attach-secret --id oc-research --secret-id sec-tavily',
      ]);
    }
  });

  it('fails loudly when the attach fails, before the keyless header is dropped', () => {
    expect(run('Tavily', 1).status).not.toBe(0);
  });

  it('comes after the key is saved and before the server is re-registered without the keyless header', () => {
    const save = doc.indexOf('paste the key into the prefilled form');
    const attach = doc.indexOf(ATTACH);
    const reregister = doc.indexOf('ncl groups config remove-mcp-server --name tavily');
    expect(save).toBeGreaterThan(-1);
    expect(attach).toBeGreaterThan(save);
    expect(reregister).toBeGreaterThan(attach);
  });

  it('Phase 5 fills in each group id, and the keyless section names the attach', () => {
    expect(skill).toMatch(/Substitute `\{\{ONECLI_DASHBOARD_URL\}\}` and `\{\{AGENT_GROUP_ID\}\}`/);
    expect(skill.slice(skill.indexOf('## Keyless limit'))).toContain('attach');
  });
});
