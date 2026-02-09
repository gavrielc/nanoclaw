import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

import makeWASocket, {
  DisconnectReason,
  WASocket,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { CronExpressionParser } from 'cron-parser';

import {
  ASSISTANT_NAME,
  DATA_DIR,
  IPC_POLL_INTERVAL,
  POLL_INTERVAL,
  STORE_DIR,
  TIMEZONE,
  TRIGGER_PATTERN,
} from './config.js';
import { runAgent } from './agent.js';
import {
  createTask,
  deleteTask,
  getAllSessions,
  getAllTasks,
  getMessageChatJids,
  getMessagesSince,
  getNewMessages,
  getRouterState,
  getTaskById,
  initDatabase,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeMessage,
  updateTask,
} from './db.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { NewMessage } from './types.js';
import { logger } from './logger.js';

let sock: WASocket;
let lastTimestamp = '';
let sessions: Record<string, string> = {};
let lastAgentTimestamp: Record<string, string> = {};
// LID to phone number mapping
let lidToPhoneMap: Record<string, string> = {};
// Guards to prevent duplicate loops on WhatsApp reconnect
let messageLoopRunning = false;
let ipcWatcherRunning = false;
// WhatsApp connection state and outgoing message queue
let waConnected = false;
const outgoingQueue: Array<{ jid: string; text: string }> = [];
// Simple agent lock: only one agent runs at a time
let agentBusy = false;

function acquireAgentLock(): boolean {
  if (agentBusy) return false;
  agentBusy = true;
  return true;
}

function releaseAgentLock(): void {
  agentBusy = false;
}

/**
 * Translate a JID from LID format to phone format if we have a mapping.
 */
function translateJid(jid: string): string {
  if (!jid.endsWith('@lid')) return jid;
  const lidUser = jid.split('@')[0].split(':')[0];
  const phoneJid = lidToPhoneMap[lidUser];
  if (phoneJid) {
    logger.debug({ lidJid: jid, phoneJid }, 'Translated LID to phone JID');
    return phoneJid;
  }
  return jid;
}

async function setTyping(jid: string, isTyping: boolean): Promise<void> {
  try {
    await sock.sendPresenceUpdate(isTyping ? 'composing' : 'paused', jid);
  } catch (err) {
    logger.debug({ jid, err }, 'Failed to update typing status');
  }
}

function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('Corrupted last_agent_timestamp in DB, resetting');
    lastAgentTimestamp = {};
  }
  sessions = getAllSessions();
  logger.info('State loaded');
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState(
    'last_agent_timestamp',
    JSON.stringify(lastAgentTimestamp),
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMessages(messages: NewMessage[]): string {
  const lines = messages.map((m) =>
    `<message sender="${escapeXml(m.sender_name)}" time="${m.timestamp}">${escapeXml(m.content)}</message>`,
  );
  return `<messages>\n${lines.join('\n')}\n</messages>`;
}

/**
 * Write current tasks snapshot so the MCP server can read them.
 */
function writeTasksSnapshot(): void {
  const ipcDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcDir, { recursive: true });

  const tasks = getAllTasks();
  const snapshot = tasks.map((t) => ({
    id: t.id,
    chatJid: t.chat_jid,
    prompt: t.prompt,
    schedule_type: t.schedule_type,
    schedule_value: t.schedule_value,
    status: t.status,
    next_run: t.next_run,
  }));

  fs.writeFileSync(
    path.join(ipcDir, 'current_tasks.json'),
    JSON.stringify(snapshot, null, 2),
  );
}

/**
 * Process all pending messages for a chat.
 */
async function processMessages(chatJid: string): Promise<boolean> {
  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const missedMessages = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);

  if (missedMessages.length === 0) return true;

  // Check if trigger is present
  const hasTrigger = missedMessages.some((m) =>
    TRIGGER_PATTERN.test(m.content.trim()),
  );
  if (!hasTrigger) return true;

  const prompt = formatMessages(missedMessages);

  // Advance cursor
  const previousCursor = lastAgentTimestamp[chatJid] || '';
  lastAgentTimestamp[chatJid] =
    missedMessages[missedMessages.length - 1].timestamp;
  saveState();

  logger.info(
    { chatJid, messageCount: missedMessages.length },
    'Processing messages',
  );

  // Write tasks snapshot for MCP to read
  writeTasksSnapshot();

  const sessionId = sessions[chatJid];
  await setTyping(chatJid, true);
  let hadError = false;

  const output = await runAgent(prompt, chatJid, {
    sessionId,
    onResult: async (result) => {
      if (result.result) {
        const raw = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
        const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
        logger.info({ chatJid }, `Agent output: ${raw.slice(0, 200)}`);
        if (text) {
          await sendMessage(chatJid, `${ASSISTANT_NAME}: ${text}`);
        }
      }
      if (result.sessionId) {
        sessions[chatJid] = result.sessionId;
        setSession(chatJid, result.sessionId);
      }
      if (result.status === 'error') {
        hadError = true;
      }
    },
  });

  await setTyping(chatJid, false);

  if (output.sessionId) {
    sessions[chatJid] = output.sessionId;
    setSession(chatJid, output.sessionId);
  }

  if (output.status === 'error' || hadError) {
    lastAgentTimestamp[chatJid] = previousCursor;
    saveState();
    logger.warn({ chatJid }, 'Agent error, rolled back message cursor for retry');
    return false;
  }

  return true;
}

