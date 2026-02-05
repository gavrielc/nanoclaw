import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';
import { NewMessage, ScheduledTask, TaskRunLog } from './types.js';
import { logger } from './logger.js';

let db: Database.Database;

export function initDatabase(): void {
  const dbPath = path.join(STORE_DIR, 'messages.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);

  // Check if we need to migrate from WhatsApp schema
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='chats'`)
    .all() as { name: string }[];

  const needsMigration = tables.length > 0;

  if (needsMigration) {
    // Check if this is the old WhatsApp schema (jid column exists)
    try {
      const columns = db.pragma(`table_info(chats)`) as { name: string }[];
      const hasJidColumn = columns.some(col => col.name === 'jid');

      if (hasJidColumn) {
        // Backup old database
        logger.warn('Detected WhatsApp schema, backing up before migration');
        const backupPath = dbPath.replace('.db', `.backup-whatsapp-${Date.now()}.db`);

        // Use file copy for backup
        fs.copyFileSync(dbPath, backupPath);
        logger.info({ backupPath }, 'Backup created');

        // Drop old tables
        db.exec(`
          DROP TABLE IF EXISTS messages;
          DROP TABLE IF EXISTS chats;
          DROP TABLE IF EXISTS scheduled_tasks;
          DROP TABLE IF EXISTS task_run_logs;
        `);
        logger.info('Old WhatsApp tables dropped');
      }
    } catch (err) {
      logger.debug({ err }, 'Error checking schema, continuing with fresh setup');
    }
  }

  // Create new Telegram tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      chat_id INTEGER PRIMARY KEY,
      name TEXT,
      last_message_time TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER,
      chat_id INTEGER,
      user_id INTEGER,
      sender_name TEXT,
      content TEXT,
      timestamp TEXT,
      is_from_bot INTEGER,
      PRIMARY KEY (id, chat_id),
      FOREIGN KEY (chat_id) REFERENCES chats(chat_id)
    );
    CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_chat_timestamp ON messages(chat_id, timestamp);

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      group_folder TEXT NOT NULL,
      chat_id INTEGER NOT NULL,
      prompt TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      context_mode TEXT DEFAULT 'isolated',
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run);
    CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status);

    CREATE TABLE IF NOT EXISTS task_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_run_logs ON task_run_logs(task_id, run_at);
  `);

  // Insert special marker for group sync (chat_id = -1)
  db.prepare(`
    INSERT OR IGNORE INTO chats (chat_id, name, last_message_time)
    VALUES (-1, '__group_sync__', '1970-01-01T00:00:00.000Z')
  `).run();
}

/**
 * Store chat metadata only (no message content).
 * Used for all chats to enable group discovery without storing sensitive content.
 */
export function storeChatMetadata(
  chatId: number,
  timestamp: string,
  name?: string,
): void {
  if (name) {
    // Update with name, preserving existing timestamp if newer
    db.prepare(
      `
      INSERT INTO chats (chat_id, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET
        name = excluded.name,
        last_message_time = MAX(last_message_time, excluded.last_message_time)
    `,
    ).run(chatId, name, timestamp);
  } else {
    // Update timestamp only, preserve existing name if any
    db.prepare(
      `
      INSERT INTO chats (chat_id, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET
        last_message_time = MAX(last_message_time, excluded.last_message_time)
    `,
    ).run(chatId, chatId.toString(), timestamp);
  }
}

/**
 * Update chat name without changing timestamp for existing chats.
 * New chats get the current time as their initial timestamp.
 * Used during group metadata sync.
 */
export function updateChatName(chatId: number, name: string): void {
  db.prepare(
    `
    INSERT INTO chats (chat_id, name, last_message_time) VALUES (?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET name = excluded.name
  `,
  ).run(chatId, name, new Date().toISOString());
}

export interface ChatInfo {
  chat_id: number;
  name: string;
  last_message_time: string;
}

/**
 * Get all known chats, ordered by most recent activity.
 */
export function getAllChats(): ChatInfo[] {
  return db
    .prepare(
      `
    SELECT chat_id, name, last_message_time
    FROM chats
    ORDER BY last_message_time DESC
  `,
    )
    .all() as ChatInfo[];
}

/**
 * Get timestamp of last group metadata sync.
 */
export function getLastGroupSync(): string | null {
  // Use chat_id = -1 as special marker for group sync
  const row = db
    .prepare(`SELECT last_message_time FROM chats WHERE chat_id = -1`)
    .get() as { last_message_time: string } | undefined;
  return row?.last_message_time || null;
}

/**
 * Record that group metadata was synced.
 */
