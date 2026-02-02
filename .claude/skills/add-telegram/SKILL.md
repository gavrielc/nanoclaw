---
name: add-telegram
description: Add Telegram as a channel. Can replace WhatsApp entirely or run alongside it. Also configurable as a control-only channel (triggers actions) or passive channel (receives notifications only).
---

# Add Telegram Channel

This skill adds Telegram support to NanoClaw. Users can choose to:

1. **Replace WhatsApp** - Use Telegram as the only messaging channel
2. **Add alongside WhatsApp** - Both channels active, shared or separate memory
3. **Control channel only** - Telegram triggers agent, but doesn't receive scheduled task outputs
4. **Notification channel only** - Receives outputs but can't trigger the agent

## Prerequisites

The user needs a Telegram Bot Token from [@BotFather](https://t.me/botfather):

1. Open Telegram and search for `@BotFather`
2. Send `/newbot` and follow prompts
3. Copy the bot token (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

## Questions to Ask

Before making changes, clarify:

1. **Mode**: Replace WhatsApp or add alongside it?
2. **Trigger behavior**: Should Telegram messages trigger the agent, or just receive notifications?
3. **If adding alongside**: Share memory with WhatsApp groups, or separate contexts?

## Implementation

### Step 1: Install Dependencies

```bash
npm install grammy dotenv
```

Grammy is the modern, TypeScript-first Telegram bot framework.

### Step 2: Create Telegram Connection Module

Create `src/telegram.ts` - see the implementation in this repo.

### Step 3: Update Configuration

Add to `src/config.ts`:

```typescript
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
export const TELEGRAM_ONLY = process.env.TELEGRAM_ONLY === "true";
```

### Step 4: Update Main Application

Modify `src/index.ts`:

1. Add `import "dotenv/config";` at the top
2. Import Telegram module
3. Update `sendMessage` to route by channel prefix (`tg:` for Telegram)
4. Add Telegram initialization in `main()`

### Step 5: Update Database

Add `storeMessageDirect()` function to `src/db.ts` for storing messages from non-WhatsApp channels.

### Step 6: Environment Configuration

Add to `.env`:

```bash
TELEGRAM_BOT_TOKEN=your_bot_token_here

# Optional: Set to "true" to disable WhatsApp entirely
# TELEGRAM_ONLY=true
```

### Step 7: Register a Telegram Chat

Update `data/registered_groups.json` to add Telegram chats:

```json
{
  "tg:-1001234567890": {
    "name": "My Telegram Group",
    "folder": "telegram-main",
    "trigger": "@Pepper",
    "added_at": "2026-02-02T12:00:00.000Z"
  }
}
```

For private chats (DMs with the bot), use positive chat IDs:

```json
{
  "tg:123456789": {
    "name": "Personal",
    "folder": "main",
    "trigger": "@Pepper",
    "added_at": "2026-02-02T12:00:00.000Z"
  }
}
```

## Replace WhatsApp Entirely

If the user wants Telegram-only:

1. Set `TELEGRAM_ONLY=true` in `.env`
2. The app will skip WhatsApp connection and run Telegram only

## Getting the Chat ID

Users need to find their Telegram chat ID to register it:

1. Send `/chatid` to the bot (built-in command)
2. For groups: Add `@RawDataBot` temporarily
3. Check logs when sending a message

## After Changes

```bash
npm run build
systemctl --user restart nanoclaw  # or launchctl on macOS
```

## Testing

1. Start the service
2. Send `/chatid` to get your chat ID
3. Register the chat in `registered_groups.json`
4. Send a message to test the response
