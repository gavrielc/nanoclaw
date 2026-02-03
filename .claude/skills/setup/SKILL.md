---
name: setup
description: Run initial NanoClaw setup. Use when user wants to install dependencies, authenticate WhatsApp, register their main channel, or start the background services. Triggers on "setup", "install", "configure nanoclaw", or first-time setup requests.
---

# NanoClaw Setup

Run all commands automatically. Only pause when user action is required (scanning QR codes).

## 1. Capability Detection

**Run this first to understand the environment:**

```bash
echo "=== NanoClaw Capability Detection ==="
echo ""
echo "Platform: $(uname -s) $(uname -m)"
echo ""

echo "Container Runtimes:"
if command -v container &>/dev/null && container --version &>/dev/null 2>&1; then
  echo "  ✓ Apple Container: $(container --version 2>/dev/null | head -1)"
  APPLE_OK=1
else
  echo "  ✗ Apple Container: not installed"
  APPLE_OK=0
fi

if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
  echo "  ✓ Docker: $(docker --version | head -1)"
  DOCKER_OK=1
else
  if command -v docker &>/dev/null; then
    echo "  △ Docker: installed but not running"
  else
    echo "  ✗ Docker: not installed"
  fi
  DOCKER_OK=0
fi

if command -v podman &>/dev/null && podman info &>/dev/null 2>&1; then
  echo "  ✓ Podman: $(podman --version | head -1)"
  PODMAN_OK=1
else
  echo "  ✗ Podman: not installed"
  PODMAN_OK=0
fi

echo ""
echo "Claude Authentication:"
if [ -f ~/.claude/.credentials.json ]; then
  TOKEN=$(cat ~/.claude/.credentials.json 2>/dev/null | jq -r '.claudeAiOauth.accessToken // empty')
  if [ -n "$TOKEN" ]; then
    echo "  ✓ OAuth token found"
  else
    echo "  ✗ No OAuth token (run 'claude' and log in)"
  fi
else
  echo "  ✗ No credentials file"
fi

echo ""
echo "=== Detection Complete ==="
```

**Present the results to the user:**

> **Environment detected:**
> - Platform: [macOS/Linux] [architecture]
> - Apple Container: [✓ available | ✗ not available]
> - Docker: [✓ running | △ installed but not running | ✗ not installed]
> - Podman: [✓ available | ✗ not available]
> - Claude Auth: [✓ OAuth token | ✗ needs setup]

## 2. Choose Container Runtime

Based on detection, present available options:

**If multiple runtimes available:**
> Which container runtime do you want to use?
>
> [List only the ones that are ✓ available or can be started]
> 1. **Apple Container** - macOS-native, lightweight (recommended for macOS)
> 2. **Docker** - Cross-platform, widely used
> 3. **Podman** - Rootless containers, Docker-compatible

**If only one runtime available:**
> I'll use [runtime] since that's what's available.

**If NO runtime available:**
> No container runtime found. You need one of these:
>
> **macOS options:**
> - Apple Container: https://github.com/apple/container/releases (download .pkg)
> - Docker Desktop: https://www.docker.com/products/docker-desktop/
>
> **Linux options:**
> - Docker: `curl -fsSL https://get.docker.com | sh`
> - Podman: `sudo apt install podman` (Debian/Ubuntu) or `sudo dnf install podman` (Fedora)
>
> Install one and run `/setup` again.

**If Docker installed but not running:**
> Docker is installed but not running.
> - macOS: Start Docker Desktop from Applications
> - Linux: `sudo systemctl start docker`
>
> Start it and let me know when ready.

### Set the runtime environment variable

Once chosen, set it for this session and persist it:

```bash
# Set for this session
export CONTAINER_RUNTIME=docker  # or 'container' or 'podman'

# Persist in .env
grep -q "^CONTAINER_RUNTIME=" .env 2>/dev/null && \
  sed -i '' "s/^CONTAINER_RUNTIME=.*/CONTAINER_RUNTIME=$CONTAINER_RUNTIME/" .env || \
  echo "CONTAINER_RUNTIME=$CONTAINER_RUNTIME" >> .env
```

## 3. Install Dependencies

```bash
npm install
```

## 3. Configure Claude Authentication

Ask the user:
> Do you want to use your **Claude subscription** (Pro/Max) or an **Anthropic API key**?

### Option 1: Claude Subscription (Recommended)

Ask the user:
> Want me to grab the OAuth token from your current Claude session?

If yes:
```bash
TOKEN=$(cat ~/.claude/.credentials.json 2>/dev/null | jq -r '.claudeAiOauth.accessToken // empty')
if [ -n "$TOKEN" ]; then
  echo "CLAUDE_CODE_OAUTH_TOKEN=$TOKEN" > .env
  echo "Token configured: ${TOKEN:0:20}...${TOKEN: -4}"
else
  echo "No token found - are you logged in to Claude Code?"
fi
```

