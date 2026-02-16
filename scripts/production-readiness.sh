#!/usr/bin/env bash
set -euo pipefail

# Production Readiness Script (VPN-only)
# - Validates network exposure, secrets, ops health, backups, runbooks presence.
# - Fail-closed: unknown/undetermined checks become FAIL.
#
# Usage:
#   export OS_HTTP_SECRET="your-secret"
#   ./scripts/production-readiness.sh
#
# Override paths:
#   DB_PATH=./store/messages.db RUNBOOK_DIR=./docs/runbooks ./scripts/production-readiness.sh

########################################
# Config (override via env)
########################################
OPS_HOST="${OPS_HOST:-127.0.0.1}"
OPS_PORT="${OPS_PORT:-7700}"

# REQUIRED: OS_HTTP_SECRET must be set in env when running this script.
OS_HTTP_SECRET="${OS_HTTP_SECRET:-}"

# Worker port (default from src/config.ts)
WORKER_PORT="${WORKER_PORT:-7801}"

# Files / dirs
DB_PATH="${DB_PATH:-./store/messages.db}"
STORE_DIR="${STORE_DIR:-./store}"
BACKUPS_DIR="${BACKUPS_DIR:-./backups}"

# Runbooks (minimum required set — filenames use hyphens)
RUNBOOK_DIR="${RUNBOOK_DIR:-./docs/runbooks}"
RUNBOOKS_REQUIRED=(
  "worker-offline.md"
  "tunnel-flapping.md"
  "secret-rotation.md"
  "incident-leak.md"
  "billing-mismatch.md"
)

# Ports that must NOT be publicly exposed
FORBIDDEN_PORTS=("$OPS_PORT" "$WORKER_PORT")

########################################
# Helpers
########################################
RED="\033[31m"; GREEN="\033[32m"; YELLOW="\033[33m"; NC="\033[0m"
FAILS=0
WARN=0

pass(){ echo -e "  ${GREEN}PASS${NC}  $*"; }
fail(){ echo -e "  ${RED}FAIL${NC}  $*"; FAILS=$((FAILS+1)); }
warn(){ echo -e "  ${YELLOW}WARN${NC}  $*"; WARN=$((WARN+1)); }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

http_get() {
  local path="$1"
  curl -fsS \
    -H "X-OS-SECRET: ${OS_HTTP_SECRET}" \
    "http://${OPS_HOST}:${OPS_PORT}${path}" 2>/dev/null
}

########################################
# 0) Preconditions
########################################
echo "================================================"
echo "  Production Readiness Check (VPN-only)"
echo "================================================"
echo
require_cmd ss
require_cmd curl

if [[ -z "$OS_HTTP_SECRET" ]]; then
  fail "OS_HTTP_SECRET is not set. Export it before running."
fi

########################################
# 1) Port exposure (must bind to 127.0.0.1)
########################################
echo "-- Network exposure --"

OPS_LISTEN="$(ss -lntp 2>/dev/null | grep -E ":${OPS_PORT}\b" || true)"
if [[ -z "$OPS_LISTEN" ]]; then
  fail "ops-http not listening on port ${OPS_PORT}"
else
  if echo "$OPS_LISTEN" | grep -qE "0\.0\.0\.0:${OPS_PORT}\b|:::${OPS_PORT}\b"; then
    fail "ops-http bound to public interface (0.0.0.0/::). Must be 127.0.0.1."
  else
    pass "ops-http bound to loopback only (:${OPS_PORT})"
  fi
fi

WORKER_LISTEN="$(ss -lntp 2>/dev/null | grep -E ":${WORKER_PORT}\b" || true)"
if [[ -n "$WORKER_LISTEN" ]]; then
  if echo "$WORKER_LISTEN" | grep -qE "0\.0\.0\.0:${WORKER_PORT}\b|:::${WORKER_PORT}\b"; then
    fail "worker-service bound to public interface (:${WORKER_PORT}). Must be 127.0.0.1."
  else
    pass "worker-service bound to loopback only (:${WORKER_PORT})"
  fi
else
  warn "worker-service not listening on :${WORKER_PORT} (OK if single-node)"
fi

########################################
# 2) Firewall (UFW if present)
########################################
echo
echo "-- Firewall --"

if command -v ufw >/dev/null 2>&1; then
  UFW_STATUS="$(ufw status 2>/dev/null || true)"
  if echo "$UFW_STATUS" | grep -qi "Status: active"; then
    pass "UFW active"
    for p in "${FORBIDDEN_PORTS[@]}"; do
      if echo "$UFW_STATUS" | grep -E "\b${p}\b" | grep -qi "ALLOW"; then
        fail "UFW allows port ${p} — should not be exposed"
      else
        pass "UFW does not allow port ${p}"
      fi
    done
  else
    warn "UFW installed but not active"
  fi
else
  warn "UFW not installed (ensure equivalent firewall exists)"
fi

########################################
# 3) VPN presence (Tailscale)
########################################
echo
echo "-- VPN --"

if command -v tailscale >/dev/null 2>&1; then
  TS_STATUS="$(tailscale status 2>/dev/null || true)"
  if echo "$TS_STATUS" | grep -qi "Logged out"; then
    warn "Tailscale installed but logged out"
  else
    pass "Tailscale present and configured"
  fi
