---
name: replace-whatsapp-with-discord
description: Replace WhatsApp with Discord as the messaging channel. Converts NanoClaw to use Discord bot API instead of WhatsApp Web. Use when user wants Discord support, needs to migrate from WhatsApp, or wants better multi-server/channel support. Triggers on "discord", "replace whatsapp", "switch to discord", or "discord bot".
disable-model-invocation: true
---

# Replace WhatsApp with Discord

This skill migrates NanoClaw from WhatsApp (baileys library) to Discord (discord.js) as the messaging platform.

**What this changes:**
- Message I/O: WhatsApp Web (baileys) → Discord Bot API (discord.js)
- Authentication: QR code → Bot token
- Channel IDs: WhatsApp JIDs (`@g.us`, `@s.whatsapp.net`) → Discord channel IDs (numeric strings)
- Message format: WhatsApp-specific → Discord markdown
- Group discovery: WhatsApp groups → Discord guilds/channels

**What stays the same:**
- SQLite message storage
- Container agent runner
- Task scheduler
- IPC system
- Group queue and concurrency control
- All core architecture

## Prerequisites

Before starting, user needs a Discord bot:

1. Go to https://discord.com/developers/applications
2. Click "New Application"
3. Go to "Bot" section → Reset Token → Copy token (save it!)
4. Enable "Message Content Intent" under Privileged Gateway Intents
5. Invite bot to server using OAuth2 URL Generator:
   - Scopes: `bot`
   - Bot Permissions: Send Messages, Read Message History, Read Messages/View Channels
6. Copy the generated URL and invite bot to your Discord server

Tell user these steps if they haven't done them yet.

## 1. Update Dependencies

Edit `package.json`:

### 1a. Remove WhatsApp dependencies

Remove these from `dependencies`:
```json
"@whiskeysockets/baileys": "...",
"qrcode-terminal": "...",
```

Remove from `devDependencies`:
```json
"@types/qrcode-terminal": "...",
```

### 1b. Add Discord dependency

Add to `dependencies`:
```json
"discord.js": "^14.18.0"
```

### 1c. Update auth script

Change in `scripts`:
```json
"auth": "tsx --env-file=.env src/discord-auth.ts"
```

### 1d. Add env-file flag to dev script

Update `dev` and `auth` scripts to load `.env`:
```json
"dev": "tsx --env-file=.env src/index.ts",
"auth": "tsx --env-file=.env src/discord-auth.ts"
```

## 2. Create Discord Client Module

Create new file `src/discord.ts` with Discord.js integration:

**Required exports:**
- `connectDiscord(token, onMessage, onReady)` - Initialize client with intents
- `sendDiscordMessage(channelId, text)` - Send message (handle 2000 char limit)
- `setDiscordTyping(channelId)` - Send typing indicator
- `getDiscordGuilds()` - Return list of guilds and channels for discovery
- `stopDiscord()` - Clean shutdown
- `DiscordMessage` interface - Normalized message format

**Discord client configuration:**
```typescript
new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
})
```

**Message handler:**
- Listen to `Events.MessageCreate`
- Normalize to: `{ channelId, content, authorName, messageId, isBot, timestamp }`
- Call `onMessage` callback with normalized data

**Send message:**
- Split messages at 2000 chars (Discord limit)
- Try to split on newlines when possible
- Handle TextChannel and DMChannel types

**Add debug logging** for incoming messages to help troubleshooting.

## 3. Rewrite Main Application

Edit `src/index.ts`:

### 3a. Update imports

Remove:
```typescript
import makeWASocket, {
  DisconnectReason,
  WASocket,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
```

Add:
```typescript
import {
  connectDiscord,
  sendDiscordMessage,
  setDiscordTyping,
  getDiscordGuilds,
  stopDiscord,
  DiscordMessage,
} from './discord.js';
```

Remove `STORE_DIR` from config imports (no longer needed).

Add `DISCORD_BOT_TOKEN` to config imports.

### 3b. Remove WhatsApp state variables

Delete these global variables:
- `sock: WASocket`
- `lidToPhoneMap` (WhatsApp LID mapping)
- `waConnected` (connection state)
- `outgoingQueue` and `flushing` (message queue)
- `groupSyncTimerStarted` (WhatsApp-specific timer)