If the token wasn't found, tell the user:
> Run `claude` in another terminal and log in first, then come back here.

### Option 2: API Key

Ask if they have an existing key to copy or need to create one.

**Copy existing:**
```bash
grep "^ANTHROPIC_API_KEY=" /path/to/source/.env > .env
```

**Create new:**
```bash
echo 'ANTHROPIC_API_KEY=' > .env
```

Tell the user to add their key from https://console.anthropic.com/

**Verify:**
```bash
KEY=$(grep "^ANTHROPIC_API_KEY=" .env | cut -d= -f2)
[ -n "$KEY" ] && echo "API key configured: ${KEY:0:10}...${KEY: -4}" || echo "Missing"
```

## 4. Build Container Image

Build the NanoClaw agent container:

```bash
./container/build.sh
```

This creates the `nanoclaw-agent:latest` image with Node.js, Chromium, Claude Code CLI, and agent-browser.

Verify the build succeeded by running a simple test (this auto-detects which runtime you're using):

```bash
if which docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo '{}' | docker run -i --entrypoint /bin/echo nanoclaw-agent:latest "Container OK" || echo "Container build failed"
else
  echo '{}' | container run -i --entrypoint /bin/echo nanoclaw-agent:latest "Container OK" || echo "Container build failed"
fi
```

## 5. WhatsApp Authentication

**USER ACTION REQUIRED**

Run the authentication script:

```bash
npm run auth
```

Tell the user:
> A QR code will appear. On your phone:
> 1. Open WhatsApp
> 2. Tap **Settings → Linked Devices → Link a Device**
> 3. Scan the QR code

Wait for the script to output "Successfully authenticated" then continue.

If it says "Already authenticated", skip to the next step.

## 6. Configure Assistant Name

Ask the user:
> What trigger word do you want to use? (default: `Andy`)
>
> Messages starting with `@TriggerWord` will be sent to Claude.

If they choose something other than `Andy`, update it in these places:
1. `groups/CLAUDE.md` - Change "# Andy" and "You are Andy" to the new name
2. `groups/main/CLAUDE.md` - Same changes at the top
3. `data/registered_groups.json` - Use `@NewName` as the trigger when registering groups

Store their choice - you'll use it when creating the registered_groups.json and when telling them how to test.

## 7. Register Main Channel

Ask the user:
> Do you want to use your **personal chat** (message yourself) or a **WhatsApp group** as your main control channel?

For personal chat:
> Send any message to yourself in WhatsApp (the "Message Yourself" chat). Tell me when done.

For group:
> Send any message in the WhatsApp group you want to use as your main channel. Tell me when done.

After user confirms, start the app briefly to capture the message:

```bash
timeout 10 npm run dev || true
```

Then find the JID from the database:

```bash
# For personal chat (ends with @s.whatsapp.net)
sqlite3 store/messages.db "SELECT DISTINCT chat_jid FROM messages WHERE chat_jid LIKE '%@s.whatsapp.net' ORDER BY timestamp DESC LIMIT 5"

# For group (ends with @g.us)
sqlite3 store/messages.db "SELECT DISTINCT chat_jid FROM messages WHERE chat_jid LIKE '%@g.us' ORDER BY timestamp DESC LIMIT 5"
```

Create/update `data/registered_groups.json` using the JID from above and the assistant name from step 5:
```json
{
  "JID_HERE": {
    "name": "main",
    "folder": "main",
    "trigger": "@ASSISTANT_NAME",
    "added_at": "CURRENT_ISO_TIMESTAMP"
  }
}
```

Ensure the groups folder exists:
```bash
mkdir -p groups/main/logs
```

## 8. Configure External Directory Access (Mount Allowlist)

Ask the user:
> Do you want the agent to be able to access any directories **outside** the NanoClaw project?
>
> Examples: Git repositories, project folders, documents you want Claude to work on.
>
> **Note:** This is optional. Without configuration, agents can only access their own group folders.

If **no**, create an empty allowlist to make this explicit:

```bash
mkdir -p ~/.config/nanoclaw
cat > ~/.config/nanoclaw/mount-allowlist.json << 'EOF'
{
  "allowedRoots": [],
  "blockedPatterns": [],
  "nonMainReadOnly": true
}
EOF
echo "Mount allowlist created - no external directories allowed"
```

Skip to the next step.

If **yes**, ask follow-up questions:

### 8a. Collect Directory Paths

Ask the user:
> Which directories do you want to allow access to?
>
> You can specify:
> - A parent folder like `~/projects` (allows access to anything inside)
> - Specific paths like `~/repos/my-app`
>
> List them one per line, or give me a comma-separated list.

For each directory they provide, ask:
> Should `[directory]` be **read-write** (agents can modify files) or **read-only**?
>
> Read-write is needed for: code changes, creating files, git commits
> Read-only is safer for: reference docs, config examples, templates

### 8b. Configure Non-Main Group Access

Ask the user:
> Should **non-main groups** (other WhatsApp chats you add later) be restricted to **read-only** access even if read-write is allowed for the directory?
>
> Recommended: **Yes** - this prevents other groups from modifying files even if you grant them access to a directory.

### 8c. Create the Allowlist

Create the allowlist file based on their answers:

```bash
mkdir -p ~/.config/nanoclaw
```

Then write the JSON file. Example for a user who wants `~/projects` (read-write) and `~/docs` (read-only) with non-main read-only:

```bash
cat > ~/.config/nanoclaw/mount-allowlist.json << 'EOF'
{
  "allowedRoots": [
    {
      "path": "~/projects",
      "allowReadWrite": true,
      "description": "Development projects"
    },
    {
      "path": "~/docs",
      "allowReadWrite": false,
      "description": "Reference documents"
    }
  ],
  "blockedPatterns": [],
  "nonMainReadOnly": true
}
EOF
```

Verify the file:

```bash
cat ~/.config/nanoclaw/mount-allowlist.json
```

Tell the user:
> Mount allowlist configured. The following directories are now accessible:
> - `~/projects` (read-write)
> - `~/docs` (read-only)
>
> **Security notes:**
> - Sensitive paths (`.ssh`, `.gnupg`, `.aws`, credentials) are always blocked
> - This config file is stored outside the project, so agents cannot modify it
> - Changes require restarting the NanoClaw service
>
> To grant a group access to a directory, add it to their config in `data/registered_groups.json`:
> ```json
> "containerConfig": {
>   "additionalMounts": [
>     { "hostPath": "~/projects/my-app", "containerPath": "my-app", "readonly": false }
>   ]
> }
> ```

## 9. Configure Background Service

Build first:

```bash
npm run build
mkdir -p logs
```

Detect platform and configure the appropriate service:

```bash
echo "Platform: $(uname -s)"
```

### macOS: launchd

```bash
NODE_PATH=$(which node)
PROJECT_PATH=$(pwd)
HOME_PATH=$HOME

cat > ~/Library/LaunchAgents/com.nanoclaw.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nanoclaw</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>${PROJECT_PATH}/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${PROJECT_PATH}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:${HOME_PATH}/.local/bin</string>
        <key>HOME</key>
        <string>${HOME_PATH}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${PROJECT_PATH}/logs/nanoclaw.log</string>
    <key>StandardErrorPath</key>
    <string>${PROJECT_PATH}/logs/nanoclaw.error.log</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl list | grep nanoclaw
```

### Linux: systemd

```bash
NODE_PATH=$(which node)
PROJECT_PATH=$(pwd)
HOME_PATH=$HOME

mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/nanoclaw.service << EOF
[Unit]
Description=NanoClaw WhatsApp Assistant
After=network.target docker.service

[Service]
Type=simple
WorkingDirectory=${PROJECT_PATH}
ExecStart=${NODE_PATH} ${PROJECT_PATH}/dist/index.js
Restart=always
RestartSec=10
Environment=PATH=/usr/local/bin:/usr/bin:/bin:${HOME_PATH}/.local/bin
Environment=HOME=${HOME_PATH}

StandardOutput=append:${PROJECT_PATH}/logs/nanoclaw.log
StandardError=append:${PROJECT_PATH}/logs/nanoclaw.error.log

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable nanoclaw
systemctl --user start nanoclaw
systemctl --user status nanoclaw

# Allow service to run without being logged in
sudo loginctl enable-linger $USER
```

## 10. Test

Tell the user (using the assistant name they configured):
> Send `@ASSISTANT_NAME hello` in your registered chat.

Check the logs:
```bash
tail -f logs/nanoclaw.log
```

The user should receive a response in WhatsApp.

## Troubleshooting

**Service not starting**:
- macOS: `cat logs/nanoclaw.error.log`
- Linux: `journalctl --user -u nanoclaw -f`

**Container agent fails with "Claude Code process exited with code 1"**:
- Check your runtime is running:
  - Apple Container: `container system start`
  - Docker: `docker info` (start Docker Desktop on macOS, or `sudo systemctl start docker` on Linux)
  - Podman: `podman info`
- Check container logs: `cat groups/main/logs/container-*.log | tail -50`

**No response to messages**:
- Verify the trigger pattern matches (e.g., `@AssistantName` at start of message)
- Check that the chat JID is in `data/registered_groups.json`
- Check `logs/nanoclaw.log` for errors

**WhatsApp disconnected**:
- Run `npm run auth` to re-authenticate
- Restart:
  - macOS: `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`
  - Linux: `systemctl --user restart nanoclaw`

**Stop/disable service**:
- macOS: `launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist`
- Linux: `systemctl --user stop nanoclaw && systemctl --user disable nanoclaw`

**Run manually (for debugging)**:
```bash
# Stop the service first
npm run dev
```
