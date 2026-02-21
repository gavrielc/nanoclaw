#!/usr/bin/env bash
# apply-merge.sh - Run git merge against upstream
#
# Usage: apply-merge.sh <upstream-branch>
# Exit codes: 0 clean merge, 1 hard failure, 3 conflicts to resolve
# Output: KEY=VALUE lines, then --- separator, then human summary

set -uo pipefail

UPSTREAM_BRANCH="${1:?Usage: apply-merge.sh <upstream-branch>}"

git merge "upstream/$UPSTREAM_BRANCH" --no-edit >/dev/null 2>&1
MERGE_EXIT=$?

if [ "$MERGE_EXIT" -eq 0 ]; then
  echo "STATUS=ok"
  echo "CONFLICT_COUNT=0"
  echo "---"
  echo "Merge completed cleanly. No conflicts."
  exit 0
fi

# Merge had conflicts
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
  echo "Merge paused. $CONFLICT_COUNT file(s) have conflicts:"
  echo "$CONFLICTS"
  echo ""
  echo "Resolve the conflicts, then run: git add <files> && git commit --no-edit"
  exit 3
fi

# Merge failed for another reason
echo "STATUS=error"
echo "ERROR=merge failed with exit code $MERGE_EXIT"
echo "---"
echo "Merge failed unexpectedly. Run 'git status' to investigate."
exit 1
