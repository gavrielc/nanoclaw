#!/usr/bin/env bash
# run-tests.sh - Maintainer regression tests for update-nanoclaw skill scripts

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SANDBOX_SCRIPT="$SKILL_DIR/test-sandbox.sh"
START_DIR="$(pwd)"

log() {
  echo "[run-tests] $*"
}

fail() {
  echo "[run-tests] FAIL: $*" >&2
  exit 1
}

assert_key_equals() {
  local file="$1"
  local key="$2"
  local expected="$3"
  local actual
  actual=$(sed -n "s/^${key}=//p" "$file" | head -n 1)
  if [ "$actual" != "$expected" ]; then
    echo "[run-tests] Output in $file:" >&2
    cat "$file" >&2
    fail "Expected ${key}=${expected}, got ${actual:-<empty>}"
  fi
}

assert_contains() {
  local file="$1"
  local pattern="$2"
  if ! grep -q "$pattern" "$file"; then
    echo "[run-tests] Output in $file:" >&2
    cat "$file" >&2
    fail "Expected pattern '$pattern' in $file"
  fi
}

run_expect() {
  local expected_exit="$1"
  local out_file="$2"
  shift 2

  set +e
  "$@" >"$out_file" 2>&1
  local exit_code=$?
  set -e

  if [ "$exit_code" -ne "$expected_exit" ]; then
    echo "[run-tests] Command failed exit check: $*" >&2
    echo "[run-tests] Expected exit: $expected_exit, got: $exit_code" >&2
    echo "[run-tests] Output in $out_file:" >&2
    cat "$out_file" >&2
    fail "Unexpected exit code"
  fi
}

key_from_output() {
  local output="$1"
  local key="$2"
  echo "$output" | sed -n "s/^${key}=//p" | head -n 1
}

CURRENT_SANDBOX=""
CASE_OUTPUT=""
CASE_USER_CLONE=""
CASE_UPSTREAM=""
CASE_BRANCH=""
CASE_USER_HEAD=""
CASE_CHERRY_CLEAN_HASH=""
CASE_CHERRY_CONFLICT_HASH=""

cleanup_sandbox() {
  if [ -d "$START_DIR" ]; then
    cd "$START_DIR" >/dev/null 2>&1 || true
  else
    cd / >/dev/null 2>&1 || true
  fi

  if [ -n "$CURRENT_SANDBOX" ] && [ -d "$CURRENT_SANDBOX" ]; then
    rm -rf "$CURRENT_SANDBOX"
  fi
  CURRENT_SANDBOX=""
}

trap cleanup_sandbox EXIT

new_case() {
  local case_name="$1"
  cleanup_sandbox

  CASE_OUTPUT=$(bash "$SANDBOX_SCRIPT" --case "$case_name" --quiet)
  CURRENT_SANDBOX=$(key_from_output "$CASE_OUTPUT" "SANDBOX")
  CASE_USER_CLONE=$(key_from_output "$CASE_OUTPUT" "USER_CLONE")
  CASE_UPSTREAM=$(key_from_output "$CASE_OUTPUT" "UPSTREAM")
  CASE_BRANCH=$(key_from_output "$CASE_OUTPUT" "UPSTREAM_BRANCH")
  CASE_USER_HEAD=$(key_from_output "$CASE_OUTPUT" "USER_HEAD")
  CASE_CHERRY_CLEAN_HASH=$(key_from_output "$CASE_OUTPUT" "CHERRY_CLEAN_HASH")
  CASE_CHERRY_CONFLICT_HASH=$(key_from_output "$CASE_OUTPUT" "CHERRY_CONFLICT_HASH")

  [ -n "$CURRENT_SANDBOX" ] || fail "Sandbox path missing for case $case_name"
  [ -n "$CASE_USER_CLONE" ] || fail "User clone path missing for case $case_name"
  [ -n "$CASE_UPSTREAM" ] || fail "Upstream path missing for case $case_name"
  [ -n "$CASE_BRANCH" ] || fail "Upstream branch missing for case $case_name"
}

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"; cleanup_sandbox' EXIT

