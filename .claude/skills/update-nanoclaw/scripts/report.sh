#!/usr/bin/env bash
# report.sh - Print update summary with rollback instructions
#
# Usage: report.sh <upstream-branch> <backup-tag>
# Exit codes: 0 always
# Output: KEY=VALUE lines, then --- separator, then human summary

set -uo pipefail

UPSTREAM_BRANCH="${1:?Usage: report.sh <upstream-branch> <backup-tag>}"
BACKUP_TAG="${2:?Usage: report.sh <upstream-branch> <backup-tag>}"

NEW_HEAD=$(git rev-parse --short HEAD)
UPSTREAM_HEAD=$(git rev-parse --short "upstream/$UPSTREAM_BRANCH" 2>/dev/null || echo "unknown")
LOCAL_DIFF=$(git diff --name-only "upstream/$UPSTREAM_BRANCH..HEAD" 2>/dev/null || true)
DIFF_COUNT=0
if [ -n "$LOCAL_DIFF" ]; then
  DIFF_COUNT=$(echo "$LOCAL_DIFF" | wc -l | tr -d ' ')
fi

echo "STATUS=ok"
echo "BACKUP_TAG=$BACKUP_TAG"
echo "NEW_HEAD=$NEW_HEAD"
echo "UPSTREAM_HEAD=$UPSTREAM_HEAD"
echo "LOCAL_DIFF_COUNT=$DIFF_COUNT"
echo "---"
echo "== Update complete =="
echo ""
echo "Backup tag:    $BACKUP_TAG"
echo "New HEAD:      $NEW_HEAD"
echo "Upstream HEAD: $UPSTREAM_HEAD"
echo ""
echo "$DIFF_COUNT file(s) differ from upstream (your local customizations):"
if [ -n "$LOCAL_DIFF" ]; then
  echo "$LOCAL_DIFF"
fi
echo ""
echo "== Rollback =="
echo "git reset --hard $BACKUP_TAG"
echo ""
echo "== Restart =="
echo "If using launchd:"
echo "  launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist && launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist"
echo "If running manually:"
echo "  npm run dev"
