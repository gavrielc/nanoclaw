#!/usr/bin/env bash
# dryrun-merge.sh - Preview merge conflicts without changing anything
#
# Usage: dryrun-merge.sh <upstream-branch>
# Exit codes: 0 clean merge, 1 hard failure, 3 conflicts found
# Output: KEY=VALUE lines, then --- separator, then human summary

set -uo pipefail

UPSTREAM_BRANCH="${1:?Usage: dryrun-merge.sh <upstream-branch>}"

# Check no merge/rebase/cherry-pick in progress
if [ -f "$(git rev-parse --git-dir)/MERGE_HEAD" ] 2>/dev/null || \
   [ -d "$(git rev-parse --git-dir)/rebase-merge" ] 2>/dev/null || \
   [ -d "$(git rev-parse --git-dir)/rebase-apply" ] 2>/dev/null || \
   [ -f "$(git rev-parse --git-dir)/CHERRY_PICK_HEAD" ] 2>/dev/null || \
   [ -f "$(git rev-parse --git-dir)/REVERT_HEAD" ] 2>/dev/null; then
  echo "STATUS=error"
  echo "ERROR=operation in progress"
  echo "---"
  echo "A merge, rebase, or cherry-pick is already in progress."
  echo "Resolve or abort it first before running a dry-run."
  exit 1
fi

# Attempt dry-run merge
git merge --no-commit --no-ff "upstream/$UPSTREAM_BRANCH" >/dev/null 2>&1
MERGE_EXIT=$?

# Collect conflicted files (if any)
CONFLICTS=$(git diff --name-only --diff-filter=U 2>/dev/null || true)
CONFLICT_COUNT=0
if [ -n "$CONFLICTS" ]; then
  CONFLICT_COUNT=$(echo "$CONFLICTS" | wc -l | tr -d ' ')
fi

# Always abort the dry-run
git merge --abort 2>/dev/null || true

if [ "$CONFLICT_COUNT" -gt 0 ]; then
  echo "STATUS=conflicts"
  echo "CONFLICT_COUNT=$CONFLICT_COUNT"
  echo "CONFLICTED_FILES=$CONFLICTS"
  echo "---"
  echo "$CONFLICT_COUNT file(s) will have conflicts:"
  echo "$CONFLICTS"
  exit 3
fi

if [ "$MERGE_EXIT" -ne 0 ]; then
  echo "STATUS=error"
  echo "ERROR=dry-run merge failed for upstream/$UPSTREAM_BRANCH"
  echo "---"
  echo "Dry-run merge failed unexpectedly."
  echo "Verify that upstream/$UPSTREAM_BRANCH exists and run preflight again."
  exit 1
fi

echo "STATUS=clean"
echo "CONFLICT_COUNT=0"
echo "---"
echo "Merge will be clean. No conflicts expected."
exit 0
