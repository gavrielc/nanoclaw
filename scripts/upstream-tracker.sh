#!/usr/bin/env bash
# Upstream Tracker - Monitor qwibitai/nanoclaw and cosmin/microclaw for interesting features
# Usage: ./scripts/upstream-tracker.sh

set -euo pipefail

NANOCLAW_REPO="qwibitai/nanoclaw"
MICROCLAW_REPO="cosmin/microclaw"
FORK_REPO="omniaura/nanoclaw"

echo "🔍 Fetching upstream changes..."
git fetch upstream --quiet || echo "⚠️  Failed to fetch from upstream"
git fetch microclaw --quiet || echo "⚠️  Failed to fetch from microclaw"

echo ""
echo "📋 Recent Upstream PRs (qwibitai/nanoclaw):"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

gh api "repos/${NANOCLAW_REPO}/pulls" --jq '.[] | select(.state=="open") | "#\(.number) - \(.title)\n  Created: \(.created_at) | Comments: \(.comments)"' | head -30

echo ""
echo "📋 Recent MicroClaw Issues (cosmin/microclaw):"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

gh api "repos/${MICROCLAW_REPO}/issues" --jq '.[] | select(.state=="open" and (.title | contains("Upstream"))) | "#\(.number) - \(.title)\n  Created: \(.created_at) | Comments: \(.comments)"' | head -20

echo ""
echo "✅ Upstream tracking complete!"
echo ""
echo "💡 To create a tracking issue on ${FORK_REPO}:"
echo "   gh issue create --title \"[Upstream PR #X] Feature name\" --body \"Link: https://github.com/${NANOCLAW_REPO}/pull/X\""
