#!/usr/bin/env bash
# validate.sh - Run build and tests if they exist
#
# Usage: validate.sh
# Exit codes: 0 all passed, 1 build/test failed
# Output: KEY=VALUE lines, then --- separator, then human summary

set -uo pipefail

BUILD_OK=""
TEST_OK=""
BUILD_OUTPUT=""
TEST_OUTPUT=""

# Check if package.json exists and has scripts
if [ ! -f "package.json" ]; then
  echo "STATUS=ok"
  echo "BUILD_SCRIPT=0"
  echo "TEST_SCRIPT=0"
  echo "---"
  echo "No package.json found. Skipping validation."
  exit 0
fi

# Check for build script
HAS_BUILD=$(node -e "try{const p=require('./package.json');console.log(p.scripts&&p.scripts.build?1:0)}catch(e){console.log(0)}" 2>/dev/null || echo "0")
HAS_TEST=$(node -e "try{const p=require('./package.json');console.log(p.scripts&&p.scripts.test?1:0)}catch(e){console.log(0)}" 2>/dev/null || echo "0")

# Run build
if [ "$HAS_BUILD" = "1" ]; then
  BUILD_OUTPUT=$(npm run build 2>&1) && BUILD_OK="1" || BUILD_OK="0"
else
  BUILD_OK="skip"
fi

# Run tests
if [ "$HAS_TEST" = "1" ]; then
  TEST_OUTPUT=$(npm test 2>&1) && TEST_OK="1" || TEST_OK="0"
else
  TEST_OK="skip"
fi

# Determine overall status
if [ "$BUILD_OK" = "0" ]; then
  echo "STATUS=build_failed"
  echo "BUILD_SCRIPT=$HAS_BUILD"
  echo "BUILD_OK=0"
  echo "TEST_SCRIPT=$HAS_TEST"
  echo "TEST_OK=${TEST_OK}"
  echo "---"
  echo "Build failed:"
  echo "$BUILD_OUTPUT"
  exit 1
fi

if [ "$TEST_OK" = "0" ]; then
  echo "STATUS=test_failed"
  echo "BUILD_SCRIPT=$HAS_BUILD"
  echo "BUILD_OK=${BUILD_OK}"
  echo "TEST_SCRIPT=$HAS_TEST"
  echo "TEST_OK=0"
  echo "---"
  echo "Tests failed:"
  echo "$TEST_OUTPUT"
  exit 1
fi

echo "STATUS=ok"
echo "BUILD_SCRIPT=$HAS_BUILD"
echo "BUILD_OK=${BUILD_OK}"
echo "TEST_SCRIPT=$HAS_TEST"
echo "TEST_OK=${TEST_OK}"
echo "---"
echo "Validation passed."
[ "$BUILD_OK" = "1" ] && echo "Build: ok" || true
[ "$BUILD_OK" = "skip" ] && echo "Build: no script found, skipped" || true
[ "$TEST_OK" = "1" ] && echo "Tests: ok" || true
[ "$TEST_OK" = "skip" ] && echo "Tests: no script found, skipped" || true
