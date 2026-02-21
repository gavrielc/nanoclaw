#!/usr/bin/env bash
# preview.sh - Show upstream changes since last sync, bucketed by category
#
# Usage: preview.sh <upstream-branch>
# Exit codes: 0 success, 1 hard failure
# Output: KEY=VALUE lines, then --- separator, then human summary

set -euo pipefail

UPSTREAM_BRANCH="${1:?Usage: preview.sh <upstream-branch>}"
MAX_COMMITS=30
MAX_FILES_PER_BUCKET=50

BASE=$(git merge-base HEAD "upstream/$UPSTREAM_BRANCH" 2>/dev/null) || {
  echo "STATUS=error"
  echo "ERROR=no common ancestor with upstream/$UPSTREAM_BRANCH"
  echo "---"
  echo "Cannot find a common ancestor between your branch and upstream/$UPSTREAM_BRANCH."
  echo "Your branch may have diverged completely."
  exit 1
}

UPSTREAM_COUNT=$(git rev-list --count "$BASE..upstream/$UPSTREAM_BRANCH")
LOCAL_COUNT=$(git rev-list --count "$BASE..HEAD")

if [ "$UPSTREAM_COUNT" -eq 0 ]; then
  echo "STATUS=ok"
  echo "HAS_UPDATES=0"
  echo "BASE=$BASE"
  echo "UPSTREAM_COUNT=0"
  echo "LOCAL_COUNT=$LOCAL_COUNT"
  echo "---"
  echo "Already up to date. No new upstream commits since last sync."
  exit 0
fi

# Get changed files from upstream
ALL_FILES=$(git diff --name-only "$BASE..upstream/$UPSTREAM_BRANCH")

# Bucket files
SKILLS_FILES=$(echo "$ALL_FILES" | grep '^\.claude/skills/' || true)
SOURCE_FILES=$(echo "$ALL_FILES" | grep '^src/' || true)
CONFIG_FILES=$(echo "$ALL_FILES" | grep -E '^(package\.json|package-lock\.json|tsconfig.*\.json|container/|launchd/)' || true)
OTHER_FILES=$(echo "$ALL_FILES" | grep -v -E '^(\.claude/skills/|src/|package\.json|package-lock\.json|tsconfig.*\.json|container/|launchd/)' || true)

SKILLS_COUNT=$(echo "$SKILLS_FILES" | grep -c '.' || true)
SOURCE_COUNT=$(echo "$SOURCE_FILES" | grep -c '.' || true)
CONFIG_COUNT=$(echo "$CONFIG_FILES" | grep -c '.' || true)
OTHER_COUNT=$(echo "$OTHER_FILES" | grep -c '.' || true)

echo "STATUS=ok"
echo "HAS_UPDATES=1"
echo "BASE=$BASE"
echo "UPSTREAM_COUNT=$UPSTREAM_COUNT"
echo "LOCAL_COUNT=$LOCAL_COUNT"
echo "SKILLS_COUNT=$SKILLS_COUNT"
echo "SOURCE_COUNT=$SOURCE_COUNT"
echo "CONFIG_COUNT=$CONFIG_COUNT"
echo "OTHER_COUNT=$OTHER_COUNT"
echo "---"

echo "$UPSTREAM_COUNT upstream commits since last sync"
echo "$LOCAL_COUNT local commits (your customizations)"
echo ""

echo "== Upstream commits =="
if [ "$UPSTREAM_COUNT" -le "$MAX_COMMITS" ]; then
  git log --oneline "$BASE..upstream/$UPSTREAM_BRANCH"
else
  git log --oneline "$BASE..upstream/$UPSTREAM_BRANCH" | head -"$MAX_COMMITS" || true
  REMAINING=$((UPSTREAM_COUNT - MAX_COMMITS))
  echo "... and $REMAINING more"
fi

echo ""
echo "== Files changed upstream (by category) =="

if [ "$SKILLS_COUNT" -gt 0 ]; then
  echo ""
  echo "Skills ($SKILLS_COUNT files) - unlikely to conflict:"
  echo "$SKILLS_FILES" | head -"$MAX_FILES_PER_BUCKET"
  [ "$SKILLS_COUNT" -gt "$MAX_FILES_PER_BUCKET" ] && echo "... and $((SKILLS_COUNT - MAX_FILES_PER_BUCKET)) more" || true
fi

if [ "$SOURCE_COUNT" -gt 0 ]; then
  echo ""
  echo "Source ($SOURCE_COUNT files) - may conflict if you modified these:"
  echo "$SOURCE_FILES" | head -"$MAX_FILES_PER_BUCKET"
  [ "$SOURCE_COUNT" -gt "$MAX_FILES_PER_BUCKET" ] && echo "... and $((SOURCE_COUNT - MAX_FILES_PER_BUCKET)) more" || true
fi

if [ "$CONFIG_COUNT" -gt 0 ]; then
  echo ""
  echo "Build/config ($CONFIG_COUNT files) - review needed:"
  echo "$CONFIG_FILES" | head -"$MAX_FILES_PER_BUCKET"
  [ "$CONFIG_COUNT" -gt "$MAX_FILES_PER_BUCKET" ] && echo "... and $((CONFIG_COUNT - MAX_FILES_PER_BUCKET)) more" || true
fi

if [ "$OTHER_COUNT" -gt 0 ]; then
  echo ""
  echo "Other ($OTHER_COUNT files):"
  echo "$OTHER_FILES" | head -"$MAX_FILES_PER_BUCKET"
  [ "$OTHER_COUNT" -gt "$MAX_FILES_PER_BUCKET" ] && echo "... and $((OTHER_COUNT - MAX_FILES_PER_BUCKET)) more" || true
fi