Keep platform-agnostic variables:
- `lastTimestamp`, `sessions`, `registeredGroups`, `lastAgentTimestamp`
- `messageLoopRunning`, `ipcWatcherRunning`
- `queue` (GroupQueue)

### 3c. Replace helper functions

**Remove `translateJid()` function** - Not needed for Discord

**Simplify `setTyping()`:**
```typescript
async function setTyping(channelId: string, isTyping: boolean): Promise<void> {
  if (isTyping) {
    try {
      await setDiscordTyping(channelId);
    } catch (err) {
      logger.debug({ channelId, err }, 'Failed to update typing status');
    }
  }
}
```

**Simplify `sendMessage()`:**
```typescript
async function sendMessage(channelId: string, text: string): Promise<void> {
  try {
    await sendDiscordMessage(channelId, text);
  } catch (err) {
    logger.warn({ channelId, err }, 'Failed to send Discord message');
  }
}
```

**Remove `flushOutgoingQueue()` function** - Discord doesn't need message queuing

### 3d. Replace group sync function

**Remove `syncGroupMetadata()` function** entirely.

**Create new Discord channel sync function:**
```typescript
function syncDiscordChannels(): void {
  try {
    logger.info('Syncing channel metadata from Discord...');
    const guilds = getDiscordGuilds();

    let count = 0;
    for (const guild of guilds) {
      for (const channel of guild.channels) {
        updateChatName(channel.id, `${guild.guildName} / ${channel.name}`);
        count++;
      }
    }

    logger.info({ count }, 'Discord channel metadata synced');
  } catch (err) {
    logger.error({ err }, 'Failed to sync Discord channel metadata');
  }
}
```

### 3e. Update getAvailableGroups()

Change filter condition from:
```typescript
.filter((c) => c.jid !== '__group_sync__' && c.jid.endsWith('@g.us'))
```

To:
```typescript
.filter((c) => c.jid !== '__group_sync__')
```

Discord channels don't have a special suffix like WhatsApp's `@g.us`.

### 3f. Update message handler

**Remove the `sock.ev.on('messages.upsert')` event handler**.

**Create new Discord message handler:**
```typescript
function handleDiscordMessage(msg: DiscordMessage): void {
  // Ignore bot messages
  if (msg.isBot) return;

  const channelId = msg.channelId;
  const timestamp = msg.timestamp;

  // Always store chat metadata for channel discovery
  storeChatMetadata(channelId, timestamp);

  // Only store full message content for registered channels
  if (registeredGroups[channelId]) {
    storeMessage({
      id: msg.messageId,
      chatJid: channelId,
      sender: msg.authorName,
      senderName: msg.authorName,
      content: msg.content,
      timestamp,
      isFromMe: false,
    });
  }
}
```

### 3g. Replace connection function

**Remove entire `connectWhatsApp()` function**.

**Update `main()` function:**

At the top, check for bot token:
```typescript
if (!DISCORD_BOT_TOKEN) {
  console.error('DISCORD_BOT_TOKEN is not set. Set it in your .env or environment.');
  process.exit(1);
}
```

Replace connection logic:
```typescript
await connectDiscord(DISCORD_BOT_TOKEN, handleDiscordMessage, () => {
  // On ready: sync channels, start all subsystems
  syncDiscordChannels();
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) =>
      queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage,
    assistantName: ASSISTANT_NAME,
  });
  startIpcWatcher();
  queue.setProcessMessagesFn(processGroupMessages);
  recoverPendingMessages();
  startMessageLoop();
});
```

**Update shutdown handler:**
```typescript
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutdown signal received');
  stopDiscord();
  await queue.shutdown(10000);
  process.exit(0);
};
```

### 3h. Update IPC refresh_groups handler

In `processTaskIpc()`, update the `refresh_groups` case:
```typescript
case 'refresh_groups':
  if (isMain) {
    logger.info({ sourceGroup }, 'Channel metadata refresh requested via IPC');
    syncDiscordChannels();
    // Write updated snapshot immediately
    const availableGroups = getAvailableGroups();
    writeGroupsSnapshot(
      sourceGroup,
      true,
      availableGroups,
      new Set(Object.keys(registeredGroups)),
    );
  } else {
    logger.warn({ sourceGroup }, 'Unauthorized refresh_groups attempt blocked');
  }
  break;
```

