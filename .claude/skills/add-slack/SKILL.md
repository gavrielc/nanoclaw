---
name: add-slack
description: Add Slack integration to NanoClaw. Can be configured as an additional channel (both Slack and WhatsApp work) or as a complete replacement for WhatsApp. Guides through Slack app setup and implements the integration.
---

# Add Slack Integration

This skill adds Slack capabilities to NanoClaw. It can be configured in two modes:

1. **Additional Channel** - Both Slack and WhatsApp trigger the agent
2. **Replace WhatsApp** - Slack becomes the only channel

> **Compatibility:** NanoClaw v1.0.0+. Directory structure may change in future versions.

## File Structure

```
.claude/skills/add-slack/
├── SKILL.md          # This documentation
├── host.ts           # Host-side IPC handler (copy to src/slack-host.ts)
├── agent.ts          # Container-side MCP tools (copied to container during build)
└── slack-channel.ts  # Slack event listener (copy to src/)
```

## Features

| Tool | Description |
|------|-------------|
| `slack_send_message` | Send messages to channels or threads |
| `slack_list_channels` | List available Slack channels |
| `slack_read_messages` | Read recent channel messages |
| `slack_get_channel_info` | Get channel details (topic, purpose, members) |
| `slack_add_reaction` | Add emoji reactions to messages |

## Initial Questions

Ask the user:

> How do you want to use Slack with NanoClaw?
>
> **Option 1: Additional Channel** (Recommended)
> - Both Slack and WhatsApp trigger the agent
> - Messages in Slack channels trigger the agent, replies go to threads
> - WhatsApp continues to work as before
> - Best for using both platforms
>
> **Option 2: Replace WhatsApp**
> - Slack becomes your only channel
> - Removes WhatsApp integration entirely
> - Best for teams already using Slack

Store their choice and proceed to the appropriate section.

---

## Prerequisites (All Modes)

### 1. Check Claude Authentication

**CRITICAL:** The container agent needs Claude authentication to work. Check this FIRST:

```bash
# Check for API key in .env OR credentials file
if grep -q "^ANTHROPIC_API_KEY=sk-ant-" .env 2>/dev/null || \
   [ -f data/sessions/main/.claude/.credentials.json ]; then
  echo "✓ Claude authentication configured"
else
  echo "✗ Claude authentication NOT configured"
  echo ""
  echo "You must run /setup first to configure authentication."
  exit 1
fi
```

If the check fails, **STOP HERE** and tell the user:

> **You need to run `/setup` first** to configure Claude authentication and the background service. Once that's done, come back and run `/add-slack` again.

### 2. Check Existing Slack Setup

First, check if Slack is already configured:

```bash
cat .env | grep -E "SLACK_BOT_TOKEN|SLACK_APP_TOKEN" || echo "No Slack config found"
```

If both tokens exist, skip to "Verify Slack Access" below.

### 3. Create Slack App

**USER ACTION REQUIRED**

Tell the user:

> I need you to create a Slack app. I'll walk you through it:
>
> 1. Open https://api.slack.com/apps in your browser
> 2. Click **Create New App**
> 3. Choose **From scratch**
> 4. Name it something like "NanoClaw" and select your workspace
> 5. Click **Create App**

Wait for user confirmation, then continue:

> 6. Now let's configure the bot:
>    - In the left sidebar, go to **OAuth & Permissions**
>    - Scroll to **Scopes** → **Bot Token Scopes**
>    - Add these scopes:
>      - `chat:write` - Send messages
>      - `channels:history` - Read public channel messages
>      - `groups:history` - Read private channel messages
>      - `im:history` - Read DM messages
>      - `channels:read` - List channels
>      - `groups:read` - List private channels
>      - `users:read` - Get user info
>      - `reactions:read` - Read emoji reactions
>      - `reactions:write` - Add emoji reactions
>      - `app_mentions:read` - Detect @mentions (required for mention trigger mode)

Wait for user confirmation, then continue:

