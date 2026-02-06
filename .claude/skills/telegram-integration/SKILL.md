---
name: telegram-integration
description: Understand and troubleshoot Telegram integration in NanoClaw. Use when troubleshooting message delivery, bot configuration, group privacy, or modifying Telegram behavior.
---

# Telegram Integration

NanoClaw uses Telegram as its primary messaging channel via the `telegraf` library. This skill documents how the integration works and how to troubleshoot common issues.

## Architecture Overview

```
Telegram Bot API
       ↓
  Telegraf Library (src/index.ts)
       ↓
  Message Handler → SQLite Storage
       ↓
  Polling Loop → Check New Messages
       ↓
  Container Agent (Claude) → Generate Response
       ↓
  Send Reply (via Telegram Bot API)
```

**Key Components:**
- **Bot Token Authentication**: No QR code needed (unlike WhatsApp)
- **Group Privacy**: Bot must have privacy mode OFF to read all messages
- **Message Storage**: SQLite database stores all messages with timestamps
- **Typing Indicators**: Refreshed every 4s (Telegram lasts ~5s)
- **Message Limits**: 4096 characters per message (auto-splits on newlines)

## How It Works

### 1. Bot Initialization

```typescript
// src/index.ts
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Listen for text messages
bot.on(message('text'), async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const messageText = ctx.message.text;
  const timestamp = new Date(ctx.message.date * 1000).toISOString();

  // Store in database
  storeMessage(chatId, messageText, 'user', timestamp);

  // Update chat metadata
  storeChatMetadata(chatId, ctx.chat.title || 'Private Chat');
});
```

### 2. Message Polling

```typescript
// Poll for new messages every POLL_INTERVAL (default: 5s)
setInterval(async () => {
  const newMessages = await getNewMessages(lastTimestamp);
  for (const msg of newMessages) {
    await processMessage(msg);
  }
}, POLL_INTERVAL);
```

### 3. Message Processing

When a message matches the trigger pattern (default: `@Andy`):

1. **Route to Container**: Determine which container to use
   - Main group + simple query → Persistent container
   - Main group + complex query → Dedicated container
   - Other groups → Dedicated container

2. **Execute Agent**: Run Claude Agent SDK in container
   - Mount group-specific filesystem (`groups/{name}/`)
   - Load `CLAUDE.md` memory
   - Process message and generate response

3. **Send Response**: Split if >4096 chars, send via Telegram API
   ```typescript
   await bot.telegram.sendMessage(chatId, response);
   ```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | (required) | Bot token from BotFather |
| `TRIGGER_PATTERN` | `^@Andy\\b` | Regex pattern to trigger agent |
| `POLL_INTERVAL` | `5000` | Message polling interval (ms) |
| `ASSISTANT_NAME` | `Andy` | Assistant's name |

### Bot Settings

**Group Privacy** must be OFF for bot to read all messages:
1. Open Telegram, find `@BotFather`
2. Send `/mybots`
3. Select your bot → **Bot Settings** → **Group Privacy** → **Turn OFF**

Without this, bot only sees:
- Messages that mention the bot (`@yourbotname`)
- Replies to bot's messages
- Service messages

## Group Management

### Discovering Groups

Groups are discovered automatically when:
- Bot receives a message from a new group
- `storeChatMetadata()` saves chat info to database

No equivalent of WhatsApp's `groupFetchAllParticipating()` - groups are added on-the-fly.

### Registering Groups

To make a group available to the agent, add to `data/registered_groups.json`:

```json
{
  "-1001234567890": {
    "name": "Family Chat",
    "trigger_pattern": "^@Andy\\b",
    "folder_name": "family-chat"
  }
}
```

**Important**: Telegram chat IDs are negative for groups (e.g., `-1001234567890`)

### Main Group

The "Main" group (usually your private chat with the bot) has special privileges:
- Can see messages from all other groups
- Can manage tasks across all groups
- Read-write access to project files
- Uses persistent container for faster responses (if `ENABLE_PERSISTENT_MAIN=true`)

## Troubleshooting

### Bot Not Receiving Messages

**Symptom**: Bot doesn't respond to messages in groups

