#!/bin/bash
set -e

# Source environment variables from mounted env file
[ -f /workspace/env-dir/env ] && export $(cat /workspace/env-dir/env | xargs)

# Configure git with GitHub token
if [ -n "$GITHUB_TOKEN" ]; then
  gh auth setup-git 2>/dev/null || true
  git config --global user.name "${GIT_AUTHOR_NAME:-NanoClaw Agent}"
  git config --global user.email "${GIT_AUTHOR_EMAIL:-nanoclaw@users.noreply.github.com}"
fi

# Buffer stdin then run agent (Apple Container requires EOF to flush stdin pipe)
cat > /tmp/input.json
bun /app/src/index.ts < /tmp/input.json
