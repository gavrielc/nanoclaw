#!/usr/bin/env bash
# Test sandbox for /update-nanoclaw skill
#
# Creates isolated git sandboxes for different scenarios.
#
# Usage:
#   bash .claude/skills/update-nanoclaw/test-sandbox.sh [--case <name>] [--quiet]
#
# Cases:
#   merge-conflict  (default)
#   clean-merge
#   no-upstream
#   bad-upstream
#   no-main-master
#   cherry-conflict
#   validate-fail

set -euo pipefail

CASE="merge-conflict"
QUIET=0

usage() {
  cat << 'USAGE'
Usage: test-sandbox.sh [--case <name>] [--quiet]

Cases:
  merge-conflict  Create diverged repos with 2 predictable merge conflicts.
  clean-merge     Create diverged repos that merge cleanly.
  no-upstream     User clone has no "upstream" remote.
  bad-upstream    Upstream remote exists but fetch fails.
  no-main-master  Upstream has no main/master (uses develop).
  cherry-conflict Two upstream commits for cherry-pick: first clean, second conflicts.
  validate-fail   Merge cleanly, then build fails in validate.sh.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --case)
      if [ $# -lt 2 ]; then
        echo "Missing value for --case" >&2
        usage
        exit 1
      fi
      CASE="$2"
      shift 2
      ;;
    --quiet)
      QUIET=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

case "$CASE" in
  merge-conflict|clean-merge|no-upstream|bad-upstream|no-main-master|cherry-conflict|validate-fail)
    ;;
  *)
    echo "Unknown case: $CASE" >&2
    usage
    exit 1
    ;;
esac

log() {
  if [ "$QUIET" -eq 0 ]; then
    echo "$*"
  fi
}

run() {
  "$@" >/dev/null 2>&1
}

# Portable sed in-place: macOS uses -i '', GNU uses -i
sedi() {
  if sed --version >/dev/null 2>&1; then
    sed -i "$@"
  else
    sed -i '' "$@"
  fi
}

commit_all() {
  local msg="$1"
  run git add -A
  run git commit -m "$msg"
}

write_initial_files() {
  mkdir -p src .claude/skills/setup container

  cat > src/index.ts << 'EOT'
// NanoClaw orchestrator
const VERSION = "1.0.0";

function startOrchestrator() {
  console.log("Starting NanoClaw...");
  connectWhatsApp();
  startMessageLoop();
}

function connectWhatsApp() {
  console.log("Connecting to WhatsApp...");
}

function startMessageLoop() {
  console.log("Message loop running");
}

startOrchestrator();
EOT

  cat > src/config.ts << 'EOT'
export const TRIGGER = /^@claw/i;
export const MAX_RETRIES = 3;
export const TIMEOUT_MS = 30000;
EOT

  cat > package.json << 'EOT'
{ "name": "nanoclaw", "version": "1.0.0", "scripts": { "build": "echo build ok", "test": "echo test ok" } }
EOT

  cat > .claude/skills/setup/SKILL.md << 'EOT'
---
name: setup
description: Initial setup
---
# Setup
Run npm install.
EOT
}

create_local_conflict_customizations() {
  cd "$USER_CLONE"

  # Conflicts with upstream version bump
  sedi 's/const VERSION = "1.0.0"/const VERSION = "1.0.0-custom"/' src/index.ts
  sedi 's/Starting NanoClaw.../Starting MyClaw.../' src/index.ts
  commit_all "custom: rebrand to MyClaw"

  # Conflicts with upstream config changes
  sedi 's/MAX_RETRIES = 3/MAX_RETRIES = 5/' src/config.ts
  commit_all "custom: increase retries to 5"

  mkdir -p .claude/skills/my-telegram
  cat > .claude/skills/my-telegram/SKILL.md << 'EOT'
---
name: my-telegram
description: My custom Telegram integration
---
# Telegram
Custom telegram setup.
EOT
  commit_all "custom: add telegram skill"

  mkdir -p groups/family
  echo "# Family group memory" > groups/family/CLAUDE.md
  commit_all "custom: add family group"
}