> 7. Enable Socket Mode (required for receiving messages):
>    - In the left sidebar, go to **Socket Mode**
>    - Toggle **Enable Socket Mode** ON
>    - A dialog will prompt you to create an app-level token
>    - Add the `connections:write` scope
>    - Click **Generate**
>    - Copy the **App-Level Token** (starts with `xapp-`)
>
> If the dialog doesn't appear or you need to regenerate:
> - Go to **Basic Information** > **App-Level Tokens** > **Generate Token and Scopes**
>
> What is your App-Level Token?

Store the app token.

> 8. Enable Events:
>    - In the left sidebar, go to **Event Subscriptions**
>    - Toggle **Enable Events** ON
>    - Under **Subscribe to bot events**, add:
>      - `message.channels` - Messages in public channels
>      - `message.groups` - Messages in private channels
>      - `message.im` - Direct messages
>      - `app_mention` - When someone @mentions your bot
>    - Click **Save Changes**

Wait for user confirmation.

> 9. Install the app to your workspace:
>    - Go to **Manage Distribution** in the left sidebar
>    - Click the **Add to Slack** button
>    - Click **Allow** on the permissions screen
>    - Go back to **OAuth & Permissions**
>    - Copy the **Bot User OAuth Token** (starts with `xoxb-`) from the top of the page
>
> What is your Bot User OAuth Token?

Store the bot token.

### 4. Save Credentials

Write the tokens to `.env`:

```bash
# Add Slack tokens to .env
cat >> .env << 'EOF'

# Slack Integration
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_APP_TOKEN=xapp-your-token-here
EOF
```

Replace the placeholder values with the actual tokens provided by the user.

### 5. Sync Environment to Container

**CRITICAL:** The container reads environment variables from `data/env/env`, not directly from `.env`. After adding tokens to `.env`, sync them:

```bash
# Extract only allowed variables for container (security: don't expose all env vars)
grep -E "^(CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY|SLACK_BOT_TOKEN)=" .env > data/env/env
```

Without this sync, the container agent cannot access `SLACK_BOT_TOKEN` and Slack tools will fail.

### 6. Install Dependencies

```bash
npm install @slack/bolt @slack/web-api
```

### 7. Verify Slack Access

Test the connection:

```bash
npx tsx -e "
const { WebClient } = require('@slack/web-api');
const client = new WebClient(process.env.SLACK_BOT_TOKEN);
client.auth.test().then(r => console.log('Connected as:', r.user)).catch(e => console.error('Error:', e.message));
" 2>/dev/null || echo "Connection test requires running with dotenv"
```

Or verify manually:

```bash
# Check tokens are set
grep -E "^SLACK_BOT_TOKEN=xoxb-" .env && echo "Bot token configured"
grep -E "^SLACK_APP_TOKEN=xapp-" .env && echo "App token configured"
```

---

## Architecture Notes

**Environment Variables:** Secrets go in `.env`, but container reads from `data/env/env`. After changing `.env`, sync with:
```bash
grep -E "^(CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY|SLACK_BOT_TOKEN)=" .env > data/env/env
```

**Message Flows:**
- Slack → Host (Socket Mode) → Agent → Response (auto-posted to thread)
- Agent tools → IPC files → Host → Slack API

**Avoiding Duplicates:** Agent responses are auto-posted. Only use `slack_send_message` for OTHER channels/threads, not to echo the current response.

---

## Additional Channel Implementation

This mode enables both Slack and WhatsApp as input channels.

### Step 1: Copy Host IPC Handler to src/

The host.ts file must be in src/ for TypeScript compilation (rootDir constraint).

Copy `.claude/skills/add-slack/host.ts` to `src/slack-host.ts`. The logger import is already correct for the `src/` location — no changes needed.

### Step 2: Integrate Host IPC Handler

Read `src/index.ts` and add the import after other local imports:

```typescript
import { handleSlackIpc } from './slack-host.js';
```

Modify `processTaskIpc` function's switch statement default case:

```typescript
// Find:
default:
  logger.warn({ type: data.type }, 'Unknown IPC task type');

// Replace with:
default:
  const slackHandled = await handleSlackIpc(data as Record<string, unknown>, sourceGroup, isMain, DATA_DIR);
  if (!slackHandled) {
    logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
```

If X integration is already present, chain the handlers:

