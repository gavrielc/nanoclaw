#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/flash-microclaw-device.sh [--port /dev/cu.usbmodemXXXX] [--release] [--monitor]

Defaults:
- Uses auto-detected /dev/*usbmodem* port.
- Builds apps/microclaw-device with `--features esp`.
- Flashes debug binary (use --release for release build/flash).
- Does not auto-open monitor unless --monitor is passed.
USAGE
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST_PATH="$ROOT_DIR/apps/microclaw-device/Cargo.toml"
BUILD_PROFILE="debug"
PORT=""
OPEN_MONITOR=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--port)
      PORT="${2:?Expected port after --port}"
      shift 2
      ;;
    -r|--release)
      BUILD_PROFILE="release"
      shift
      ;;
    -m|--monitor)
      OPEN_MONITOR=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ ! -f "$HOME/export-esp.sh" ]]; then
  echo "Missing ~/export-esp.sh. Install/refresh with: espup install"
  exit 1
fi

source "$HOME/export-esp.sh"

# Force ESP_IDF_VERSION — export-esp.sh may set it to empty string,
# and ${:-} fallback doesn't trigger for empty (only unset).
export ESP_IDF_VERSION="release/v5.1"
export RUSTFLAGS="${RUSTFLAGS:-} --cfg espidf_time64"
export CARGO_BUILD_TARGET="${CARGO_BUILD_TARGET:-xtensa-esp32s3-espidf}"
export CARGO_UNSTABLE_BUILD_STD="${CARGO_UNSTABLE_BUILD_STD:-std,panic_abort}"
export CARGO_TARGET_XTENSA_ESP32S3_ESPIDF_LINKER="ldproxy"

find_port() {
  local candidates=()
  for candidate in /dev/tty.usbmodem* /dev/cu.usbmodem*; do
    [[ -e "$candidate" ]] && candidates+=("$candidate")
  done

  if (( ${#candidates[@]} == 0 )); then
    echo "No /dev/*usbmodem* port found." >&2
    return 1
  fi

  if (( ${#candidates[@]} > 1 )); then
    echo "Found multiple candidates: ${candidates[*]}" >&2
    echo "Using first: ${candidates[0]}" >&2
  fi

  printf '%s\n' "${candidates[0]}"
}

if [[ -z "$PORT" ]]; then
  PORT="$(find_port)"
fi

echo "Using serial port: $PORT"

if ! command -v espflash >/dev/null; then
  echo "espflash is not installed. Run: cargo install espflash"
  exit 1
fi

espflash board-info --port "$PORT"

cd "$ROOT_DIR"

if [[ "$BUILD_PROFILE" == "release" ]]; then
  BUILD_BIN="target/xtensa-esp32s3-espidf/release/microclaw-device"
  cargo +esp build --manifest-path "$MANIFEST_PATH" --features esp --release
else
  BUILD_BIN="target/xtensa-esp32s3-espidf/debug/microclaw-device"
  cargo +esp build --manifest-path "$MANIFEST_PATH" --features esp
fi

if [[ ! -x "$BUILD_BIN" ]]; then
  echo "Build artifact not found: $BUILD_BIN"
  echo "Check that the build completed successfully."
  exit 1
fi

espflash flash --port "$PORT" "$BUILD_BIN"

if (( OPEN_MONITOR == 1 )); then
  espflash monitor --port "$PORT"
fi

echo "Flash complete. Serial console: espflash monitor --port \"$PORT\""