else
  warn "Tailscale not found (OK if using another VPN)"
fi

########################################
# 4) Ops endpoints (auth + health)
########################################
echo
echo "-- Ops endpoints --"

if [[ -n "$OS_HTTP_SECRET" ]]; then
  # /ops/health
  if HEALTH="$(http_get /ops/health)"; then
    pass "/ops/health reachable (authenticated)"
    if echo "$HEALTH" | grep -q '"status"'; then
      pass "/ops/health includes status field"
    else
      warn "/ops/health response missing status field"
    fi
  else
    fail "Cannot reach /ops/health (service down or auth failure)"
  fi

  # /ops/stats
  if STATS="$(http_get /ops/stats)"; then
    pass "/ops/stats reachable"
    if echo "$STATS" | grep -q '"limits"'; then pass "/ops/stats includes limits"; else warn "/ops/stats missing limits"; fi
    if echo "$STATS" | grep -q '"workers"'; then pass "/ops/stats includes workers"; else warn "/ops/stats missing workers"; fi
  else
    warn "Cannot reach /ops/stats (not fatal)"
  fi

  # Auth rejection test: request without secret must fail
  if curl -fsS "http://${OPS_HOST}:${OPS_PORT}/ops/health" >/dev/null 2>&1; then
    fail "/ops/health accessible WITHOUT secret — auth is broken"
  else
    pass "/ops/health correctly rejects unauthenticated requests"
  fi
else
  fail "Skipping ops endpoint checks (no OS_HTTP_SECRET)"
fi

########################################
# 5) Secrets hygiene
########################################
echo
echo "-- Secrets --"

if [[ -n "$OS_HTTP_SECRET" ]]; then
  if [[ ${#OS_HTTP_SECRET} -lt 16 ]]; then
    fail "OS_HTTP_SECRET too short (${#OS_HTTP_SECRET} chars, minimum 16)"
  elif [[ ${#OS_HTTP_SECRET} -lt 24 ]]; then
    warn "OS_HTTP_SECRET is short (${#OS_HTTP_SECRET} chars, recommend 24+)"
  else
    pass "OS_HTTP_SECRET length OK (${#OS_HTTP_SECRET} chars)"
  fi
fi

# Check .env permissions if file exists
if [[ -f .env ]]; then
  ENV_PERMS="$(stat -c '%a' .env 2>/dev/null || stat -f '%Lp' .env 2>/dev/null || true)"
  if [[ "$ENV_PERMS" == "600" ]]; then
    pass ".env file permissions are 600"
  elif [[ -n "$ENV_PERMS" ]]; then
    warn ".env file permissions are ${ENV_PERMS} (recommend 600)"
  fi
fi

########################################
# 6) Backups readiness
########################################
echo
echo "-- Backups --"

if [[ -f "$DB_PATH" ]]; then
  pass "Database exists: $DB_PATH"
else
  fail "Database not found: $DB_PATH (set DB_PATH if path differs)"
fi

if [[ -d "$STORE_DIR" ]]; then
  pass "Store dir exists: $STORE_DIR"
else
  warn "Store dir not found: $STORE_DIR"
fi

if [[ -d "$BACKUPS_DIR" ]]; then
  BACKUP_COUNT="$(find "$BACKUPS_DIR" -name '*.tar.gz' -o -name '*.gz' 2>/dev/null | wc -l)"
  pass "Backups dir exists: $BACKUPS_DIR (${BACKUP_COUNT} archive(s))"
else
  warn "Backups dir missing: $BACKUPS_DIR (will be created on first backup)"
fi

# Check for backup schedule: systemd timer or cron
SYSTEMD_TIMER="$(systemctl list-timers nanoclaw-backup.timer 2>/dev/null | grep -c nanoclaw || true)"
CRON_HIT="$(crontab -l 2>/dev/null | grep -cE 'backup-os|nanoclaw.*backup' || true)"
if [[ "$SYSTEMD_TIMER" -gt 0 ]]; then
  pass "Backup systemd timer is active"
elif [[ "$CRON_HIT" -gt 0 ]]; then
  pass "Backup cron entry detected"
else
  warn "No automated backup schedule found (install docs/nanoclaw-backup.timer)"
fi

########################################
# 7) Runbooks
########################################
echo
echo "-- Runbooks --"

if [[ -d "$RUNBOOK_DIR" ]]; then
  for rb in "${RUNBOOKS_REQUIRED[@]}"; do
    if [[ -f "${RUNBOOK_DIR}/${rb}" ]]; then
      pass "Runbook: ${rb}"
    else
      fail "Missing runbook: ${rb}"
    fi
  done
else
  fail "Runbook dir missing: $RUNBOOK_DIR"
fi

########################################
# Summary
########################################
echo
echo "================================================"
if [[ "$FAILS" -eq 0 ]]; then
  echo -e "  ${GREEN}GO${NC} — All checks passed."
else
  echo -e "  ${RED}NO-GO${NC} — ${FAILS} failing check(s). Fix and re-run."
fi
if [[ "$WARN" -gt 0 ]]; then
  echo -e "  ${YELLOW}${WARN} warning(s)${NC} — recommended to address before production."
fi
echo "================================================"

exit "$FAILS"