```typescript
default:
  let handled = await handleXIpc(data, sourceGroup, isMain, DATA_DIR);
  if (!handled) {
    handled = await handleSlackIpc(data as Record<string, unknown>, sourceGroup, isMain, DATA_DIR);
  }
  if (!handled) {
    logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
```

### Step 3: Integrate Container MCP Tools

Read `container/agent-runner/src/ipc-mcp.ts` and add the import after `cron-parser` import:

```typescript
// @ts-ignore - Copied during Docker build from .claude/skills/add-slack/
import { createSlackTools } from './skills/add-slack/agent.js';
```

Add to the end of the tools array (before the closing `]`):

```typescript
    ...createSlackTools({ groupFolder, isMain })
```

### Step 4: Update Dockerfile Build Context

The Dockerfile needs access to `.claude/skills/` which is outside `container/`. Update `container/build.sh`:

```bash
# Change:
cd "$SCRIPT_DIR"
container build -t "${IMAGE_NAME}:${TAG}" .

# To:
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"
container build -t "${IMAGE_NAME}:${TAG}" -f container/Dockerfile .
```

Then update `container/Dockerfile` paths (since context is now project root):

```dockerfile
# Change:
COPY agent-runner/package*.json ./
COPY agent-runner/ ./

# To:
COPY container/agent-runner/package*.json ./
COPY container/agent-runner/ ./
```

Add the Slack skill copy after the agent-runner copy:

```dockerfile
# Copy Slack skill MCP tools
COPY .claude/skills/add-slack/agent.ts ./src/skills/add-slack/
```

### Step 5: Add Tokens to LaunchAgent

**CRITICAL:** The launchd service doesn't read from `.env`. Add the Slack tokens to the plist:

Read `~/Library/LaunchAgents/com.nanoclaw.plist` and add to the `EnvironmentVariables` dict:

```xml
<key>SLACK_BOT_TOKEN</key>
<string>xoxb-your-token-here</string>
<key>SLACK_APP_TOKEN</key>
<string>xapp-your-token-here</string>
```

After editing, reload the service:

```bash
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
```

### Step 6: Create Slack Event Handler

Copy `.claude/skills/add-slack/slack-channel.ts` to `src/slack-channel.ts`. The logger import is already correct for the `src/` location.

The handler behavior:
- Responds to @mentions (starts a thread)
- Responds to all messages in threads it started
- Responds to all direct messages
- You control which channels it can access by adding/removing the bot in Slack

The handler should:
- Listen for `app_mention` events (for @mentions)
- Listen for `message` events (for thread replies and DMs)
- Filter out bot's own messages to prevent loops
- Track which threads were started by the bot to respond to replies

### Step 7: Integrate with Main Process

**IMPORTANT:** For Additional Channel Mode, Slack must start INDEPENDENTLY of WhatsApp. Do not nest it inside the WhatsApp connection handler.

Read `src/index.ts` and add the import:

```typescript
import { startSlackListener } from './slack-channel.js';
```

#### 7a. Move common services from WhatsApp handler to main()