async function sendMessage(jid: string, text: string): Promise<void> {
  if (!waConnected) {
    outgoingQueue.push({ jid, text });
    logger.info({ jid, length: text.length, queueSize: outgoingQueue.length }, 'WA disconnected, message queued');
    return;
  }
  try {
    await sock.sendMessage(jid, { text });
    logger.info({ jid, length: text.length }, 'Message sent');
  } catch (err) {
    outgoingQueue.push({ jid, text });
    logger.warn({ jid, err, queueSize: outgoingQueue.length }, 'Failed to send, message queued');
  }
}

let flushing = false;
async function flushOutgoingQueue(): Promise<void> {
  if (flushing || outgoingQueue.length === 0) return;
  flushing = true;
  try {
    logger.info({ count: outgoingQueue.length }, 'Flushing outgoing message queue');
    while (outgoingQueue.length > 0) {
      const item = outgoingQueue.shift()!;
      await sendMessage(item.jid, item.text);
    }
  } finally {
    flushing = false;
  }
}

function startIpcWatcher(): void {
  if (ipcWatcherRunning) {
    logger.debug('IPC watcher already running, skipping duplicate start');
    return;
  }
  ipcWatcherRunning = true;

  const ipcDir = path.join(DATA_DIR, 'ipc');
  const messagesDir = path.join(ipcDir, 'messages');
  const tasksDir = path.join(ipcDir, 'tasks');
  fs.mkdirSync(messagesDir, { recursive: true });
  fs.mkdirSync(tasksDir, { recursive: true });

  const processIpcFiles = async () => {
    // Process outgoing messages
    try {
      const messageFiles = fs
        .readdirSync(messagesDir)
        .filter((f) => f.endsWith('.json'));
      for (const file of messageFiles) {
        const filePath = path.join(messagesDir, file);
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          if (data.type === 'message' && data.chatJid && data.text) {
            await sendMessage(data.chatJid, `${ASSISTANT_NAME}: ${data.text}`);
            logger.info({ chatJid: data.chatJid }, 'IPC message sent');
          }
          fs.unlinkSync(filePath);
        } catch (err) {
          logger.error({ file, err }, 'Error processing IPC message');
          const errorDir = path.join(ipcDir, 'errors');
          fs.mkdirSync(errorDir, { recursive: true });
          fs.renameSync(filePath, path.join(errorDir, file));
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error reading IPC messages directory');
    }

    // Process task commands
    try {
      const taskFiles = fs
        .readdirSync(tasksDir)
        .filter((f) => f.endsWith('.json'));
      for (const file of taskFiles) {
        const filePath = path.join(tasksDir, file);
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          await processTaskIpc(data);
          fs.unlinkSync(filePath);
        } catch (err) {
          logger.error({ file, err }, 'Error processing IPC task');
          const errorDir = path.join(ipcDir, 'errors');
          fs.mkdirSync(errorDir, { recursive: true });
          fs.renameSync(filePath, path.join(errorDir, file));
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error reading IPC tasks directory');
    }

    setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
  };

  processIpcFiles();
  logger.info('IPC watcher started');
}

async function processTaskIpc(data: {
  type: string;
  taskId?: string;
  prompt?: string;
  schedule_type?: string;
  schedule_value?: string;
  context_mode?: string;
  chatJid?: string;
}): Promise<void> {
  switch (data.type) {
    case 'schedule_task':
      if (data.prompt && data.schedule_type && data.schedule_value && data.chatJid) {
        const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';

        let nextRun: string | null = null;
        if (scheduleType === 'cron') {
          try {
            const interval = CronExpressionParser.parse(data.schedule_value, {
              tz: TIMEZONE,
            });
            nextRun = interval.next().toISOString();
          } catch {
            logger.warn({ scheduleValue: data.schedule_value }, 'Invalid cron expression');
            break;
          }
        } else if (scheduleType === 'interval') {
          const ms = parseInt(data.schedule_value, 10);
          if (isNaN(ms) || ms <= 0) break;
          nextRun = new Date(Date.now() + ms).toISOString();
        } else if (scheduleType === 'once') {
          const scheduled = new Date(data.schedule_value);
          if (isNaN(scheduled.getTime())) break;
          nextRun = scheduled.toISOString();
        }

        const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const contextMode =
          data.context_mode === 'chat' || data.context_mode === 'isolated'
            ? data.context_mode
            : 'isolated';

        createTask({
          id: taskId,
          chat_jid: data.chatJid,
          prompt: data.prompt,
          schedule_type: scheduleType,
          schedule_value: data.schedule_value,
          context_mode: contextMode,
          next_run: nextRun,
          status: 'active',
          created_at: new Date().toISOString(),
        });
        logger.info({ taskId, chatJid: data.chatJid, contextMode }, 'Task created via IPC');
      }
      break;

    case 'pause_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task) {
          updateTask(data.taskId, { status: 'paused' });
          logger.info({ taskId: data.taskId }, 'Task paused via IPC');
        }
      }
      break;

    case 'resume_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task) {
          updateTask(data.taskId, { status: 'active' });
          logger.info({ taskId: data.taskId }, 'Task resumed via IPC');
        }
      }
      break;

    case 'cancel_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task) {
          deleteTask(data.taskId);
          logger.info({ taskId: data.taskId }, 'Task cancelled via IPC');
        }
      }
      break;

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}

