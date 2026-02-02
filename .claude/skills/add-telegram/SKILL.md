---
name: add-telegram
description: Add Telegram as a messaging channel to NanoClaw. Can replace WhatsApp or run alongside it. Triggers on "telegram", "add telegram", "tg bot".
disable-model-invocation: true
---

# Add Telegram Channel

Add Telegram as a messaging channel. Options:
- **Replace WhatsApp** (`TELEGRAM_ONLY=true`)
- **Dual channel** (run both simultaneously)

**What this changes:**
- Message channel: WhatsApp → Telegram (or both)
- Chat ID format: `@g.us` suffix → `tg:` prefix
- Bot library: Baileys → Grammy

**What stays the same:**
- Agent execution, database schema, scheduler
- Container isolation, IPC mechanism

## Prerequisites

### 1. Create Telegram Bot

1. Open Telegram, search `@BotFather`
2. Send `/newbot` → Choose name → Choose username (must end in `bot`)
3. Copy the token (format: `123456789:ABCdefGHI...`)
4. Send `/setprivacy` → Select bot → `Disable` (required for group messages)

### 2. Install Dependency

Run `npm install grammy`

## Implementation Steps

### 1. Create Telegram Module

Create `src/telegram.ts` following the pattern in `src/index.ts` WhatsApp handling:

- Use Grammy Bot instance
- Export `connectTelegram(token, onMessage)` → returns sendMessage function
- Export `disconnectTelegram()` cleanup function
- Export `TelegramMessage` interface: id, chatId, chatType, senderId, senderName, content, timestamp
- Add `/chatid` command → replies with chat ID
- Add `/ping` command → replies "Pong!"
- Listen to `message:text` events, call onMessage callback
- Log connection on bot start

### 2. Update Config

Edit `src/config.ts` - add exports for:
- `TELEGRAM_BOT_TOKEN` from environment (default empty string)
- `TELEGRAM_ONLY` boolean from environment

### 3. Update Database

Edit `src/db.ts` - add `storeMessageDirect()` function for non-WhatsApp channels.

Uses same table structure as existing message storage. Skip if already added.

### 4. Update Main Entry

Edit `src/index.ts` main() function (around line 180):

**Imports**: Add telegram module and config imports

**Global**: Add `sendTelegramMessage` variable (nullable function)

**Handler**: Create `handleTelegramMessage()` following existing message handling pattern:
- Use `tg:${chatId}` as chatJid prefix for routing
- Store via storeMessageDirect
- Check registeredGroups, apply trigger pattern, call runAgent
- Note: Telegram bots don't need `ASSISTANT_NAME:` prefix in responses

**main() modification**:
- If `TELEGRAM_ONLY`: skip WhatsApp, connect Telegram only
- If dual mode: connect both, route by jid prefix (`tg:` vs `@g.us`)

### 5. Update Environment

Add to `.env`: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ONLY=false`

### 6. Register Chats

Get chat ID: send `/chatid` to your bot

Add to `data/registered_groups.json` with `tg:` prefix (e.g., `tg:123456789`)

**Note on Chat ID format:**
- DMs: positive number (e.g., `123456789`)
- Groups: negative number (e.g., `-987654321`)

### 7. Build and Verify

Stop any existing NanoClaw service first to avoid conflicts.

Run `npm run build && npm run dev`

**Verification steps:**
1. Send `/ping` → expect "Pong!"
2. Send `/chatid` → expect chat ID in response
3. Send `@Andy hello` in registered chat → expect agent response

## Known Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Bot doesn't see group messages | Privacy mode enabled | `/setprivacy` → `Disable` via @BotFather |
| "Unauthorized" error | Invalid token | Get new token from @BotFather |
| Chat not triggering | Wrong prefix | Use `tg:` prefix in registered_groups.json |
| Rate limited | Too many messages | Respect limits: 30/sec broadcast, 1/sec per chat |
| Service conflict | Old instance running | Stop existing service before testing |

## Removal

To undo this integration:
1. Remove `src/telegram.ts`
2. Revert changes to `src/index.ts`, `src/config.ts`
3. Remove `tg:` entries from `registered_groups.json`
4. Run `npm uninstall grammy`

## Files Changed

| File | Change |
|------|--------|
| `src/telegram.ts` | NEW |
| `src/config.ts` | Add env exports |
| `src/db.ts` | Add storeMessageDirect() |
| `src/index.ts` | Add handler and routing |
