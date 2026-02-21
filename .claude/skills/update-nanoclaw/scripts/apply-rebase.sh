#!/usr/bin/env bash
# apply-rebase.sh - Rebase current branch onto upstream
#
# Usage: apply-rebase.sh <upstream-branch>
# Exit codes: 0 success, 1 hard failure, 3 conflicts to resolve
# Output: KEY=VALUE lines, then --- separator, then human summary

set -uo pipefail

UPSTREAM_BRANCH="${1:?Usage: apply-rebase.sh <upstream-branch>}"

git rebase "upstream/$UPSTREAM_BRANCH" >/dev/null 2>&1
REBASE_EXIT=$?

if [ "$REBASE_EXIT" -eq 0 ]; then
  echo "STATUS=ok"
  echo "CONFLICT_COUNT=0"
  echo "---"
  echo "Rebase completed cleanly. No conflicts."
  exit 0
fi

# Rebase paused on conflicts
CONFLICTS=$(git diff --name-only --diff-filter=U 2>/dev/null || true)
CONFLICT_COUNT=0
if [ -n "$CONFLICTS" ]; then
  CONFLICT_COUNT=$(echo "$CONFLICTS" | wc -l | tr -d ' ')
fi

if [ "$CONFLICT_COUNT" -gt 0 ]; then
  echo "STATUS=conflicts"
  echo "CONFLICT_COUNT=$CONFLICT_COUNT"
  echo "CONFLICTED_FILES=$CONFLICTS"
  echo "---"
  echo "Rebase paused. $CONFLICT_COUNT file(s) have conflicts:"
  echo "$CONFLICTS"
  echo ""
  echo "Resolve conflicts, then: git add <files> && git rebase --continue"
  echo "To abort: git rebase --abort"
  exit 3
fi

echo "STATUS=error"
echo "ERROR=rebase failed with exit code $REBASE_EXIT"
echo "---"
echo "Rebase failed unexpectedly. Run 'git status' to investigate."
echo "To abort: git rebase --abort"
exit 1
