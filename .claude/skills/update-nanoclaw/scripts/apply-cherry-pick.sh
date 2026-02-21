#!/usr/bin/env bash
# apply-cherry-pick.sh - Cherry-pick specific commits from upstream
#
# Usage: apply-cherry-pick.sh <upstream-branch> <hash1> [hash2] [hash3] ...
# Exit codes: 0 success, 1 hard failure, 3 conflicts to resolve
# Output: KEY=VALUE lines, then --- separator, then human summary

set -uo pipefail

UPSTREAM_BRANCH="${1:?Usage: apply-cherry-pick.sh <upstream-branch> <hash1> [hash2] ...}"
shift

if [ $# -eq 0 ]; then
  echo "STATUS=error"
  echo "ERROR=no commit hashes provided"
  echo "---"
  echo "Provide at least one commit hash to cherry-pick."
  exit 1
fi

# Validate all hashes before starting
INVALID=""
ALREADY_APPLIED=""
VALID_HASHES=""

for HASH in "$@"; do
  # Check hash exists in upstream
  if ! git cat-file -t "$HASH" >/dev/null 2>&1; then
    INVALID="${INVALID:+$INVALID }$HASH"
    continue
  fi

  # Check hash is reachable from upstream branch
  if ! git merge-base --is-ancestor "$HASH" "upstream/$UPSTREAM_BRANCH" 2>/dev/null; then
    INVALID="${INVALID:+$INVALID }$HASH"
    continue
  fi

  # Check if already applied
  if git merge-base --is-ancestor "$HASH" HEAD 2>/dev/null; then
    ALREADY_APPLIED="${ALREADY_APPLIED:+$ALREADY_APPLIED }$HASH"
    continue
  fi

  VALID_HASHES="${VALID_HASHES:+$VALID_HASHES }$HASH"
done

if [ -n "$INVALID" ]; then
  echo "STATUS=error"
  echo "ERROR=invalid hashes: $INVALID"
  echo "---"
  echo "The following commit hashes were not found in upstream/$UPSTREAM_BRANCH: $INVALID"
  exit 1
fi

if [ -z "$VALID_HASHES" ]; then
  echo "STATUS=ok"
  echo "CONFLICT_COUNT=0"
  echo "SKIPPED=$ALREADY_APPLIED"
  echo "---"
  echo "All requested commits are already applied. Nothing to do."
  [ -n "$ALREADY_APPLIED" ] && echo "Already applied: $ALREADY_APPLIED"
  exit 0
fi

# Apply cherry-picks
APPLIED=0
for HASH in $VALID_HASHES; do
  git cherry-pick "$HASH" >/dev/null 2>&1
  CP_EXIT=$?

  if [ "$CP_EXIT" -ne 0 ]; then
    CONFLICTS=$(git diff --name-only --diff-filter=U 2>/dev/null || true)
    CONFLICT_COUNT=0
    if [ -n "$CONFLICTS" ]; then
      CONFLICT_COUNT=$(echo "$CONFLICTS" | wc -l | tr -d ' ')
    fi

    echo "STATUS=conflicts"
    echo "CONFLICT_COUNT=$CONFLICT_COUNT"
    echo "CONFLICTED_FILES=$CONFLICTS"
    echo "APPLIED=$APPLIED"
    echo "FAILED_AT=$HASH"
    [ -n "$ALREADY_APPLIED" ] && echo "SKIPPED=$ALREADY_APPLIED"
    echo "---"
    echo "Cherry-pick paused at $HASH. $CONFLICT_COUNT file(s) have conflicts:"
    echo "$CONFLICTS"
    echo ""
    echo "Resolve conflicts, then: git add <files> && git cherry-pick --continue"
    echo "To abort: git cherry-pick --abort"
    exit 3
  fi

  APPLIED=$((APPLIED + 1))
done

echo "STATUS=ok"
echo "CONFLICT_COUNT=0"
echo "APPLIED=$APPLIED"
[ -n "$ALREADY_APPLIED" ] && echo "SKIPPED=$ALREADY_APPLIED"
echo "---"
echo "Cherry-picked $APPLIED commit(s) cleanly."
[ -n "$ALREADY_APPLIED" ] && echo "Skipped (already applied): $ALREADY_APPLIED"
exit 0