Find the `connection === 'open'` block in `connectWhatsApp()` and **REMOVE** these lines (they'll move to main):

```typescript
// REMOVE these from the WhatsApp connection handler:
startSchedulerLoop({
  sendMessage,
  registeredGroups: () => registeredGroups,
  getSessions: () => sessions,
});
startIpcWatcher();
```

Keep `startMessageLoop()` in the connection handler - it's WhatsApp-specific.

#### 7b. Update main() function to start both channels independently

Replace the `main()` function:

```typescript
async function main(): Promise<void> {
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');
  loadState();

  // Start common services (independent of channels)
  startSchedulerLoop({
    sendMessage,
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
  });
  startIpcWatcher();

  // Start WhatsApp channel
  connectWhatsApp().catch((err) => {
    logger.error({ err }, 'WhatsApp connection failed, but continuing with other channels');
  });

  // Start Slack channel (Additional Channel Mode - independent of WhatsApp)
  startSlackListener(async ({ text, channelId, userId, userName, threadTs, say }) => {
    // Create a virtual "slack" group for Slack conversations
    const slackGroup: RegisteredGroup = {
      name: 'Slack',
      folder: 'slack',
      trigger: '',
      added_at: new Date().toISOString(),
    };

    // Ensure slack group folder exists
    const slackDir = path.join(DATA_DIR, '..', 'groups', 'slack');
    fs.mkdirSync(path.join(slackDir, 'logs'), { recursive: true });

    // Build prompt
    const prompt = `<slack_message>
<channel>${channelId}</channel>
<user>${userName}</user>
<user_id>${userId}</user_id>
<text>${text}</text>
</slack_message>

Respond to this Slack message. Your response will be posted as a reply.`;

    const response = await runAgent(slackGroup, prompt, `slack:${channelId}`);

    if (response) {
      await say(response);
    }
  }).catch(err => logger.error({ err }, 'Failed to start Slack listener'));

  logger.info('NanoClaw started - both WhatsApp and Slack channels active');
}
```

**Why this structure?**
- Common services (scheduler, IPC) start once at the beginning
- WhatsApp and Slack start independently - if one fails, the other keeps working
- WhatsApp-specific code (message loop) stays in its connection handler
- Slack works even if WhatsApp authentication expires

#### 7c. Prevent WhatsApp errors from killing Slack

In `connectWhatsApp()`, find the QR code handler and modify it to not exit the process:

```typescript
// Find this:
if (qr) {
  const msg =
    'WhatsApp authentication required. Run /setup in Claude Code.';
  logger.error(msg);
  exec(
    `osascript -e 'display notification "${msg}" with title "NanoClaw" sound name "Basso"'`,
  );
  setTimeout(() => process.exit(1), 1000);  // ❌ Don't kill the process!
}

// Change to:
if (qr) {
  const msg =
    'WhatsApp authentication required. Run /setup in Claude Code. (Slack will continue working independently)';
  logger.error(msg);
  exec(
    `osascript -e 'display notification "${msg}" with title "NanoClaw" sound name "Basso"'`,
  );
  return;  // ✅ Exit this handler but keep Slack running
}
```

### Step 8: Create Slack Group Memory

```bash
mkdir -p groups/slack
```

Write `groups/slack/CLAUDE.md`:

```markdown
# Slack Channel

You are responding to messages from Slack. Your responses will be posted as thread replies.

## Guidelines

- Be conversational but professional
- Use Slack formatting when appropriate (bold with *text*, code with `code`)
- Keep responses concise - Slack is for quick communication
- If asked to do something complex, acknowledge and explain what you're doing

## Available Tools

You have access to Slack tools:
- `slack_send_message` - Send messages to channels
- `slack_list_channels` - List available channels
- `slack_read_messages` - Read channel history
```

### Step 9: Rebuild and Restart

```bash
cd container && ./build.sh
```

Wait for build, then:

```bash
cd .. && npm run build
```

Then restart the service:

```bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

### Step 10: Test

Tell the user:

> Slack is set up! Test both channels:
>
> **From WhatsApp:**
> `@Andy list my slack channels`
>
> **From Slack:**
> 1. @mention your bot in any channel: `@NanoClaw what time is it?`
> 2. The bot should respond in a thread

---

## Replace WhatsApp Implementation

This mode removes WhatsApp and uses Slack as the only channel.

### Step 1: Complete Additional Channel Steps First

Complete all Additional Channel steps (1-11) above before continuing.

### Step 2: Modify Main Process

This is a significant change. The user should understand that WhatsApp will be removed.

Ask the user:

> **Warning:** This will remove WhatsApp integration. Your existing WhatsApp groups and tasks will stop working.
>
> Are you sure you want to proceed? (yes/no)

If yes, continue:

Read `src/index.ts` and make these changes:

1. Remove or comment out the WhatsApp connection:

```typescript
// Comment out: await connectWhatsApp();
```

2. Modify the main function to start only Slack:

```typescript
async function main(): Promise<void> {
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');
  loadState();

  // Start Slack as primary channel
  await startSlackAsPrimary();
}
```

3. Create the Slack primary function:

```typescript
async function startSlackAsPrimary(): Promise<void> {
  logger.info('Starting Slack as primary channel');

  // Start IPC watcher for container communication
  startIpcWatcher();

  // Start scheduler
  startSchedulerLoop({
    sendMessage: async (jid, text) => {
      // Route messages to Slack instead of WhatsApp
      if (jid.startsWith('slack:')) {
        const channelId = jid.replace('slack:', '');
        const { WebClient } = await import('@slack/web-api');
        const client = new WebClient(process.env.SLACK_BOT_TOKEN);
        await client.chat.postMessage({ channel: channelId, text });
      }
    },
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
  });

  // Start Slack listener
  await startSlackListener(async ({ text, channelId, userId, threadTs, say }) => {
    // ... same as Additional Channel ...
  });

  logger.info('NanoClaw running with Slack as primary channel');
}
```

### Step 3: Update Configuration

Modify `src/config.ts` to reflect Slack as primary:

```typescript
export const PRIMARY_CHANNEL = 'slack';  // or 'whatsapp'
```

### Step 4: Rebuild and Restart

```bash
npm run build
```

Then restart the service:

```bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

---

## Verification Checklist

Quick checks to verify your Slack integration:

```bash
# 1. Check tokens are configured
grep -E "SLACK_BOT_TOKEN|SLACK_APP_TOKEN" .env && \
grep "SLACK_BOT_TOKEN" data/env/env && \
echo "✓ Tokens configured"

# 2. Check code integration
grep "handleSlackIpc" src/index.ts && \
grep "createSlackTools" container/agent-runner/src/ipc-mcp.ts && \
echo "✓ Code integrated"

# 3. Check service status
launchctl list | grep nanoclaw && echo "✓ Service running"
tail -5 logs/nanoclaw.log
```

### End-to-End Test

1. Invite the bot to a channel: `/invite @YourBotName`
2. @mention the bot: `@YourBotName what can you do?`
3. Reply in the thread without @mention
4. Expected: Bot responds to both messages

---

## Troubleshooting

### Container can't access Slack token

**Symptoms:** Tools fail, "SLACK_BOT_TOKEN not configured", or listener won't start.

**Fix:** Sync tokens to container and restart:
```bash
grep -E "^(CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY|SLACK_BOT_TOKEN)=" .env > data/env/env
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

If service still won't start, tokens might not be in launchd plist. Add to `~/Library/LaunchAgents/com.nanoclaw.plist`:
```xml
<key>SLACK_BOT_TOKEN</key>
<string>xoxb-your-token</string>
<key>SLACK_APP_TOKEN</key>
<string>xapp-your-token</string>
```
Then reload: `launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist && launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist`

### Container agent fails (exit code 1)

This should be caught by Prerequisites check. If it still happens, run `/setup` to configure Claude authentication.

### account_inactive error

Reinstall the app to workspace:
1. Go to https://api.slack.com/apps → your app → **OAuth & Permissions**
2. Click **Reinstall to Workspace**
3. Copy the new Bot Token (starts with `xoxb-`)
4. Update `.env` and plist, then restart

### Bot not responding

- Invite bot to channel: `/invite @YourBotName`
- Check Socket Mode and Event Subscriptions are enabled in Slack app settings
- Check logs: `tail -20 logs/nanoclaw.log | grep -i slack`
- If `missing_scope` error: add scope in OAuth & Permissions, then reinstall app

---

## Removing Slack Integration

To remove Slack entirely:

1. Remove from `src/index.ts`:
   - Delete `handleSlackIpc` import and call
   - Delete `startSlackListener` import and call

2. Remove from `container/agent-runner/src/ipc-mcp.ts`:
   - Delete `createSlackTools` import and spread

3. Remove from `container/Dockerfile`:
   - Delete the Slack COPY line

4. Remove dependencies:
   ```bash
   npm uninstall @slack/bolt @slack/web-api
   ```

5. Remove from `.env`:
   ```bash
   grep -v "SLACK_" .env > .env.tmp && mv .env.tmp .env
   ```

6. Delete Slack files:
   ```bash
   rm -rf src/slack-host.ts src/slack-channel.ts .claude/skills/add-slack/
   rm -rf groups/slack
   ```

7. Rebuild:
   ```bash
   cd container && ./build.sh && cd ..
   npm run build
   # Restart service if running
   launchctl list 2>/dev/null | grep -q nanoclaw && launchctl kickstart -k gui/$(id -u)/com.nanoclaw
   ```