create_local_clean_customizations() {
  cd "$USER_CLONE"

  mkdir -p groups/family
  echo "# Family group memory" > groups/family/CLAUDE.md
  commit_all "custom: add family group"

  mkdir -p .claude/skills/my-telegram
  cat > .claude/skills/my-telegram/SKILL.md << 'EOT'
---
name: my-telegram
description: My custom Telegram integration
---
# Telegram
Custom telegram setup.
EOT
  commit_all "custom: add telegram skill"
}

create_local_cherry_conflict_customizations() {
  cd "$USER_CLONE"

  # Conflicts with one upstream cherry-pick commit
  sedi 's/MAX_RETRIES = 3/MAX_RETRIES = 5/' src/config.ts
  commit_all "custom: increase retries to 5"
}

create_upstream_conflict_updates() {
  cd "$UPSTREAM"

  sedi 's/const VERSION = "1.0.0"/const VERSION = "1.1.0"/' src/index.ts
  commit_all "fix: bump version to 1.1.0"

  sedi 's/MAX_RETRIES = 3/MAX_RETRIES = 4/' src/config.ts
  sedi 's/TIMEOUT_MS = 30000/TIMEOUT_MS = 60000/' src/config.ts
  commit_all "fix: increase timeout, adjust retries"

  mkdir -p .claude/skills/debug
  cat > .claude/skills/debug/SKILL.md << 'EOT'
---
name: debug
description: Debug containers
---
# Debug
Check container logs.
EOT
  commit_all "feat: add debug skill"

  cat > src/router.ts << 'EOT'
// Message router
export function routeMessage(msg: string) {
  return msg.trim();
}
EOT
  commit_all "feat: add message router"
}

create_upstream_clean_updates() {
  cd "$UPSTREAM"

  mkdir -p .claude/skills/debug
  cat > .claude/skills/debug/SKILL.md << 'EOT'
---
name: debug
description: Debug containers
---
# Debug
Check container logs.
EOT
  commit_all "feat: add debug skill"

  cat > src/router.ts << 'EOT'
// Message router
export function routeMessage(msg: string) {
  return msg.trim();
}
EOT
  commit_all "feat: add message router"
}

create_upstream_cherry_conflict_updates() {
  cd "$UPSTREAM"

  cat > src/router.ts << 'EOT'
// Message router
export function routeMessage(msg: string) {
  return msg.trim();
}
EOT
  commit_all "feat: add message router"

  # Will conflict with local MAX_RETRIES customization
  sedi 's/MAX_RETRIES = 3/MAX_RETRIES = 4/' src/config.ts
  sedi 's/TIMEOUT_MS = 30000/TIMEOUT_MS = 60000/' src/config.ts
  commit_all "fix: adjust retries and timeout"
}

create_upstream_validate_fail_updates() {
  cd "$UPSTREAM"

  cat > src/router.ts << 'EOT'
// Message router
export function routeMessage(msg: string) {
  return msg.trim();
}
EOT
  commit_all "feat: add message router"

  cat > package.json << 'EOT'
{ "name": "nanoclaw", "version": "1.0.1", "scripts": { "build": "sh -c 'echo build failed; exit 1'", "test": "echo test ok" } }
EOT
  commit_all "chore: simulate broken build"
}

UPSTREAM_BRANCH="main"
if [ "$CASE" = "no-main-master" ]; then
  UPSTREAM_BRANCH="develop"
fi

SANDBOX=$(mktemp -d)
UPSTREAM="$SANDBOX/upstream-nanoclaw"
USER_CLONE="$SANDBOX/my-nanoclaw"

log "=== Creating test sandbox in $SANDBOX ($CASE) ==="

# 1) Create fake upstream repo
mkdir -p "$UPSTREAM"
cd "$UPSTREAM"
run git init --initial-branch="$UPSTREAM_BRANCH"
run git config user.email "test@sandbox.local"
run git config user.name "Test Sandbox"
write_initial_files
commit_all "initial: NanoClaw v1.0.0"

