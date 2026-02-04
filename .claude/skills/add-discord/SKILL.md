---
name: add-discord
description: Add Discord as a communication channel (replace WhatsApp, additional channel, control channel, or action-only)
---

# Add Discord Integration

Discord can be integrated into NanoClaw in four distinct modes, mirroring the Telegram integration pattern from PR #34:

1. **Replace WhatsApp** - Use Discord as your primary channel instead of WhatsApp
2. **Additional Channel** - Run both Discord and WhatsApp simultaneously
3. **Control Channel** - Discord can trigger agent actions, but responses go to WhatsApp
4. **Action-Only** - Agent can send Discord messages from WhatsApp, but Discord messages don't trigger the agent

## Initial Questions

Ask the user:

> Which mode do you want to use for Discord integration?
>
> **Option 1: Replace WhatsApp**
>
> - Discord becomes your primary communication channel
> - WhatsApp connection is removed
> - All agent interactions happen in Discord
>
> **Option 2: Additional Channel**
>
> - Both Discord and WhatsApp remain active
> - Each has isolated group contexts
> - Agent responds in both platforms
>
> **Option 3: Control Channel**
>
> - Discord messages can trigger the agent
> - Agent responses are sent to WhatsApp (or other registered groups)
> - Useful for remote triggering
>
> **Option 4: Action-Only**
>
> - Agent can send Discord messages when triggered from WhatsApp
> - Discord messages do NOT trigger the agent
> - Discord is output-only

If they choose Option 2, 3, or 4 (modes that keep WhatsApp), ask:

> Which Discord channel IDs should be registered?
> (Provide comma-separated channel IDs, e.g. `1234567890123456789,9876543210987654321`)

Store their choice and proceed to the relevant implementation section.

---

## Prerequisites (All Modes)

### 1. Install Dependencies

```bash
npm install discord.js dotenv
```

Verify installation:

```bash
npm ls discord.js dotenv
```

### 2. Create Discord Bot

**USER ACTION REQUIRED**

Tell the user:

> 1. Open https://discord.com/developers/applications
> 2. Click **New Application** and name it (e.g., "NanoClaw")
> 3. Go to **Bot** in the left sidebar
> 4. Click **Add Bot** (confirm if prompted)
> 5. Click **Reset Token** and copy the token
> 6. **IMPORTANT**: Keep this token secret. It's your bot's password.

### 3. Enable Privileged Intents

**USER ACTION REQUIRED - CRITICAL**

Tell the user:

> In the Bot settings page:
>
> 1. Scroll down to **Privileged Gateway Intents**
> 2. Enable **MESSAGE CONTENT INTENT**
> 3. Click **Save Changes**
>
> ⚠️ **Without this intent, your bot cannot read message content!**

### 4. Invite Bot to Server

**USER ACTION REQUIRED**

Tell the user:

> 1. In the Developer Portal, go to **OAuth2** → **URL Generator**
> 2. Under **Scopes**, select:
>    - `bot`
> 3. Under **Bot Permissions**, select:
>    - View Channels
>    - Send Messages
>    - Read Message History
> 4. Copy the generated URL at the bottom
> 5. Open the URL in your browser
> 6. Select the server to add the bot to
> 7. Click **Authorize**

### 5. Store Bot Token

Add token to `.env` (single source of truth):

```bash
echo 'DISCORD_BOT_TOKEN="your_bot_token_here"' >> .env
```

**Verify:**

```bash
grep DISCORD_BOT_TOKEN .env
```

**IMPORTANT**: Do NOT add secrets to `~/Library/LaunchAgents/com.nanoclaw.plist`. The `.env` file is the single source of truth and will be loaded by `dotenv/config` in `src/index.ts`.

### 6. Get Channel ID

**USER ACTION REQUIRED**

Tell the user:

> 1. In Discord, open **User Settings** → **Advanced**
> 2. Enable **Developer Mode**
> 3. Right-click the channel where you want the bot to work
> 4. Click **Copy Channel ID**
> 5. Save this ID (you'll register it later)

---

## Important: Service Conflict

**CRITICAL - READ BEFORE TESTING**

The NanoClaw launchd service may interfere with your testing. Before making changes:

```bash
# Stop the service
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist

# Make your changes and test manually
npm run build
./container/build.sh
npm start

# After confirming everything works, reload the service
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

---

## Architecture Notes (Read This First!)

### Environment Variables: Single Source of Truth

- `.env` file is the ONLY place to store secrets
- Host process loads `.env` via `dotenv/config` at startup
- Container receives environment through explicit mounts (see `container-runner.ts`)
- NEVER add secrets to launchctl plist files

### Message Handling (No DB storage!)

**CRITICAL DIFFERENCE FROM WHATSAPP:**

Discord messages are NOT stored in the database. They are:

1. Received via Discord Gateway Events
2. Converted directly to XML prompt format
3. Passed to `runAgent()` with the prompt
4. Discarded after agent processing

This is identical to Telegram's pattern (PR #34). Why?

- WhatsApp uses Baileys library which provides SQLite storage
- Discord.js and Telegram bots receive messages via webhooks/events
- We build prompts on-the-fly instead of querying the database

**Implementation pattern:**

```typescript
discordClient.on(Events.MessageCreate, async (message) => {
  // 1. Check if sender is bot (ignore)
  if (message.author.bot) return;

  // 2. Build Discord JID
  const discordJid = `discord:${message.channelId}`;

  // 3. Check if channel is registered
  const group = registeredGroups[discordJid];
  if (!group) return;

  // 4. Build XML prompt directly (NO database call)
  const escapeXml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const timestamp = new Date().toISOString();
  const prompt =
    `<messages>\n` +
    `<message sender="${escapeXml(message.author.username)}" time="${timestamp}">${escapeXml(message.content || '')}</message>\n` +
    `</messages>`;

  // 5. Call runAgent directly
  const output = await runContainerAgent(group, {
    prompt,
    sessionId: sessions[group.folder],
    groupFolder: group.folder,
    chatJid: discordJid,
    isMain: false,
  });

  // 6. Send response
  if (output.status === 'success' && output.result) {
    await sendMessage(discordJid, output.result);
  }
});
```

### Tool Restrictions

Discord tools have the same authorization model as WhatsApp:

- Main group: Can use all tools
- Other groups: Cannot use tools that affect other groups

For scheduled tasks, we need to restrict tool availability. This requires changes to the IPC MCP system.

**Why restrict tools in scheduled tasks?**

Scheduled tasks run automatically without user interaction. They should:

- Be able to send messages to the user (`send_message`)
- NOT be able to modify schedules, register groups, etc.

This requires adding an `isScheduledTask` flag to the container context.

---

## Replace WhatsApp Mode

In this mode, Discord completely replaces WhatsApp as your primary communication channel.

### Step 1: Remove WhatsApp Dependencies (Optional)

If you want a clean break from WhatsApp:

```bash
npm uninstall @whiskeysockets/baileys
```

**Note:** You can skip this step if you want to keep WhatsApp libraries installed but unused. The integration code will simply not use them.

### Step 2: Add dotenv First Import

Edit `src/index.ts`. At the **very top** (first line):

```typescript
import 'dotenv/config';
```

This must be before ALL other imports. Example:

```typescript
import 'dotenv/config'; // ← MUST BE FIRST

import { exec, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
// ... rest of imports
```

### Step 3: Add Discord Imports

In `src/index.ts`, add Discord imports with the other imports:

```typescript
import {
  Client,
  Events,
  GatewayIntentBits,
  TextBasedChannel,
} from 'discord.js';
```

### Step 4: Replace WhatsApp Globals with Discord

In `src/index.ts`, find the line:

```typescript
let sock: WASocket;
```

Replace it with:

```typescript
let discordClient: Client | null = null;
```

### Step 5: Add Discord Helper Functions

Add these functions near the top-level globals in `src/index.ts`:

```typescript
async function getDiscordClient(): Promise<Client> {
  if (discordClient) return discordClient;

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    throw new Error('DISCORD_BOT_TOKEN is not set in .env');
  }

  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent, // Privileged - must be enabled in portal
    ],
  });

  discordClient.once(Events.ClientReady, (ready) => {
    logger.info({ user: ready.user.tag }, 'Discord bot ready');
  });

  await discordClient.login(token);
  return discordClient;
}