**Check**:
```bash
# 1. Verify bot token
grep TELEGRAM_BOT_TOKEN .env

# 2. Check group privacy setting
# Must be OFF in BotFather settings

# 3. Check logs for errors
tail -50 logs/app.log | grep -i "telegram\|error"

# 4. Verify bot is in the group
# Send a message in the group and check database
sqlite3 data/nanoclaw.db "SELECT * FROM chats ORDER BY rowid DESC LIMIT 5;"
```

**Common Causes**:
- Group privacy is ON (bot can't see messages)
- Bot token is invalid or expired
- Bot was not added to the group
- Firewall blocking Telegram API

### Messages Stored But No Response

**Symptom**: Messages appear in database but bot doesn't reply

**Check**:
```bash
# 1. Check if message matches trigger pattern
grep TRIGGER_PATTERN .env
# Default: ^@Andy\b (must start with @Andy)

# 2. Check if group is registered
cat data/registered_groups.json

# 3. Check container logs
docker ps -a | grep nanoclaw
docker logs <container-id>

# 4. Check polling loop is running
tail -f logs/app.log | grep "Processing message"
```

**Common Causes**:
- Message doesn't match trigger pattern
- Group not in `registered_groups.json`
- Container failed to start (Docker not running)
- Claude API key missing or invalid

### Typing Indicator Not Showing

**Symptom**: Bot doesn't show "typing..." in Telegram

**Explanation**: This is usually not a problem. Typing indicators:
- Are sent every 4 seconds during agent processing
- Last ~5 seconds on Telegram's side
- May not show for very fast responses (<2s)

**Check**:
```bash
# Look for typing indicator logs
tail -100 logs/app.log | grep "typing"
```

### Message Truncation

**Symptom**: Long responses are cut off

**Explanation**: Telegram has a 4096 character limit per message. NanoClaw automatically splits messages at newline boundaries.

**Check**:
```typescript
// src/index.ts - Message sending logic
async function sendMessage(chatId: string, text: string) {
  const MAX_LENGTH = 4096;
  if (text.length <= MAX_LENGTH) {
    await bot.telegram.sendMessage(chatId, text);
  } else {
    // Split at newlines and send multiple messages
    // See implementation in src/index.ts
  }
}
```

If responses are still truncated:
- Check if there are very long lines without newlines
- Agent may need to format responses with more breaks

### Database Issues

**Symptom**: Messages disappear, or "database locked" errors

**Check**:
```bash
# 1. Check database integrity
sqlite3 data/nanoclaw.db "PRAGMA integrity_check;"

# 2. Check file permissions
ls -la data/nanoclaw.db

# 3. Check for lock files
ls -la data/*.db-*

# 4. Restart service to release locks
sudo systemctl restart nanoclaw
```

## Implementation Details

### Key Files

| File | Purpose | Lines |
|------|---------|-------|
| `src/index.ts` | Main bot logic, message handling | ~600 |
| `src/config.ts` | Configuration and environment variables | ~50 |
| `src/db.ts` | SQLite operations for message storage | ~200 |
| `package.json` | Dependencies (includes `telegraf: ^4.16.3`) | ~35 |

### Database Schema

```sql
-- chats table
CREATE TABLE chats (
  chat_jid TEXT PRIMARY KEY,  -- Telegram chat ID (as string)
  name TEXT,                   -- Group/chat name
  last_updated TEXT            -- ISO timestamp
);

-- messages table
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_jid TEXT,              -- Telegram chat ID
  message_text TEXT,          -- Message content
  sender TEXT,                -- 'user' or 'assistant'
  timestamp TEXT,             -- ISO timestamp
  FOREIGN KEY (chat_jid) REFERENCES chats(chat_jid)
);
```

**Note**: The field is named `chat_jid` (from WhatsApp migration) but stores Telegram chat IDs. No migration needed - it's just a field name.

### API Calls

**Receiving Messages**:
```typescript
bot.on(message('text'), async (ctx) => {
  // ctx.chat.id - Telegram chat ID (number)
  // ctx.message.text - Message text
  // ctx.message.date - Unix timestamp
});
```

**Sending Messages**:
```typescript
await bot.telegram.sendMessage(chatId, text);
```

**Typing Indicator**:
```typescript
await bot.telegram.sendChatAction(chatId, 'typing');
// Lasts ~5s, refresh every 4s for long operations
```

## Modifying Telegram Behavior

### Change Trigger Pattern

Edit `src/config.ts`:
```typescript
export const TRIGGER_PATTERN = new RegExp(
  process.env.TRIGGER_PATTERN || '^@Bob\\b'  // Changed from @Andy
);
```

Rebuild and restart:
```bash
npm run build
sudo systemctl restart nanoclaw
```

### Add Command Handlers

Add custom commands in `src/index.ts`:

```typescript
// After bot initialization
bot.command('status', async (ctx) => {
  await ctx.reply('Bot is running! 🤖');
});

bot.command('help', async (ctx) => {
  await ctx.reply('Send messages starting with @Andy to talk to Claude.');
});
```

### Filter Messages

Add filtering logic in message handler:

```typescript
bot.on(message('text'), async (ctx) => {
  const text = ctx.message.text;

  // Ignore messages from bots
  if (ctx.message.from.is_bot) return;

  // Ignore commands (start with /)
  if (text.startsWith('/')) return;

  // Process message...
});
```

### Add Media Support

Handle photos, documents, voice messages:

```typescript
bot.on(message('photo'), async (ctx) => {
  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  const fileId = photo.file_id;
  const fileLink = await ctx.telegram.getFileLink(fileId);
  // Download and process...
});

bot.on(message('voice'), async (ctx) => {
  const voice = ctx.message.voice;
  // Transcribe using /add-voice-transcription skill
});
```

## Migration Notes

### From WhatsApp to Telegram

NanoClaw was originally built for WhatsApp (using `@whiskeysockets/baileys`). Key changes in Telegram migration:

**Removed**:
- `src/whatsapp-auth.ts` - QR code authentication
- `@whiskeysockets/baileys` dependency
- Multi-device session management
- Media download via baileys

**Changed**:
- Authentication: QR code → Bot token
- Chat IDs: WhatsApp JID format → Telegram numeric IDs
- Group discovery: `groupFetchAllParticipating()` → on-the-fly discovery
- Message format: Baileys proto → Plain text

**Kept Same**:
- Database field names (`chat_jid` still used for Telegram IDs)
- Container architecture
- IPC communication
- Message storage structure

## Security Considerations

### Bot Token

- **Never commit** `.env` with `TELEGRAM_BOT_TOKEN` to git
- `.gitignore` includes `.env` by default
- If token is leaked, revoke it via BotFather and generate a new one

### Group Privacy

- **Privacy OFF** means bot can read ALL messages in groups it's added to
- **Privacy ON** means bot only sees messages mentioning it or replies to it
- Choose based on your use case and trust level

### Data Storage

- All messages stored in `data/nanoclaw.db` (SQLite)
- Database is NOT encrypted
- Contains full message history for all chats
- Protect with filesystem permissions: `chmod 600 data/nanoclaw.db`

## Performance

### Message Latency

Typical message flow timing:
1. **Telegram → Bot**: <100ms (Telegram API delivery)
2. **Bot → Database**: <10ms (SQLite write)
3. **Polling Detection**: 0-5s (depends on POLL_INTERVAL)
4. **Container Spawn**: ~2s (if dedicated container)
5. **Agent Processing**: 5-10s (Claude API + SDK overhead)
6. **Response Send**: <100ms (Telegram API)

**Total**: ~7-17s from user message to bot response

With persistent container (Main group):
1-3: Same (~5s max)
4: **0ms** (no spawn overhead)
5: ~5-7s (just API time)
6: <100ms

**Total**: ~5-12s (40% faster)

### Optimization Tips

- Lower `POLL_INTERVAL` for faster detection (but more CPU usage)
- Use persistent container for frequently-used groups
- Keep group `CLAUDE.md` files concise (affects context size)
- Limit message history lookback in prompts

## Related Skills

- `/setup` - Initial Telegram bot configuration
- `/debug` - Troubleshoot container and messaging issues
- `/customize` - Modify trigger patterns and behavior
- `/add-voice-transcription` - Add voice message support

---

**Note**: This skill documents the current Telegram implementation. For adding other messaging platforms (Slack, Discord, WhatsApp), see the contributing guidelines about creating transformation skills.