## 4. Update Database Module

Edit `src/db.ts`:

### 4a. Remove baileys import

Delete:
```typescript
import { proto } from '@whiskeysockets/baileys';
```

### 4b. Make storeMessage generic

Replace the `storeMessage()` function signature from:
```typescript
export function storeMessage(
  msg: proto.IWebMessageInfo,
  chatJid: string,
  isFromMe: boolean,
  pushName?: string,
): void
```

To:
```typescript
export function storeMessage(msg: {
  id: string;
  chatJid: string;
  sender: string;
  senderName: string;
  content: string;
  timestamp: string;
  isFromMe: boolean;
}): void
```

Update the function body to use the new parameter names directly instead of extracting from WhatsApp proto structure.

## 5. Create Discord Auth Script

Create new file `src/discord-auth.ts`:

**Purpose:** Validate Discord bot token by making API call

**Implementation:**
- Check `process.env.DISCORD_BOT_TOKEN` exists
- Make fetch request to `https://discord.com/api/v10/users/@me` with `Authorization: Bot ${token}` header
- On success: print bot username and ID
- On failure: print HTTP status and error message
- Exit with code 1 on failure, 0 on success

Keep it simple (~25 lines total).

## 6. Delete WhatsApp Auth Script

Delete `src/whatsapp-auth.ts` - no longer needed.

## 7. Update Configuration

Edit `src/config.ts`:

### 7a. Change default assistant name

```typescript
export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'sansan';
```

You can use any name - 'sansan' was the example but user can choose their preference.

### 7b. Add Discord bot token

```typescript
export const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
```

## 8. Update Group Memory Files

### 8a. Update `groups/global/CLAUDE.md`

**Changes:**
- Replace assistant name (Andy → your chosen name)
- Update message formatting section from WhatsApp to Discord markdown:

```markdown
## Message Formatting

Use standard Discord markdown:
- **bold** (double asterisks)
- *italic* (single asterisks)
- `inline code` (backticks)
- ```code blocks``` (triple backticks)
- > blockquotes
- - bullet lists
- [links](url)

Discord supports full markdown, so use it naturally.
```

### 8b. Update `groups/main/CLAUDE.md`

Same changes as global, plus update the admin context:

**Available groups section:**
- Change JID examples from WhatsApp format (`120363336345536173@g.us`) to Discord channel IDs (numeric strings like `1234567890`)
- Update description: "Groups are ordered by most recent activity. The list is synced from Discord guild channels."
- Change "WhatsApp" references to "Discord"

**Registered groups section:**
- Update JID description: "The Discord channel ID (unique identifier for the channel)"
- Update trigger description for DM channels

## 9. Update Documentation

### 9a. Update `CLAUDE.md`

Change:
```markdown
Single Node.js process that connects to WhatsApp, routes messages...
```

To:
```markdown
Single Node.js process that connects to Discord, routes messages...
```

Update Key Files table:
```markdown
| `src/index.ts` | Main app: Discord connection, message routing, IPC |
```

### 9b. Update `README.md`

**What It Supports section:**
- Change "WhatsApp I/O" → "Discord I/O - Message Claude from Discord (channels, DMs, servers)"
- Change "Isolated group context" → "Isolated channel context"
- Change "Main channel - Your private channel (self-chat)" → "Main channel - Your private channel"

**Usage section:**
- Update trigger examples (e.g., `@sansan` or your chosen name)
- Change "From the main channel (your self-chat)" → "From the main channel"
- Change example "join the Family Chat group" → "join the #general channel"

**Architecture section:**
```markdown
Discord (discord.js) --> SQLite --> Polling loop --> Container (Claude Agent SDK) --> Response
```

Update key files:
```markdown
- `src/index.ts` - Main app: Discord connection, message loop, IPC
```

**FAQ section:**
- Change "Why WhatsApp..." → "Why Discord?"
- Update answer to reflect Discord being the messaging platform

### 9c. Update `docs/REQUIREMENTS.md`

