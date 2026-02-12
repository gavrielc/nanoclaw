#!/bin/bash
set -e

# Source environment variables from mounted env file
[ -f /workspace/env-dir/env ] && export $(cat /workspace/env-dir/env | xargs)

# Cap JS heap to prevent OOM (Apple Container --memory flag is broken in v0.9.0)
# Only set heap caps in container environments; Sprites have more RAM and
# BUN_JSC_MAX_HEAP_SIZE may not be supported in all bun versions.
export NODE_OPTIONS="--max-old-space-size=2048"
if [ -f /.dockerenv ] || grep -q 'container' /proc/1/cgroup 2>/dev/null; then
  export BUN_JSC_MAX_HEAP_SIZE=2147483648 2>/dev/null || true
fi

# Configure git with GitHub token
if [ -n "$GITHUB_TOKEN" ]; then
  gh auth setup-git 2>/dev/null || true
  git config --global user.name "${GIT_AUTHOR_NAME:-NanoClaw Agent}"
  git config --global user.email "${GIT_AUTHOR_EMAIL:-nanoclaw@users.noreply.github.com}"
fi

# Buffer stdin then run agent.
# If /tmp/input.json already exists (pre-written by Sprites backend),
# skip the stdin buffering step. Apple Container requires EOF to flush stdin pipe.
if [ ! -s /tmp/input.json ]; then
  cat > /tmp/input.json
fi
bun /app/src/index.ts < /tmp/input.json