async function connectWhatsApp(): Promise<void> {
  const authDir = path.join(STORE_DIR, 'auth');
  fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
    logger,
    browser: ['NanoClaw', 'Chrome', '1.0.0'],
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const msg =
        'WhatsApp authentication required. Run /setup in Claude Code.';
      logger.error(msg);
      exec(
        `osascript -e 'display notification "${msg}" with title "NanoClaw" sound name "Basso"'`,
      );
      setTimeout(() => process.exit(1), 1000);
    }

    if (connection === 'close') {
      waConnected = false;
      const reason = (lastDisconnect?.error as any)?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      logger.info({ reason, shouldReconnect, queuedMessages: outgoingQueue.length }, 'Connection closed');

      if (shouldReconnect) {
        logger.info('Reconnecting...');
        connectWhatsApp().catch((err) => {
          logger.error({ err }, 'Failed to reconnect, retrying in 5s');
          setTimeout(() => {
            connectWhatsApp().catch((err2) => {
              logger.error({ err: err2 }, 'Reconnection retry failed');
            });
          }, 5000);
        });
      } else {
        logger.info('Logged out. Run /setup to re-authenticate.');
        process.exit(0);
      }
    } else if (connection === 'open') {
      waConnected = true;
      logger.info('Connected to WhatsApp');

      // Build LID to phone mapping
      if (sock.user) {
        const phoneUser = sock.user.id.split(':')[0];
        const lidUser = sock.user.lid?.split(':')[0];
        if (lidUser && phoneUser) {
          lidToPhoneMap[lidUser] = `${phoneUser}@s.whatsapp.net`;
          logger.debug({ lidUser, phoneUser }, 'LID to phone mapping set');
        }
      }

      flushOutgoingQueue().catch((err) =>
        logger.error({ err }, 'Failed to flush outgoing queue'),
      );

      startSchedulerLoop({
        getSessions: () => sessions,
        sendMessage,
        assistantName: ASSISTANT_NAME,
        acquireLock: acquireAgentLock,
        releaseLock: releaseAgentLock,
      });
      startIpcWatcher();
      startMessageLoop();
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message) continue;
      const rawJid = msg.key.remoteJid;
      if (!rawJid || rawJid === 'status@broadcast') continue;

      const chatJid = translateJid(rawJid);
      const timestamp = new Date(
        Number(msg.messageTimestamp) * 1000,
      ).toISOString();

      storeChatMetadata(chatJid, timestamp);
      storeMessage(msg, chatJid, msg.key.fromMe || false, msg.pushName || undefined);
    }
  });
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;

  logger.info(`NanoClaw running (trigger: @${ASSISTANT_NAME})`);

  while (true) {
    try {
      // Get all chats that have messages
      const jids = getMessageChatJids();
      const { messages, newTimestamp } = getNewMessages(
        jids,
        lastTimestamp,
        ASSISTANT_NAME,
      );

      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');

        lastTimestamp = newTimestamp;
        saveState();

        // Deduplicate by chat
        const messagesByChat = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const existing = messagesByChat.get(msg.chat_jid);
          if (existing) {
            existing.push(msg);
          } else {
            messagesByChat.set(msg.chat_jid, [msg]);
          }
        }

        for (const [chatJid, chatMessages] of messagesByChat) {
          // Only act on messages with trigger
          const hasTrigger = chatMessages.some((m) =>
            TRIGGER_PATTERN.test(m.content.trim()),
          );
          if (!hasTrigger) continue;

          // Only process if agent is not busy
          if (!acquireAgentLock()) {
            logger.debug({ chatJid }, 'Agent busy, deferring');
            continue;
          }

          try {
            await processMessages(chatJid);
          } finally {
            releaseAgentLock();
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

async function main(): Promise<void> {
  initDatabase();
  logger.info('Database initialized');
  loadState();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await connectWhatsApp();
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start NanoClaw');
  process.exit(1);
});