async function sendDiscordMessage(
  channelId: string,
  text: string,
): Promise<void> {
  const discord = await getDiscordClient();
  const channel = await discord.channels.fetch(channelId);

  if (!channel || !channel.isTextBased()) {
    logger.warn({ channelId }, 'Discord channel not found or not text-based');
    return;
  }

  await (channel as TextBasedChannel).send(text);
  logger.info({ channelId, length: text.length }, 'Discord message sent');
}
```

### Step 6: Update sendMessage Function

Find the `sendMessage` function in `src/index.ts`:

```typescript
async function sendMessage(jid: string, text: string): Promise<void> {
  try {
    await sock.sendMessage(jid, { text });
    logger.info({ jid, length: text.length }, 'Message sent');
  } catch (err) {
    logger.error({ jid, err }, 'Failed to send message');
  }
}
```

Replace it with:

```typescript
async function sendMessage(jid: string, text: string): Promise<void> {
  if (jid.startsWith('discord:')) {
    const channelId = jid.replace('discord:', '');
    await sendDiscordMessage(channelId, text);
    return;
  }

  // Fallback for any remaining WhatsApp JIDs (if mode 2/3/4)
  logger.warn(
    { jid },
    'Attempted to send to non-Discord JID in Discord-only mode',
  );
}
```

**Important:** Notice that Discord messages do NOT include `${ASSISTANT_NAME}:` prefix. This is because:

- WhatsApp bots send messages as the user (using their account), so they need to identify themselves
- Discord bots send messages as themselves (the bot account), so no prefix is needed

### Step 7: Replace connectWhatsApp with connectDiscord

Find the `connectWhatsApp` function and replace it with:

```typescript
async function connectDiscord(): Promise<void> {
  const discord = await getDiscordClient();

  discord.on(Events.MessageCreate, async (message) => {
    // Ignore bot messages
    if (message.author.bot) return;

    const discordJid = `discord:${message.channelId}`;
    const group = registeredGroups[discordJid];

    // Only registered channels trigger the agent
    if (!group) return;

    const escapeXml = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const timestamp = new Date().toISOString();
    const prompt =
      `<messages>\n` +
      `<message sender="${escapeXml(message.author.username)}" time="${timestamp}">` +
      `${escapeXml(message.content || '')}</message>\n` +
      `</messages>`;

    try {
      const output = await runContainerAgent(group, {
        prompt,
        sessionId: sessions[group.folder],
        groupFolder: group.folder,
        chatJid: discordJid,
        isMain: false,
      });

      if (output.newSessionId) {
        sessions[group.folder] = output.newSessionId;
        saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
      }

      if (output.status === 'success' && output.result) {
        await sendMessage(discordJid, output.result);
      } else if (output.status === 'error') {
        logger.error({ error: output.error }, 'Discord agent error');
      }
    } catch (err) {
      logger.error({ err }, 'Discord message handling failed');
    }
  });

  logger.info('Discord message handler registered');
}
```

### Step 8: Update main() Function

Find the `main()` function and replace the `connectWhatsApp()` call:

```typescript
async function main(): Promise<void> {
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');
  loadState();
  await connectDiscord(); // ← Changed from connectWhatsApp()
}
```

### Step 9: Remove WhatsApp Metadata Sync

Find and remove the `syncGroupMetadata` function and all its calls (it's WhatsApp-specific).

Remove these lines from `connectWhatsApp` (now `connectDiscord`):

```typescript
// Remove these:
syncGroupMetadata().catch(...);
setInterval(() => { syncGroupMetadata()... }, ...);
```

Also remove the `refresh_groups` case from the `processTaskIpc` switch statement (WhatsApp-specific).

### Step 10: Update Container System Check

Find the `ensureContainerSystemRunning` function. It checks for Apple Container on macOS. No changes needed for Discord integration.

### Step 11: Register Discord Channel

Edit `data/registered_groups.json` to register your Discord channel:

```json
{
  "discord:1234567890123456789": {
    "name": "Discord General",
    "folder": "discord-general",
    "trigger": "@Andy",
    "added_at": "2026-02-04T12:00:00.000Z"
  }
}
```

**Format notes:**

- Keys MUST be prefixed with `discord:`
- Channel IDs are Discord snowflakes (always positive integers)
- Folder name should be lowercase with hyphens

### Step 12: Create Group Directory

```bash
mkdir -p groups/discord-general/logs
```

### Step 13: Add CLAUDE.md Memory

Create `groups/discord-general/CLAUDE.md`:

```markdown
# Discord General

You are Andy, a helpful assistant in the Discord General channel.

## Context

- This is the main Discord channel for [describe purpose]
- Users: [list key users if needed]

## Guidelines

- Be helpful and concise
- [Add any specific instructions]
```

### Step 14: Build and Test

```bash
npm run build
./container/build.sh
```

**Test manually first:**

```bash
npm start
```

Send a message in your Discord channel. The bot should respond.

**If it works, start the service:**

```bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

---

## Additional Channel Mode