log "Syntax checking scripts"
for f in "$SCRIPT_DIR"/*.sh "$SANDBOX_SCRIPT"; do
  bash -n "$f"
done

# 1) merge-conflict
log "Case: merge-conflict"
new_case "merge-conflict"
cd "$CASE_USER_CLONE"
run_expect 0 "$TMP_DIR/preflight_merge.txt" bash "$SCRIPT_DIR/preflight.sh"
assert_key_equals "$TMP_DIR/preflight_merge.txt" "STATUS" "ok"
assert_key_equals "$TMP_DIR/preflight_merge.txt" "UPSTREAM_BRANCH" "main"

run_expect 0 "$TMP_DIR/preview_merge.txt" bash "$SCRIPT_DIR/preview.sh" "$CASE_BRANCH"
assert_key_equals "$TMP_DIR/preview_merge.txt" "STATUS" "ok"
assert_key_equals "$TMP_DIR/preview_merge.txt" "HAS_UPDATES" "1"

run_expect 0 "$TMP_DIR/backup_merge.txt" bash "$SCRIPT_DIR/backup.sh"
assert_key_equals "$TMP_DIR/backup_merge.txt" "STATUS" "ok"
BACKUP_TAG=$(sed -n 's/^BACKUP_TAG=//p' "$TMP_DIR/backup_merge.txt" | head -n 1)
[ -n "$BACKUP_TAG" ] || fail "Missing BACKUP_TAG in merge-conflict case"

run_expect 3 "$TMP_DIR/dryrun_merge.txt" bash "$SCRIPT_DIR/dryrun-merge.sh" "$CASE_BRANCH"
assert_key_equals "$TMP_DIR/dryrun_merge.txt" "STATUS" "conflicts"
assert_key_equals "$TMP_DIR/dryrun_merge.txt" "CONFLICT_COUNT" "2"

run_expect 3 "$TMP_DIR/apply_merge.txt" bash "$SCRIPT_DIR/apply-merge.sh" "$CASE_BRANCH"
assert_key_equals "$TMP_DIR/apply_merge.txt" "STATUS" "conflicts"
assert_key_equals "$TMP_DIR/apply_merge.txt" "CONFLICT_COUNT" "2"

# Resolve deterministic sandbox conflicts quickly for downstream validation tests
git checkout --theirs src/config.ts src/index.ts >/dev/null 2>&1
git add src/config.ts src/index.ts >/dev/null 2>&1
git commit --no-edit >/dev/null 2>&1

run_expect 0 "$TMP_DIR/validate_merge.txt" bash "$SCRIPT_DIR/validate.sh"
assert_key_equals "$TMP_DIR/validate_merge.txt" "STATUS" "ok"

run_expect 0 "$TMP_DIR/report_merge.txt" bash "$SCRIPT_DIR/report.sh" "$CASE_BRANCH" "$BACKUP_TAG"
assert_key_equals "$TMP_DIR/report_merge.txt" "STATUS" "ok"

# 2) clean-merge
log "Case: clean-merge"
new_case "clean-merge"
cd "$CASE_USER_CLONE"
run_expect 0 "$TMP_DIR/preflight_clean.txt" bash "$SCRIPT_DIR/preflight.sh"
assert_key_equals "$TMP_DIR/preflight_clean.txt" "STATUS" "ok"

run_expect 0 "$TMP_DIR/dryrun_clean.txt" bash "$SCRIPT_DIR/dryrun-merge.sh" "$CASE_BRANCH"
assert_key_equals "$TMP_DIR/dryrun_clean.txt" "STATUS" "clean"
assert_key_equals "$TMP_DIR/dryrun_clean.txt" "CONFLICT_COUNT" "0"

run_expect 0 "$TMP_DIR/apply_clean.txt" bash "$SCRIPT_DIR/apply-merge.sh" "$CASE_BRANCH"
assert_key_equals "$TMP_DIR/apply_clean.txt" "STATUS" "ok"
assert_key_equals "$TMP_DIR/apply_clean.txt" "CONFLICT_COUNT" "0"

run_expect 0 "$TMP_DIR/validate_clean.txt" bash "$SCRIPT_DIR/validate.sh"
assert_key_equals "$TMP_DIR/validate_clean.txt" "STATUS" "ok"

# 3) no-upstream (includes scripted version of interactive URL flow)
log "Case: no-upstream"
new_case "no-upstream"
cd "$CASE_USER_CLONE"
run_expect 2 "$TMP_DIR/preflight_no_upstream.txt" bash "$SCRIPT_DIR/preflight.sh"
assert_key_equals "$TMP_DIR/preflight_no_upstream.txt" "STATUS" "no_upstream"

run_expect 0 "$TMP_DIR/preflight_with_url.txt" bash "$SCRIPT_DIR/preflight.sh" --url "$CASE_UPSTREAM"
assert_key_equals "$TMP_DIR/preflight_with_url.txt" "STATUS" "ok"

# 4) bad-upstream
log "Case: bad-upstream"
new_case "bad-upstream"
cd "$CASE_USER_CLONE"
run_expect 1 "$TMP_DIR/preflight_bad_upstream.txt" bash "$SCRIPT_DIR/preflight.sh"
assert_key_equals "$TMP_DIR/preflight_bad_upstream.txt" "STATUS" "error"
assert_key_equals "$TMP_DIR/preflight_bad_upstream.txt" "ERROR" "fetch failed"

# 5) no-main-master
log "Case: no-main-master"
new_case "no-main-master"
cd "$CASE_USER_CLONE"
run_expect 2 "$TMP_DIR/preflight_no_main.txt" bash "$SCRIPT_DIR/preflight.sh"
assert_key_equals "$TMP_DIR/preflight_no_main.txt" "STATUS" "no_branch"
assert_contains "$TMP_DIR/preflight_no_main.txt" '^AVAILABLE_BRANCHES=.*develop'

# 6) cherry-conflict
log "Case: cherry-conflict"
new_case "cherry-conflict"
cd "$CASE_USER_CLONE"
[ -n "$CASE_CHERRY_CLEAN_HASH" ] || fail "Missing CHERRY_CLEAN_HASH"
[ -n "$CASE_CHERRY_CONFLICT_HASH" ] || fail "Missing CHERRY_CONFLICT_HASH"

run_expect 0 "$TMP_DIR/preflight_cherry.txt" bash "$SCRIPT_DIR/preflight.sh"
assert_key_equals "$TMP_DIR/preflight_cherry.txt" "STATUS" "ok"

run_expect 3 "$TMP_DIR/cherry_conflict.txt" bash "$SCRIPT_DIR/apply-cherry-pick.sh" "$CASE_BRANCH" "$CASE_CHERRY_CLEAN_HASH" "$CASE_CHERRY_CONFLICT_HASH"
assert_key_equals "$TMP_DIR/cherry_conflict.txt" "STATUS" "conflicts"
assert_key_equals "$TMP_DIR/cherry_conflict.txt" "APPLIED" "1"
assert_key_equals "$TMP_DIR/cherry_conflict.txt" "FAILED_AT" "$CASE_CHERRY_CONFLICT_HASH"
git cherry-pick --abort >/dev/null 2>&1 || true

# 7) validate-fail
log "Case: validate-fail"
new_case "validate-fail"
cd "$CASE_USER_CLONE"
run_expect 0 "$TMP_DIR/preflight_validate_fail.txt" bash "$SCRIPT_DIR/preflight.sh"
assert_key_equals "$TMP_DIR/preflight_validate_fail.txt" "STATUS" "ok"

run_expect 0 "$TMP_DIR/apply_validate_fail.txt" bash "$SCRIPT_DIR/apply-merge.sh" "$CASE_BRANCH"
assert_key_equals "$TMP_DIR/apply_validate_fail.txt" "STATUS" "ok"

run_expect 1 "$TMP_DIR/validate_fail.txt" bash "$SCRIPT_DIR/validate.sh"
assert_key_equals "$TMP_DIR/validate_fail.txt" "STATUS" "build_failed"
assert_contains "$TMP_DIR/validate_fail.txt" '^Build failed:'

log "PASS: all update-nanoclaw script tests passed"