# 2) Clone as user install
cd "$SANDBOX"
run git clone "$UPSTREAM" "$USER_CLONE"
cd "$USER_CLONE"
if [ "$CASE" != "no-upstream" ]; then
  run git remote rename origin upstream
fi
run git config user.email "test@sandbox.local"
run git config user.name "Test Sandbox"

# 3) Scenario-specific divergence
case "$CASE" in
  merge-conflict)
    create_local_conflict_customizations
    USER_HEAD=$(git rev-parse --short HEAD)
    create_upstream_conflict_updates
    cd "$USER_CLONE"
    run git fetch upstream
    ;;

  clean-merge)
    create_local_clean_customizations
    USER_HEAD=$(git rev-parse --short HEAD)
    create_upstream_clean_updates
    cd "$USER_CLONE"
    run git fetch upstream
    ;;

  no-upstream)
    create_local_clean_customizations
    USER_HEAD=$(git rev-parse --short HEAD)
    create_upstream_clean_updates
    ;;

  bad-upstream)
    USER_HEAD=$(git rev-parse --short HEAD)
    run git remote set-url upstream "$SANDBOX/does-not-exist.git"
    ;;

  no-main-master)
    create_local_clean_customizations
    USER_HEAD=$(git rev-parse --short HEAD)
    create_upstream_clean_updates
    cd "$USER_CLONE"
    run git fetch upstream
    ;;

  cherry-conflict)
    create_local_cherry_conflict_customizations
    USER_HEAD=$(git rev-parse --short HEAD)
    create_upstream_cherry_conflict_updates
    cd "$USER_CLONE"
    run git fetch upstream
    ;;

  validate-fail)
    create_local_clean_customizations
    USER_HEAD=$(git rev-parse --short HEAD)
    create_upstream_validate_fail_updates
    cd "$USER_CLONE"
    run git fetch upstream
    ;;
esac

# Machine-readable output for automation

echo "CASE=$CASE"
echo "SANDBOX=$SANDBOX"
echo "UPSTREAM=$UPSTREAM"
echo "USER_CLONE=$USER_CLONE"
echo "UPSTREAM_BRANCH=$UPSTREAM_BRANCH"
echo "USER_HEAD=$USER_HEAD"

if [ "$CASE" = "cherry-conflict" ]; then
  CHERRY_CLEAN_HASH=$(git log --format='%H %s' "upstream/$UPSTREAM_BRANCH" | awk '/feat: add message router/{print $1; exit}')
  CHERRY_CONFLICT_HASH=$(git log --format='%H %s' "upstream/$UPSTREAM_BRANCH" | awk '/fix: adjust retries and timeout/{print $1; exit}')
  echo "CHERRY_CLEAN_HASH=$CHERRY_CLEAN_HASH"
  echo "CHERRY_CONFLICT_HASH=$CHERRY_CONFLICT_HASH"
fi

if [ "$QUIET" -eq 1 ]; then
  exit 0
fi

echo ""
echo "=== Sandbox ready ==="
echo ""
echo "  User clone:  $USER_CLONE"
echo "  Upstream:    $UPSTREAM"
echo "  Case:        $CASE"
echo ""

if git -C "$USER_CLONE" remote | grep -q '^upstream$'; then
  BASE=$(git -C "$USER_CLONE" merge-base HEAD "upstream/$UPSTREAM_BRANCH" 2>/dev/null || true)
  if [ -n "$BASE" ]; then
    UPSTREAM_COMMITS=$(git -C "$USER_CLONE" log --oneline "$BASE..upstream/$UPSTREAM_BRANCH" | wc -l | tr -d ' ')
    LOCAL_COMMITS=$(git -C "$USER_CLONE" log --oneline "$BASE..HEAD" | wc -l | tr -d ' ')
    echo "  Local commits (custom):    $LOCAL_COMMITS"
    echo "  Upstream commits (new):    $UPSTREAM_COMMITS"
    echo ""
  fi
fi

echo "Open the sandbox in Claude Code:"
echo "  cd $USER_CLONE && claude"
echo ""
echo "Run /update-nanoclaw or execute scripts manually."
echo ""
echo "To clean up:"
echo "  rm -rf $SANDBOX"