In this mode, both WhatsApp and Discord remain active, each with isolated contexts.

### Step 1: Add dotenv First Import

Same as Replace WhatsApp Mode, Step 2.

### Step 2: Add Discord Imports

Same as Replace WhatsApp Mode, Step 3.

### Step 3: Add Discord Helper Functions

Same as Replace WhatsApp Mode, Step 5.

### Step 4: Update sendMessage Function

Find the `sendMessage` function in `src/index.ts`:

```typescript
async function sendMessage(jid: string, text: string): Promise<void> {
  try {
    await sock.sendMessage(jid, { text });
    logger.info({ jid, length: text.length }, 'Message sent');
  } catch (err) {
    logger.error({ jid, err }, 'Failed to send message');
  }
}
```

Replace it with:

```typescript
async function sendMessage(jid: string, text: string): Promise<void> {
  if (jid.startsWith('discord:')) {
    const channelId = jid.replace('discord:', '');
    await sendDiscordMessage(channelId, text);
    return;
  }

  // WhatsApp messages
  try {
    await sock.sendMessage(jid, { text: `${ASSISTANT_NAME}: ${text}` });
    logger.info({ jid, length: text.length }, 'Message sent');
  } catch (err) {
    logger.error({ jid, err }, 'Failed to send message');
  }
}
```

**Note:** WhatsApp messages include `${ASSISTANT_NAME}:` prefix, Discord messages do not.

### Step 5: Add Discord Connection Function

Add this function in `src/index.ts`:

```typescript
async function startDiscordBot(): Promise<void> {
  const discord = await getDiscordClient();

  discord.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    const discordJid = `discord:${message.channelId}`;
    const group = registeredGroups[discordJid];
    if (!group) return;

    const escapeXml = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const timestamp = new Date().toISOString();
    const prompt =
      `<messages>\n` +
      `<message sender="${escapeXml(message.author.username)}" time="${timestamp}">` +
      `${escapeXml(message.content || '')}</message>\n` +
      `</messages>`;

    try {
      const output = await runContainerAgent(group, {
        prompt,
        sessionId: sessions[group.folder],
        groupFolder: group.folder,
        chatJid: discordJid,
        isMain: false,
      });

      if (output.newSessionId) {
        sessions[group.folder] = output.newSessionId;
        saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
      }

      if (output.status === 'success' && output.result) {
        await sendMessage(discordJid, output.result);
      } else if (output.status === 'error') {
        logger.error({ error: output.error }, 'Discord agent error');
      }
    } catch (err) {
      logger.error({ err }, 'Discord message handling failed');
    }
  });
}
```

### Step 6: Start Discord in connectWhatsApp

In the `connectWhatsApp` function, find the section where connection opens:

```typescript
} else if (connection === 'open') {
  logger.info('Connected to WhatsApp');
  // ... existing code
  startSchedulerLoop(...);
  startIpcWatcher();
  startMessageLoop();
}
```

Add Discord startup:

```typescript
} else if (connection === 'open') {
  logger.info('Connected to WhatsApp');
  // ... existing code
  startSchedulerLoop(...);
  startIpcWatcher();
  startMessageLoop();

  // Start Discord bot
  startDiscordBot().catch((err) => {
    logger.error({ err }, 'Failed to start Discord bot');
  });
}
```

### Step 7: Register Discord Channels

Edit `data/registered_groups.json`:

```json
{
  "1234567890@s.whatsapp.net": {
    "name": "Main",
    "folder": "main",
    "trigger": "@Andy",
    "added_at": "2026-01-01T00:00:00.000Z"
  },
  "discord:1234567890123456789": {
    "name": "Discord General",
    "folder": "discord-general",
    "trigger": "@Andy",
    "added_at": "2026-02-04T12:00:00.000Z"
  }
}
```

### Step 8: Create Group Directory

```bash
mkdir -p groups/discord-general/logs
```

Add `groups/discord-general/CLAUDE.md` with appropriate context.

### Step 9: Build and Test

Same as Replace WhatsApp Mode, Step 14.

---

## Control Channel Mode

Discord messages can trigger the agent, but responses go to WhatsApp (or other registered groups).

### Step 1-6: Same as Additional Channel Mode

Follow Steps 1-6 from Additional Channel Mode.

### Step 7: Modify Discord Message Handler

In the `startDiscordBot` function, modify the response logic:

```typescript
async function startDiscordBot(): Promise<void> {
  const discord = await getDiscordClient();

  discord.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    const discordJid = `discord:${message.channelId}`;
    const group = registeredGroups[discordJid];
    if (!group) return;

    const escapeXml = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const timestamp = new Date().toISOString();
    const prompt =
      `<messages>\n` +
      `<message sender="${escapeXml(message.author.username)}" time="${timestamp}">` +
      `${escapeXml(message.content || '')}</message>\n` +
      `</messages>`;

    try {
      const output = await runContainerAgent(group, {
        prompt,
        sessionId: sessions[group.folder],
        groupFolder: group.folder,
        chatJid: discordJid,
        isMain: false,
      });

      if (output.newSessionId) {
        sessions[group.folder] = output.newSessionId;
        saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
      }

      if (output.status === 'success' && output.result) {
        // CONTROL CHANNEL: Send response to WhatsApp main group, not Discord
        const mainJid = Object.keys(registeredGroups).find(
          (jid) => registeredGroups[jid].folder === MAIN_GROUP_FOLDER,
        );

        if (mainJid) {
          await sendMessage(mainJid, `[Discord Control] ${output.result}`);
        } else {
          logger.warn('Control channel triggered but no main group found');
        }
      } else if (output.status === 'error') {
        logger.error({ error: output.error }, 'Discord agent error');
      }
    } catch (err) {
      logger.error({ err }, 'Discord message handling failed');
    }
  });
}
```

### Step 8: Register Discord Control Channel

Edit `data/registered_groups.json`:

```json
{
  "1234567890@s.whatsapp.net": {
    "name": "Main",
    "folder": "main",
    "trigger": "@Andy",
    "added_at": "2026-01-01T00:00:00.000Z"
  },
  "discord:1234567890123456789": {
    "name": "Discord Control",
    "folder": "discord-control",
    "trigger": "",
    "added_at": "2026-02-04T12:00:00.000Z"
  }
}
```

**Note:** Empty trigger means all messages in this Discord channel will trigger the agent.

### Step 9: Build and Test

Same as Replace WhatsApp Mode, Step 14.

---

## Action-Only Mode

Agent can send Discord messages from WhatsApp, but Discord messages don't trigger the agent.

### Step 1: Add dotenv First Import

Same as Replace WhatsApp Mode, Step 2.

### Step 2: Add Discord Imports

Same as Replace WhatsApp Mode, Step 3.

### Step 3: Add Discord Helper Functions

Same as Replace WhatsApp Mode, Step 5.

### Step 4: Update sendMessage Function

Same as Additional Channel Mode, Step 4.

### Step 5: Add Discord IPC Tool (Container)

Edit `container/agent-runner/src/ipc-mcp.ts`.

Find the tools array (around line 42), and add this tool after the existing tools:

```typescript
      tool(
        'discord_send_message',
        'Send a message to a Discord channel by ID. Main group only.',
        {
          channel_id: z.string().describe('Discord channel ID (snowflake)'),
          text: z.string().describe('Message content'),
        },
        async (args) => {
          if (!isMain) {
            return {
              content: [{ type: 'text', text: 'Only the main group can send Discord messages.' }],
              isError: true
            };
          }

          const data = {
            type: 'discord_send_message',
            channelId: args.channel_id,
            text: args.text,
            groupFolder,
            timestamp: new Date().toISOString(),
          };

          const filename = writeIpcFile(TASKS_DIR, data);

          return {
            content: [{
              type: 'text',
              text: `Discord message queued (${filename})`,
            }],
          };
        },
      ),
```

**Important:** This tool is only available to the main group (`isMain` check).

### Step 6: Add Discord IPC Handler (Host)

In `src/index.ts`, find the `processTaskIpc` function.

Add these types to the data parameter (around line 412):

```typescript
async function processTaskIpc(
  data: {
    type: string;
    taskId?: string;
    prompt?: string;
    schedule_type?: string;
    schedule_value?: string;
    context_mode?: string;
    groupFolder?: string;
    chatJid?: string;
    // For register_group
    jid?: string;
    name?: string;
    folder?: string;
    trigger?: string;
    containerConfig?: RegisteredGroup['containerConfig'];
    // For discord_send_message
    channelId?: string;
    text?: string;
  },
  sourceGroup: string,
  isMain: boolean,
): Promise<void> {
```

Then add this case to the switch statement (before `default:`):

