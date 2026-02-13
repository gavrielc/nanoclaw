# ESP-IDF Toolchain (MicroClaw Device)

This repo targets the ESP32-S3 via the `xtensa-esp32s3-espidf` Rust target and ESP-IDF v5.1.

## Prerequisites

- Install the ESP Rust toolchain (espup) and ensure `cargo +esp` works.
- If available, keep `$HOME/export-esp.sh` with toolchain PATH and LIBCLANG_PATH.

## Canonical Check Command

Use the provided script (preferred):

```bash
./scripts/esp-check.sh
```

Manual equivalent:

```bash
source "$HOME/export-esp.sh"
export ESP_IDF_VERSION=release/v5.1
export RUSTFLAGS="--cfg espidf_time64"
export CARGO_BUILD_TARGET=xtensa-esp32s3-espidf
export CARGO_UNSTABLE_BUILD_STD=std,panic_abort
cargo +esp check -p microclaw-device --features esp
```

## Notes

- `CARGO_UNSTABLE_BUILD_STD` is required to build `core/std` for the xtensa target.
- If you switch ESP-IDF versions, clear stale CMake caches under `target/xtensa-esp32s3-espidf/...`.
