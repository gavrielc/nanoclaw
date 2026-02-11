#!/bin/bash
set -e

echo "ha-mcp Sidecar Setup & Health Check"
echo "===================================="
echo ""

NANOCLAW_HOME="${NANOCLAW_HOME:-$HOME/.nanoclaw}"
ENV_FILE="$NANOCLAW_HOME/env"
HA_MCP_PORT=8086
ERRORS=0

# 1. Check if ha-mcp is installed
echo "Step 1: ha-mcp Installation"
echo "---------------------------"
HA_MCP_PATH=$(command -v ha-mcp-web 2>/dev/null || true)
if [ -z "$HA_MCP_PATH" ]; then
    echo "FAIL: ha-mcp-web not found on PATH"
    echo "  Install with: pip install ha-mcp"
    echo "  Or:           pipx install ha-mcp"
    ERRORS=$((ERRORS + 1))
else
    echo "OK: ha-mcp-web found at $HA_MCP_PATH"
fi
echo ""

# 2. Check HA_URL and HA_TOKEN in env file
echo "Step 2: Environment Variables"
echo "-----------------------------"
if [ ! -f "$ENV_FILE" ]; then
    echo "FAIL: $ENV_FILE not found"
    echo "  Create it with HA_URL and HA_TOKEN entries"
    ERRORS=$((ERRORS + 1))
else
    HA_URL=$(grep "^HA_URL=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)
    HA_TOKEN=$(grep "^HA_TOKEN=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)

    if [ -z "$HA_URL" ]; then
        echo "FAIL: HA_URL not set in $ENV_FILE"
        echo "  Add: HA_URL=http://homeassistant.local:8123"
        ERRORS=$((ERRORS + 1))
    else
        echo "OK: HA_URL=$HA_URL"
    fi

    if [ -z "$HA_TOKEN" ]; then
        echo "FAIL: HA_TOKEN not set in $ENV_FILE"
        echo "  Add: HA_TOKEN=<your-long-lived-access-token>"
        echo "  Generate at: HA > Profile > Long-Lived Access Tokens"
        ERRORS=$((ERRORS + 1))
    else
        echo "OK: HA_TOKEN is set (${#HA_TOKEN} chars)"
    fi
fi
echo ""

# 3. Test connectivity to Home Assistant
echo "Step 3: Home Assistant Connectivity"
echo "------------------------------------"
if [ -n "$HA_URL" ] && [ -n "$HA_TOKEN" ]; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Authorization: Bearer $HA_TOKEN" \
        "$HA_URL/api/" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
        echo "OK: Home Assistant reachable at $HA_URL (HTTP $HTTP_CODE)"
    elif [ "$HTTP_CODE" = "000" ]; then
        echo "FAIL: Cannot connect to Home Assistant at $HA_URL"
        echo "  Check that HA is running and the URL is correct"
        ERRORS=$((ERRORS + 1))
    else
        echo "FAIL: Home Assistant returned HTTP $HTTP_CODE"
        echo "  Check that HA_TOKEN is a valid long-lived access token"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo "SKIP: HA_URL or HA_TOKEN not set"
fi
echo ""

# 4. Test connectivity to ha-mcp
echo "Step 4: ha-mcp Sidecar Connectivity"
echo "------------------------------------"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    "http://localhost:$HA_MCP_PORT/mcp" \
    -X POST -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"health-check","version":"0.1.0"}}}' \
    2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
    echo "OK: ha-mcp responding on port $HA_MCP_PORT"
elif [ "$HTTP_CODE" = "000" ]; then
    echo "FAIL: ha-mcp not responding on port $HA_MCP_PORT"
    echo "  Start with: launchctl load ~/Library/LaunchAgents/com.nanoclaw.ha-mcp.plist"
    echo "  Or manually: ha-mcp-web --port $HA_MCP_PORT"
    ERRORS=$((ERRORS + 1))
else
    echo "WARN: ha-mcp returned HTTP $HTTP_CODE (may still be starting)"
fi
echo ""

# 5. Check log directory
echo "Step 5: Log Directory"
echo "---------------------"
LOG_DIR="$NANOCLAW_HOME/logs"
if [ -d "$LOG_DIR" ]; then
    echo "OK: $LOG_DIR exists"
else
    mkdir -p "$LOG_DIR"
    echo "OK: Created $LOG_DIR"
fi
echo ""

# Summary
echo "Summary"
echo "======="
if [ $ERRORS -eq 0 ]; then
    echo "All checks passed."
else
    echo "$ERRORS check(s) failed. Fix the issues above and re-run."
    exit 1
fi
