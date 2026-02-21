/**
 * NanoClaw Agent Runner
 * Runs inside a container, receives config via stdin, outputs result to stdout
 *
 * Input protocol:
 *   Stdin: Full ContainerInput JSON (read until EOF, like before)
 *   IPC:   Follow-up messages written as JSON files to /workspace/ipc/input/
 *          Files: {type:"message", text:"..."}.json — polled and consumed
 *          Sentinel: /workspace/ipc/input/_close — signals session end
 *
 * Stdout protocol:
 *   Each result is wrapped in OUTPUT_START_MARKER / OUTPUT_END_MARKER pairs.
 *   Multiple results may be emitted (one per agent teams result).
 *   Final marker after loop ends signals completion.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AgentAdapter, ContainerOutput } from './adapters/interface.js';
import { sdkAdapter } from './adapters/sdk-adapter.js';
import { cliAdapter } from './adapters/cli-adapter.js';
import { drainIpcInput, waitForIpcMessage } from './adapters/ipc.js';

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  secrets?: Record<string, string>;
}

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';
const IPC_DIR = process.env.NANOCLAW_IPC_DIR || '/workspace/ipc';
const GROUP_DIR = process.env.NANOCLAW_GROUP_DIR || '/workspace/group';
const GLOBAL_DIR = process.env.NANOCLAW_GLOBAL_DIR || '/workspace/global';
const EXTRA_DIR = process.env.NANOCLAW_EXTRA_DIR || '/workspace/extra';

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function selectAdapter(): AgentAdapter {
  const backend = process.env.AGENT_BACKEND || 'sdk';
  if (backend === 'codex' || backend === 'cursor-agent') {
    return cliAdapter;
  }
  return sdkAdapter;
}

async function main(): Promise<void> {
  let containerInput: ContainerInput;

  try {
    const stdinData = await readStdin();
    containerInput = JSON.parse(stdinData);
    try { fs.unlinkSync('/tmp/input.json'); } catch { }
    log(`Received input for group: ${containerInput.groupFolder}`);
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`
    });
    process.exit(1);
  }

  const sdkEnv: Record<string, string | undefined> = { ...process.env };
  for (const [key, value] of Object.entries(containerInput.secrets || {})) {
    sdkEnv[key] = value;
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const mcpServerPath = path.join(__dirname, 'ipc-mcp-stdio.js');

  const ipcInputDir = path.join(IPC_DIR, 'input');
  fs.mkdirSync(ipcInputDir, { recursive: true });
  try { fs.unlinkSync(path.join(ipcInputDir, '_close')); } catch { }

  let prompt = containerInput.prompt;
  if (containerInput.isScheduledTask) {
    prompt = `[SCHEDULED TASK - The following message was sent automatically and is not coming directly from the user or group.]\n\n${prompt}`;
  }
  const pending = drainIpcInput();
  if (pending.length > 0) {
    log(`Draining ${pending.length} pending IPC messages into initial prompt`);
    prompt += '\n' + pending.join('\n');
  }

  const globalClaudeMdPath = path.join(GLOBAL_DIR, 'CLAUDE.md');
  let globalClaudeMd: string | undefined;
  if (!containerInput.isMain && fs.existsSync(globalClaudeMdPath)) {
    globalClaudeMd = fs.readFileSync(globalClaudeMdPath, 'utf-8');
  }

  const extraDirs: string[] = [];
  if (fs.existsSync(EXTRA_DIR)) {
    for (const entry of fs.readdirSync(EXTRA_DIR)) {
      const fullPath = path.join(EXTRA_DIR, entry);
      if (fs.statSync(fullPath).isDirectory()) {
        extraDirs.push(fullPath);
      }
    }
  }

  let sessionId = containerInput.sessionId;
  let resumeAt: string | undefined;

  try {
    const adapter = selectAdapter();

    while (true) {
      log(`Starting query (session: ${sessionId || 'new'}, resumeAt: ${resumeAt || 'latest'})...`);

      const adapterInput = {
        prompt,
        sessionId,
        resumeAt,
        cwd: GROUP_DIR,
        env: sdkEnv,
        groupFolder: containerInput.groupFolder,
        chatJid: containerInput.chatJid,
        isMain: containerInput.isMain,
        globalClaudeMd,
        extraDirs,
        mcpServerPath,
      };

      let lastOutput: ContainerOutput | undefined;
      for await (const output of adapter.run(adapterInput)) {
        lastOutput = output;
        writeOutput(output);
      }

      if (lastOutput?.newSessionId) {
        sessionId = lastOutput.newSessionId;
      }
      if (lastOutput?.resumeAt) {
        resumeAt = lastOutput.resumeAt;
      }

      if (lastOutput?.closedDuringQuery) {
        log('Close sentinel consumed during query, exiting');
        break;
      }

      writeOutput({ status: 'success', result: null, newSessionId: sessionId });
      log('Query ended, waiting for next IPC message...');

      const nextMessage = await waitForIpcMessage();
      if (nextMessage === null) {
        log('Close sentinel received, exiting');
        break;
      }

      log(`Got new message (${nextMessage.length} chars), starting new query`);
      prompt = nextMessage;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`Agent error: ${errorMessage}`);
    writeOutput({
      status: 'error',
      result: null,
      newSessionId: sessionId,
      error: errorMessage
    });
    process.exit(1);
  }
}

main();
