#!/bin/bash
# Test NanoClaw agent container on VPS/Linux
# Usage: ./test-container-vps.sh

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

echo "=== Testing NanoClaw Agent Container ==="
echo "Project root: $PROJECT_ROOT"
echo ""

# Check if agent image exists
if ! docker image inspect nanoclaw-agent:latest > /dev/null 2>&1; then
    echo "❌ Error: nanoclaw-agent:latest image not found"
    echo "   Run: cd container && ./build.sh"
    exit 1
fi

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found"
    echo "   Run: cp .env.vps.example .env (or .env.example for local dev)"
    exit 1
fi

echo "✅ Prerequisites OK"
echo ""

# Read auth token from .env
TOKEN=""
API_KEY=""

if grep -q "^CLAUDE_CODE_OAUTH_TOKEN=" .env 2>/dev/null; then
    TOKEN=$(grep "^CLAUDE_CODE_OAUTH_TOKEN=" .env | cut -d= -f2)
fi

if grep -q "^ANTHROPIC_API_KEY=" .env 2>/dev/null; then
    API_KEY=$(grep "^ANTHROPIC_API_KEY=" .env | cut -d= -f2)
fi

if [ -z "$TOKEN" ] && [ -z "$API_KEY" ]; then
    echo "❌ Error: No authentication found in .env"
    echo "   Add CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY to .env"
    exit 1
fi

echo "Running test: 'What is 2+2?'"
echo "---"

# Build docker run command with environment variables
DOCKER_CMD="docker run -i --rm"

if [ -n "$TOKEN" ]; then
    DOCKER_CMD="$DOCKER_CMD -e CLAUDE_CODE_OAUTH_TOKEN=$TOKEN"
    echo "✅ Using CLAUDE_CODE_OAUTH_TOKEN (${#TOKEN} chars)"
fi

if [ -n "$API_KEY" ]; then
    DOCKER_CMD="$DOCKER_CMD -e ANTHROPIC_API_KEY=$API_KEY"
    echo "✅ Using ANTHROPIC_API_KEY (${#API_KEY} chars)"
fi

DOCKER_CMD="$DOCKER_CMD \
  -v $PROJECT_ROOT/skills:/workspace/shared-skills:ro \
  -v $PROJECT_ROOT/groups:/workspace/groups:rw \
  nanoclaw-agent:latest"

echo ""
echo '{"prompt":"Test: what is 2+2?","groupFolder":"test-group","chatId":"test@example.com","isMain":true}' | \
  eval $DOCKER_CMD

echo ""
echo "=== Test Complete ==="
