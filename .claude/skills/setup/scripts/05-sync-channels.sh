#!/bin/bash
set -euo pipefail

# 05-sync-channels.sh — Sync Slack channels to the database

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
LOG_FILE="$PROJECT_ROOT/logs/setup.log"

mkdir -p "$PROJECT_ROOT/logs"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [sync-channels] $*" >> "$LOG_FILE"; }

log "Starting Slack channel sync"

# Read bot token from .env
SLACK_BOT_TOKEN=""
if [ -f "$PROJECT_ROOT/.env" ]; then
  SLACK_BOT_TOKEN=$(grep -E "^SLACK_BOT_TOKEN=" "$PROJECT_ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d "'\"" || true)
fi

if [ -z "$SLACK_BOT_TOKEN" ]; then
  log "Missing SLACK_BOT_TOKEN"
  echo "=== NANOCLAW SETUP: SYNC_CHANNELS ==="
  echo "STATUS: failed"
  echo "ERROR: Missing SLACK_BOT_TOKEN in .env"
  echo "=== END ==="
  exit 1
fi

# Use node to call conversations.list and write to DB
CHANNELS_IN_DB=$(node -e "
const Database = (await import('better-sqlite3')).default;
const path = (await import('path')).default;

const dbPath = path.join('${PROJECT_ROOT}', 'store', 'messages.db');
const db = new Database(dbPath);
db.exec('CREATE TABLE IF NOT EXISTS chats (jid TEXT PRIMARY KEY, name TEXT, last_message_time TEXT)');

const token = '${SLACK_BOT_TOKEN}';
let cursor = undefined;
let count = 0;

const upsert = db.prepare('INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?) ON CONFLICT(jid) DO UPDATE SET name = excluded.name');

do {
  const url = new URL('https://slack.com/api/conversations.list');
  url.searchParams.set('types', 'public_channel,private_channel,im');
  url.searchParams.set('limit', '200');
  if (cursor) url.searchParams.set('cursor', cursor);

  const res = await fetch(url.toString(), {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  const data = await res.json();

  if (!data.ok) {
    console.error('API error: ' + data.error);
    process.exit(1);
  }

  for (const ch of data.channels || []) {
    const name = ch.name || (ch.is_im ? 'DM:' + (ch.user || 'unknown') : ch.id);
    upsert.run(ch.id, name, new Date().toISOString());
    count++;
  }

  cursor = data.response_metadata?.next_cursor || undefined;
} while (cursor);

db.close();
console.log(count);
" 2>>"$LOG_FILE")

log "Synced $CHANNELS_IN_DB channels"

cat <<EOF
=== NANOCLAW SETUP: SYNC_CHANNELS ===
CHANNELS_IN_DB: $CHANNELS_IN_DB
STATUS: success
LOG: logs/setup.log
=== END ===
EOF