export function setLastGroupSync(): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO chats (chat_id, name, last_message_time) VALUES (-1, '__group_sync__', ?)`,
  ).run(now);
}

/**
 * Store a Telegram message with full content.
 * Only call this for registered groups where message history is needed.
 */
export function storeTelegramMessage(
  messageId: number,
  chatId: number,
  userId: number,
  username: string,
  content: string,
  isFromBot: boolean,
  timestamp: string,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_id, user_id, sender_name, content, timestamp, is_from_bot) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    messageId,
    chatId,
    userId,
    username,
    content,
    timestamp,
    isFromBot ? 1 : 0,
  );
}

export function getNewMessages(
  chatIds: number[],
  lastTimestamp: string,
  botPrefix: string,
): { messages: NewMessage[]; newTimestamp: string } {
  if (chatIds.length === 0) return { messages: [], newTimestamp: lastTimestamp };

  const placeholders = chatIds.map(() => '?').join(',');
  // Filter out bot's own messages by checking content prefix
  const sql = `
    SELECT id, chat_id, user_id, sender_name, content, timestamp, is_from_bot
    FROM messages
    WHERE timestamp > ? AND chat_id IN (${placeholders}) AND content NOT LIKE ?
    ORDER BY timestamp
  `;

  const rows = db
    .prepare(sql)
    .all(lastTimestamp, ...chatIds, `${botPrefix}:%`) as NewMessage[];

  let newTimestamp = lastTimestamp;
  for (const row of rows) {
    if (row.timestamp > newTimestamp) newTimestamp = row.timestamp;
  }

  return { messages: rows, newTimestamp };
}

export function getMessagesSince(
  chatId: number,
  sinceTimestamp: string,
  botPrefix: string,
): NewMessage[] {
  // Filter out bot's own messages by checking content prefix
  const sql = `
    SELECT id, chat_id, user_id, sender_name, content, timestamp, is_from_bot
    FROM messages
    WHERE chat_id = ? AND timestamp > ? AND content NOT LIKE ?
    ORDER BY timestamp
  `;
  return db
    .prepare(sql)
    .all(chatId, sinceTimestamp, `${botPrefix}:%`) as NewMessage[];
}

export function createTask(
  task: Omit<ScheduledTask, 'last_run' | 'last_result'>,
): void {
  db.prepare(
    `
    INSERT INTO scheduled_tasks (id, group_folder, chat_id, prompt, schedule_type, schedule_value, context_mode, next_run, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    task.id,
    task.group_folder,
    task.chat_id,
    task.prompt,
    task.schedule_type,
    task.schedule_value,
    task.context_mode || 'isolated',
    task.next_run,
    task.status,
    task.created_at,
  );
}

export function getTaskById(id: string): ScheduledTask | undefined {
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as
    | ScheduledTask
    | undefined;
}

export function getTasksForGroup(groupFolder: string): ScheduledTask[] {
  return db
    .prepare(
      'SELECT * FROM scheduled_tasks WHERE group_folder = ? ORDER BY created_at DESC',
    )
    .all(groupFolder) as ScheduledTask[];
}

export function getAllTasks(): ScheduledTask[] {
  return db
    .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
    .all() as ScheduledTask[];
}

export function updateTask(
  id: string,
  updates: Partial<
    Pick<
      ScheduledTask,
      'prompt' | 'schedule_type' | 'schedule_value' | 'next_run' | 'status'
    >
  >,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.prompt !== undefined) {
    fields.push('prompt = ?');
    values.push(updates.prompt);
  }
  if (updates.schedule_type !== undefined) {
    fields.push('schedule_type = ?');
    values.push(updates.schedule_type);
  }
  if (updates.schedule_value !== undefined) {
    fields.push('schedule_value = ?');
    values.push(updates.schedule_value);
  }
  if (updates.next_run !== undefined) {
    fields.push('next_run = ?');
    values.push(updates.next_run);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(
    `UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`,
  ).run(...values);
}

export function deleteTask(id: string): void {
  // Delete child records first (FK constraint)
  db.prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
}

export function getDueTasks(): ScheduledTask[] {
  const now = new Date().toISOString();
  return db
    .prepare(
      `
    SELECT * FROM scheduled_tasks
    WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
    ORDER BY next_run
  `,
    )
    .all(now) as ScheduledTask[];
}

export function updateTaskAfterRun(
  id: string,
  nextRun: string | null,
  lastResult: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE scheduled_tasks
    SET next_run = ?, last_run = ?, last_result = ?, status = CASE WHEN ? IS NULL THEN 'completed' ELSE status END
    WHERE id = ?
  `,
  ).run(nextRun, now, lastResult, nextRun, id);
}

export function logTaskRun(log: TaskRunLog): void {
  db.prepare(
    `
    INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(
    log.task_id,
    log.run_at,
    log.duration_ms,
    log.status,
    log.result,
    log.error,
  );
}

export function getTaskRunLogs(taskId: string, limit = 10): TaskRunLog[] {
  return db
    .prepare(
      `
    SELECT task_id, run_at, duration_ms, status, result, error
    FROM task_run_logs
    WHERE task_id = ?
    ORDER BY run_at DESC
    LIMIT ?
  `,
    )
    .all(taskId, limit) as TaskRunLog[];
}
