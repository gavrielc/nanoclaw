#!/usr/bin/env bash
# backup.sh - Create timestamped backup branch and tag
#
# Usage: backup.sh
# Exit codes: 0 success, 1 hard failure
# Output: KEY=VALUE lines, then --- separator, then human summary

set -euo pipefail

HASH=$(git rev-parse --short HEAD)
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
TAG_NAME="pre-update-${HASH}-${TIMESTAMP}"
BRANCH_NAME="backup/${TAG_NAME}"

git branch "$BRANCH_NAME" 2>/dev/null || {
  echo "STATUS=error"
  echo "ERROR=failed to create backup branch $BRANCH_NAME"
  echo "---"
  echo "Could not create backup branch. A branch with this name may already exist."
  exit 1
}

git tag "$TAG_NAME" 2>/dev/null || {
  # Clean up the branch if tag fails
  git branch -D "$BRANCH_NAME" 2>/dev/null
  echo "STATUS=error"
  echo "ERROR=failed to create backup tag $TAG_NAME"
  echo "---"
  echo "Could not create backup tag."
  exit 1
}

echo "STATUS=ok"
echo "BACKUP_TAG=$TAG_NAME"
echo "BACKUP_BRANCH=$BRANCH_NAME"
echo "BACKUP_HASH=$HASH"
echo "---"
echo "Backup created."
echo "Tag: $TAG_NAME"
echo "Branch: $BRANCH_NAME"
echo "To rollback: git reset --hard $TAG_NAME"