```typescript
    case 'discord_send_message':
      // Authorization: only main group
      if (!isMain) {
        logger.warn({ sourceGroup }, 'Unauthorized discord_send_message attempt blocked');
        break;
      }

      if (data.channelId && data.text) {
        await sendDiscordMessage(data.channelId, data.text);
        logger.info({ channelId: data.channelId, sourceGroup }, 'Discord message sent via IPC');
      } else {
        logger.warn({ data }, 'Invalid discord_send_message payload');
      }
      break;
```

### Step 7: Initialize Discord Client on Startup

In the `main()` function, add Discord initialization:

```typescript
async function main(): Promise<void> {
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');
  loadState();

  // Initialize Discord client (without message handler)
  await getDiscordClient().catch((err) => {
    logger.error({ err }, 'Failed to initialize Discord client');
  });

  await connectWhatsApp();
}
```

**Note:** We initialize the Discord client but do NOT register the message handler (`Events.MessageCreate`). This makes Discord output-only.

### Step 8: Build and Test

```bash
npm run build
./container/build.sh
```

**Test via WhatsApp:**

```
@Andy send "Hello from WhatsApp!" to Discord channel 1234567890123456789
```

The agent should use the `discord_send_message` tool to send the message.

**Verify Discord messages are ignored:**

Send a message in the Discord channel. The bot should NOT respond (action-only mode).

---

## Privacy Model

### Registered Groups Only

Just like WhatsApp, only registered Discord channels can trigger the agent. Unregistered channels are ignored.

### Isolated Contexts

Each Discord channel has its own:

- Group folder (`groups/discord-channel-name/`)
- CLAUDE.md memory
- Conversation session
- Container sandbox (isolated filesystem)

Discord channels cannot access other groups' data unless explicitly mounted.

### Main Group Privileges

The main group (typically WhatsApp self-chat) has additional permissions:

- Can register new Discord channels
- Can schedule tasks for any group
- Can send messages to any registered group
- Can use tools like `discord_send_message`

### Message Storage

**Discord messages are NOT stored in the database.**

Only metadata is tracked:

- Channel ID
- Last activity timestamp

Full message content is only kept in:

- Agent session transcripts (in `groups/*/`)
- Archived conversations (in `groups/*/conversations/`)

---

## Rate Limits

Discord has different rate limits than WhatsApp:

| Action         | Limit                | Notes                                   |
| -------------- | -------------------- | --------------------------------------- |
| Global         | 50 requests/second   | Across all channels                     |
| Per channel    | 5 messages/5 seconds | Per channel                             |
| Gateway events | No explicit limit    | But client can be disconnected for spam |

**Recommendations:**

- For long responses, consider breaking into multiple messages
- Add delays between bulk operations
- Monitor rate limit headers in Discord API responses

Compare to WhatsApp (via Baileys):

- Broadcast: 30 messages/second
- Per chat: 1 message/second

---

## Chat ID Formats

### Discord Snowflakes

Discord uses "snowflakes" - 64-bit integers - for all IDs:

```
Channel ID: 1234567890123456789 (always positive)
Guild ID:   9876543210987654321 (always positive)
User ID:    1111222233334444555 (always positive)
```

### JID Format in NanoClaw

Discord channel IDs are prefixed with `discord:` to distinguish them from WhatsApp JIDs:

```json
{
  "discord:1234567890123456789": {
    "name": "General",
    "folder": "discord-general"
  }
}
```

Compare to WhatsApp:

```json
{
  "120363336345536173@g.us": { "name": "Family", "folder": "family-chat" }
}
```

### Translation in sendMessage

The `sendMessage` function routes based on prefix:

```typescript
async function sendMessage(jid: string, text: string): Promise<void> {
  if (jid.startsWith('discord:')) {
    const channelId = jid.replace('discord:', '');
    await sendDiscordMessage(channelId, text);
    return;
  }

  // WhatsApp path
  await sock.sendMessage(jid, { text: `${ASSISTANT_NAME}: ${text}` });
}
```

---

## Testing Procedure

### 1. Environment Check

```bash
# Verify token is set
grep DISCORD_BOT_TOKEN .env

# Check bot is in server
# (Open Discord, verify bot appears in member list)
```

### 2. Build

```bash
npm run build
./container/build.sh
```

Verify build output shows no errors.

### 3. Manual Test

```bash
# Stop service
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist

# Run manually
npm start
```

**Test 1: Send message in Discord**

Expected: Bot responds (if channel is registered)

**Test 2: Check logs**

```bash
tail -f logs/nanoclaw.log
```

Look for:

- `Discord bot ready`
- `Discord message sent`
- No errors about missing intents