**Built for One User section:**
- Change "I use WhatsApp and Email" → "I use Discord and Email"

**Vision section:**
- Change "accessible via WhatsApp" → "accessible via Discord"
- Update core components: "Discord as the primary I/O channel"

**Implementation approach:**
- "Discord connector" instead of "WhatsApp connector"

**Architecture Decisions:**

Message Routing:
- "A router listens to Discord and routes messages based on configuration"

Trigger:
- Update example from `@Andy` to your chosen name

Integration Points - Discord:
- Replace WhatsApp section with:
```markdown
### Discord
- Using discord.js library for Discord bot connection
- Messages stored in SQLite, polled by router
- Bot token authentication during setup
```

**Skills section:**
- Update `/setup` description to mention Discord bot instead of WhatsApp

**Personal Configuration:**
- Update trigger and response prefix to match your chosen name
- Change "Main channel: Self-chat (messaging yourself in WhatsApp)" → "Main channel: A designated Discord channel or DM"

### 9d. Update `.env-example`

Add Discord bot token:
```
# Discord Bot Token - get from https://discord.com/developers/applications
DISCORD_BOT_TOKEN=
```

## 10. Install Dependencies and Build

After making all changes:

```bash
# Install new dependencies (discord.js) and remove old ones (baileys)
npm install

# Compile TypeScript
npm run build
```

Fix any TypeScript errors that appear.

## 11. Configure and Test

### 11a. Set bot token

Add to `.env`:
```
DISCORD_BOT_TOKEN=your_bot_token_here
```

### 11b. Validate token

```bash
npm run auth
```

Should print: `✓ Authenticated as YourBotName (bot_id)`

### 11c. Start bot

```bash
npm run dev
```

Should see:
- "Connected to Discord"
- "Discord channel metadata synced"
- "NanoClaw running (trigger: @yourname)"

### 11d. Register main channel

Get your Discord channel ID (enable Developer Mode in Discord settings, right-click channel, Copy Channel ID).

Insert into database:
```bash
sqlite3 store/messages.db "
INSERT INTO registered_groups (jid, name, folder, trigger_pattern, added_at, requires_trigger)
VALUES ('YOUR_CHANNEL_ID', 'Main Channel', 'main', '@yourname', datetime('now'), 0);
"
```

Restart the bot (Ctrl+C, then `npm run dev`).

### 11e. Test messaging

Send a message in your Discord channel. Bot should respond within 2 seconds.

## Troubleshooting

**Bot not receiving messages:**
- Verify "Message Content Intent" is enabled in Discord Developer Portal
- Check bot has "Read Messages" and "View Channel" permissions in the Discord channel
- Add debug logging to `src/discord.ts` message handler
- Restart bot with `LOG_LEVEL=debug npm run dev`

**Bot token invalid:**
- Regenerate token in Discord Developer Portal
- Update `.env` file
- Run `npm run auth` to verify

**Messages not being stored:**
- Check channel is registered in `registered_groups` table
- Verify `handleDiscordMessage` is being called (add logging)
- Check SQLite database permissions

**Container issues:**
- Same as before - use `/debug` skill
- Docker/container functionality unchanged

## Summary of Changes

| File | Change Type |
|------|-------------|
| `package.json` | Dependencies, scripts |
| `src/discord.ts` | **New** - Discord client module |
| `src/discord-auth.ts` | **New** - Token validation |
| `src/whatsapp-auth.ts` | **Deleted** |
| `src/index.ts` | Replace WhatsApp with Discord |
| `src/db.ts` | Generic storeMessage interface |
| `src/config.ts` | Add DISCORD_BOT_TOKEN |
| `groups/global/CLAUDE.md` | Formatting, name |
| `groups/main/CLAUDE.md` | Discord IDs, formatting |
| `CLAUDE.md` | Platform references |
| `README.md` | Platform references |
| `docs/REQUIREMENTS.md` | Architecture docs |
| `.env-example` | Add Discord token |

**Files NOT changed:**
- `src/container-runner.ts` - Platform-agnostic
- `src/group-queue.ts` - Platform-agnostic
- `src/task-scheduler.ts` - Platform-agnostic
- `src/types.ts` - Already generic
- All container and Docker files
