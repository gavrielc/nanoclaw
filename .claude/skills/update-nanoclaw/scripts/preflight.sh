#!/usr/bin/env bash
# preflight.sh - Check working tree, upstream remote, branch detection, fetch
#
# Usage: preflight.sh [--url <upstream-url>]
# Exit codes: 0 success, 1 hard failure, 2 user action needed
# Output: KEY=VALUE lines, then --- separator, then human summary

set -euo pipefail

URL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --url)
      if [ $# -lt 2 ]; then
        echo "STATUS=error"
        echo "ERROR=missing value for --url"
        echo "---"
        echo "Usage: preflight.sh --url <upstream-url>"
        exit 1
      fi
      URL="$2"
      shift 2
      ;;
    *) echo "STATUS=error"; echo "ERROR=unknown argument: $1"; exit 1 ;;
  esac
done

# Check clean working tree
DIRTY=$(git status --porcelain 2>/dev/null) || {
  echo "STATUS=error"
  echo "ERROR=not a git repository"
  echo "---"
  echo "This directory is not a git repository."
  exit 1
}

if [ -n "$DIRTY" ]; then
  echo "STATUS=dirty"
  echo "---"
  echo "Working tree is not clean. Commit or stash your changes first."
  echo ""
  echo "Uncommitted changes:"
  git status --short
  exit 2
fi

# Check upstream remote
HAS_UPSTREAM=$(git remote | grep -c '^upstream$' || true)

if [ "$HAS_UPSTREAM" -eq 0 ]; then
  if [ -z "$URL" ]; then
    echo "STATUS=no_upstream"
    echo "---"
    echo "No 'upstream' remote found."
    echo "Provide the upstream repo URL (default: https://github.com/qwibitai/nanoclaw.git)."
    exit 2
  fi
  git remote add upstream "$URL" 2>/dev/null || {
    echo "STATUS=error"
    echo "ERROR=failed to add upstream remote: $URL"
    echo "---"
    echo "Could not add upstream remote. Check the URL and try again."
    exit 1
  }
fi

# Fetch upstream
git fetch upstream --prune 2>/dev/null || {
  echo "STATUS=error"
  echo "ERROR=fetch failed"
  echo "---"
  echo "Failed to fetch from upstream. Check your network connection and remote URL."
  echo "Current upstream URL: $(git remote get-url upstream 2>/dev/null || echo 'unknown')"
  exit 1
}

# Detect upstream branch
UPSTREAM_BRANCH=""
if git rev-parse --verify upstream/main >/dev/null 2>&1; then
  UPSTREAM_BRANCH="main"
elif git rev-parse --verify upstream/master >/dev/null 2>&1; then
  UPSTREAM_BRANCH="master"
fi

if [ -z "$UPSTREAM_BRANCH" ]; then
  BRANCHES=$(git branch -r | grep 'upstream/' | sed 's/.*upstream\///' | head -10)
  BRANCHES_CSV=$(echo "$BRANCHES" | tr '\n' ',' | sed 's/,$//')
  echo "STATUS=no_branch"
  echo "AVAILABLE_BRANCHES=$BRANCHES_CSV"
  echo "---"
  echo "Could not find upstream/main or upstream/master."
  echo "Available upstream branches:"
  echo "$BRANCHES"
  exit 2
fi

CURRENT_BRANCH=$(git branch --show-current)

echo "STATUS=ok"
echo "UPSTREAM_BRANCH=$UPSTREAM_BRANCH"
echo "CURRENT_BRANCH=$CURRENT_BRANCH"
echo "UPSTREAM_URL=$(git remote get-url upstream)"
echo "---"
echo "Preflight passed."
echo "Upstream branch: upstream/$UPSTREAM_BRANCH"
echo "Current branch: $CURRENT_BRANCH"