**Test 3: Tool test (Action-Only mode)**

From WhatsApp main group:

```
@Andy send "test" to Discord channel 1234567890123456789
```

Expected: Message appears in Discord channel

### 4. Service Test

```bash
# Reload service
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# Check service is running
launchctl list | grep nanoclaw
```

Expected: Service shows PID and exit code 0 or -

### 5. Restart Test

```bash
# Restart Mac
sudo shutdown -r now

# After restart, check service auto-started
launchctl list | grep nanoclaw
```

---

## Known Issues & Fixes

### Issue: Bot connects but doesn't see messages

**Cause:** Message Content Intent not enabled

**Fix:**

1. Go to https://discord.com/developers/applications
2. Select your application → Bot
3. Enable **MESSAGE CONTENT INTENT**
4. Restart bot

### Issue: No replies in registered channel

**Possible causes:**

1. **Channel not registered**
   - Check `data/registered_groups.json` has `discord:CHANNEL_ID` entry
2. **Wrong channel ID**
   - Verify ID with: Right-click channel → Copy Channel ID
3. **Bot lacks permissions**
   - Check bot has "View Channels", "Send Messages", "Read Message History"

### Issue: Invalid token error

**Cause:** Token expired or incorrect

**Fix:**

```bash
# Reset token in Discord Developer Portal
# Update .env
echo 'DISCORD_BOT_TOKEN="new_token_here"' > .env

# Rebuild and restart
npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

### Issue: Messages sent twice

**Cause:** Both service and manual process running

**Fix:**

```bash
# Stop service
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist

# Check for duplicate processes
ps aux | grep node

# Kill any extra node processes
kill <PID>
```

### Issue: Discord client disconnects randomly

**Cause:** Network issues or rate limiting

**Fix:**

Discord.js has built-in reconnection. Check logs for:

- `ECONNRESET` → Network issue
- `RATE_LIMITED` → Too many requests

Add connection error handling:

```typescript
discordClient.on('error', (error) => {
  logger.error({ error }, 'Discord client error');
});

discordClient.on('disconnect', () => {
  logger.warn('Discord client disconnected - will reconnect automatically');
});
```

---

## Troubleshooting Commands

### Check Bot Status

```bash
# Check if bot is online in Discord
# (Open Discord, bot should show online status)

# Check logs
grep -i "discord" logs/nanoclaw.log | tail -20
```

### Check Registered Channels

```bash
# List registered channels
cat data/registered_groups.json | grep "discord:"

# Check channel folders exist
ls -la groups/ | grep discord
```

### Test Discord Client Initialization

```bash
# Run manual test
node -e "
import('discord.js').then(({ Client, GatewayIntentBits }) => {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  client.login(process.env.DISCORD_BOT_TOKEN);
  client.once('ready', () => {
    console.log('✓ Bot connected');
    process.exit(0);
  });
});
" 2>&1
```

### Check Environment

```bash
# Verify token is loaded
node -e "import('dotenv/config'); console.log(process.env.DISCORD_BOT_TOKEN ? 'Token loaded' : 'Token missing');"
```

### Check Container

```bash
# Rebuild container
./container/build.sh

# Verify container exists
container list images | grep nanoclaw-agent
```

### Force Restart

```bash
# Full restart
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
killall node
npm run build
./container/build.sh
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

---

## Removing Discord Integration

To completely remove Discord and revert to WhatsApp-only:

### 1. Stop Service

```bash
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
```

### 2. Remove Discord Code

In `src/index.ts`:

- Remove `import 'dotenv/config';` (if only added for Discord)
- Remove Discord imports
- Remove `getDiscordClient()`, `sendDiscordMessage()`, `startDiscordBot()` functions
- Revert `sendMessage()` to original WhatsApp-only version
- Remove `connectDiscord()` or `startDiscordBot()` calls

### 3. Remove Discord Tool (if added)

In `container/agent-runner/src/ipc-mcp.ts`:

- Remove `discord_send_message` tool

In `src/index.ts`:

- Remove `discord_send_message` case from `processTaskIpc` switch

### 4. Remove Discord Channels from Registry

Edit `data/registered_groups.json`:

- Remove all entries starting with `discord:`

### 5. Remove Environment Variable

```bash
# Edit .env and remove:
# DISCORD_BOT_TOKEN="..."
```

### 6. Uninstall Dependencies (optional)

```bash
npm uninstall discord.js dotenv
```

### 7. Rebuild and Restart

