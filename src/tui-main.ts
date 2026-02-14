/**
 * NanoClaw Terminal UI - Interactive chat via terminal using Ink
 *
 * Usage: npm run tui
 *
 * This provides a local terminal channel to interact with the NanoClaw agent
 * without requiring WhatsApp or Feishu. Messages are processed through the
 * same container agent pipeline.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  ASSISTANT_NAME,
  DATA_DIR,
  GROUPS_DIR,
  MAIN_GROUP_FOLDER,
  STORE_DIR,
} from './config.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  getAllChats,
  getAllTasks,
  getSession,
  initDatabase,
  setSession,
} from './db.js';
import { logger } from './logger.js';
import { startTui, TuiCallbacks } from './tui.js';
import { RegisteredGroup } from './types.js';

// ─── State ───────────────────────────────────────────────────────────────────

const TUI_CHAT_JID = 'tui:local';

const tuiGroup: RegisteredGroup = {
  name: 'terminal',
  folder: MAIN_GROUP_FOLDER,
  trigger: '.*',
  added_at: new Date().toISOString(),
};

// ─── Setup ───────────────────────────────────────────────────────────────────

function ensureDirectoriesExist(): void {
  const directories = [STORE_DIR, DATA_DIR, GROUPS_DIR];
  for (const dir of directories) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const mainGroupDir = path.join(GROUPS_DIR, MAIN_GROUP_FOLDER);
  const globalGroupDir = path.join(GROUPS_DIR, 'global');
  for (const dir of [mainGroupDir, globalGroupDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function ensureContainerSystemRunning(): void {
  try {
    execSync('container system status', { stdio: 'pipe' });
  } catch {
    try {
      execSync('container system start', { stdio: 'pipe', timeout: 30000 });
      logger.info('Apple Container system started');
    } catch (err) {
      logger.error({ err }, 'Failed to start Apple Container system');
      console.error(
        'FATAL: Apple Container system failed to start. Install from https://github.com/apple/container/releases',
      );
      process.exit(1);
    }
  }
}

// ─── Agent Runner ────────────────────────────────────────────────────────────

async function runAgent(prompt: string): Promise<string | null> {
  const groupFolder = tuiGroup.folder;
  const sessionId = getSession(groupFolder);

  // Write snapshots for container
  const tasks = getAllTasks();
  writeTasksSnapshot(
    groupFolder,
    true,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  const chats = getAllChats();
  const availableGroups = chats
    .filter((c) => c.jid !== '__group_sync__' && c.jid.endsWith('@g.us'))
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: false,
    }));
  writeGroupsSnapshot(groupFolder, true, availableGroups, new Set());

  try {
    // Collect streamed results
    const results: string[] = [];
    let newSessionId: string | undefined;

    const output = await runContainerAgent(
      tuiGroup,
      {
        prompt: `<messages>\n<message sender="User" time="${new Date().toISOString()}">${escapeXml(prompt)}</message>\n</messages>`,
        sessionId,
        groupFolder,
        chatJid: TUI_CHAT_JID,
        isMain: true,
      },
      // onProcess callback — TUI doesn't need to track the process
      () => {},
      // onOutput callback — collect streaming results
      async (streamedOutput: ContainerOutput) => {
        if (streamedOutput.newSessionId) {
          newSessionId = streamedOutput.newSessionId;
        }
        if (streamedOutput.result) {
          const raw = typeof streamedOutput.result === 'string'
            ? streamedOutput.result
            : JSON.stringify(streamedOutput.result);
          // Strip <internal>...</internal> blocks
          const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
          if (text) {
            results.push(text);
          }
        }
      },
    );

    // Save session from streaming or final output
    const finalSessionId = newSessionId || output.newSessionId;
    if (finalSessionId) {
      setSession(groupFolder, finalSessionId);
    }

    if (output.status === 'error') {
      logger.error({ error: output.error }, 'Container agent error');
      return `[Error] ${output.error}`;
    }

    // Return collected streaming results, or final result
    if (results.length > 0) {
      return results.join('\n\n');
    }
    return output.result;
  } catch (err) {
    logger.error({ err }, 'Agent error');
    return `[Error] ${err instanceof Error ? err.message : String(err)}`;
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  ensureDirectoriesExist();
  ensureContainerSystemRunning();
  initDatabase();

  logger.info(`Starting NanoClaw Terminal UI (assistant: ${ASSISTANT_NAME})`);

  const callbacks: TuiCallbacks = {
    onSendMessage: async (content: string) => {
      return runAgent(content);
    },
  };

  startTui(callbacks);
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start TUI');
  process.exit(1);
});
