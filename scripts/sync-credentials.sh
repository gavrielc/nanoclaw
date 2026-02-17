#!/bin/bash
# Sync Claude credentials to keep agent tokens fresh
# Root's credentials are refreshed by active Claude Code sessions
# The agent process (nanoclaw user) reads from $HOME/.claude/ where
# HOME=/root/nanoclaw/data/sessions/{group} (set by process-runner)

SRC=/root/.claude/.credentials.json
[ -f "$SRC" ] || exit 0

# Ensure root credentials are group-readable
chmod 770 /root/.claude/ 2>/dev/null
chmod 660 "$SRC" 2>/dev/null

# Sync to nanoclaw user's home
mkdir -p /home/nanoclaw/.claude
cp "$SRC" /home/nanoclaw/.claude/.credentials.json 2>/dev/null
chown nanoclaw:nanoclaw /home/nanoclaw/.claude/.credentials.json 2>/dev/null
chmod 600 /home/nanoclaw/.claude/.credentials.json 2>/dev/null

# Sync to all agent session directories (where the SDK actually reads from)
for session_dir in /root/nanoclaw/data/sessions/*/; do
  [ -d "$session_dir" ] || continue
  mkdir -p "${session_dir}.claude"
  cp "$SRC" "${session_dir}.claude/.credentials.json"
  chown nanoclaw:nanoclaw "${session_dir}.claude/.credentials.json" 2>/dev/null
  chmod 660 "${session_dir}.claude/.credentials.json" 2>/dev/null
done