```bash
npm run build
./container/build.sh
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

---

## Tool Availability by Context

### Main Group

All tools available:

- `send_message` - Send to current group
- `schedule_task` - Schedule for any group
- `list_tasks` - See all tasks
- `pause_task`, `resume_task`, `cancel_task` - Manage any task
- `register_group` - Add new groups
- `discord_send_message` - Send to Discord (Action-Only mode)

### Discord Channels (Non-Main)

Limited tools:

- `send_message` - Send to current Discord channel only
- `schedule_task` - Schedule for current group only
- `list_tasks` - See this group's tasks only
- `pause_task`, `resume_task`, `cancel_task` - Manage this group's tasks only
- ❌ `register_group` - Not available
- ❌ `discord_send_message` - Not available

### Scheduled Tasks

Minimal tools (requires implementing `isScheduledTask` flag):

- `send_message` - Send to the group that owns the task
- ❌ All task management tools - Not available
- ❌ `register_group` - Not available

**Implementation required:** Add `isScheduledTask` parameter to `IpcMcpContext` and filter tools accordingly.

---

## Additional Resources

### Discord.js Documentation

- https://discord.js.org/
- Gateway Intents: https://discord.js.org/docs/packages/discord.js/main/GatewayIntentBits:Enum

### Discord Developer Portal

- Applications: https://discord.com/developers/applications
- Bot permissions calculator: https://discordapi.com/permissions.html

### Rate Limits

- https://discord.com/developers/docs/topics/rate-limits

### Channel Types

- Text channels: Standard text chat
- Voice channels: Not supported in this integration
- Threads: Not supported (would require additional event handlers)
- Forums: Not supported

### Webhooks vs Bots

This integration uses **bot tokens** (Gateway API), not webhooks. Why?

- Bots can respond to messages
- Bots can use full Discord API
- Webhooks are send-only (can't read messages)

---

## Advanced: isScheduledTask Implementation

To restrict tools in scheduled tasks (recommended for security):

### 1. Update IPC MCP Context

Edit `container/agent-runner/src/ipc-mcp.ts`:

```typescript
export interface IpcMcpContext {
  chatJid: string;
  groupFolder: string;
  isMain: boolean;
  isScheduledTask: boolean; // ← ADD THIS
}
```

### 2. Filter Tools Based on Context

In `createIpcMcp()`:

```typescript
export function createIpcMcp(ctx: IpcMcpContext) {
  const { chatJid, groupFolder, isMain, isScheduledTask } = ctx;

  const tools: any[] = [];

  // send_message: Always available
  tools.push(
    tool('send_message', '...', { text: z.string() }, async (args) => { ... })
  );

  // Task management: NOT available in scheduled tasks
  if (!isScheduledTask) {
    tools.push(
      tool('schedule_task', '...', { ... }, async (args) => { ... }),
      tool('list_tasks', '...', {}, async () => { ... }),
      tool('pause_task', '...', { ... }, async (args) => { ... }),
      tool('resume_task', '...', { ... }, async (args) => { ... }),
      tool('cancel_task', '...', { ... }, async (args) => { ... }),
    );

    // register_group: Main only, not in scheduled tasks
    if (isMain) {
      tools.push(
        tool('register_group', '...', { ... }, async (args) => { ... })
      );
    }

    // discord_send_message: Main only, not in scheduled tasks (if using Action-Only mode)
    if (isMain) {
      tools.push(
        tool('discord_send_message', '...', { ... }, async (args) => { ... })
      );
    }
  }

  return createSdkMcpServer({ name: 'nanoclaw', version: '1.0.0', tools });
}
```

### 3. Pass isScheduledTask from Container Entry

Edit `container/agent-runner/src/index.ts`:

```typescript
const ipcMcp = createIpcMcp({
  chatJid: input.chatJid,
  groupFolder: input.groupFolder,
  isMain: input.isMain,
  isScheduledTask: input.isScheduledTask || false, // ← ADD THIS
});
```

### 4. Pass isScheduledTask from Host

In `src/task-scheduler.ts`, when calling `runContainerAgent()`:

```typescript
const output = await runContainerAgent(group, {
  prompt: finalPrompt,
  sessionId: task.context_mode === 'group' ? sessionId : undefined,
  groupFolder: task.group_folder,
  chatJid: task.chat_jid,
  isMain: false,
  isScheduledTask: true, // ← ADD THIS
});
```

This ensures scheduled tasks can only use `send_message` and cannot modify schedules or register new groups.

---

**End of Discord Integration Guide**
