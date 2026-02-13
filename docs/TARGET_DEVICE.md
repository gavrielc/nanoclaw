# Target Device: Waveshare ESP32-S3 Touch LCD 1.85C (+ Smart Speaker Box)

This is the baseline embedded hardware target for the Rust port of NanoClaw.

Last verified: 2026-02-12

References:
- [Waveshare wiki: ESP32-S3-Touch-LCD-1.85C](https://www.waveshare.com/wiki/ESP32-S3-Touch-LCD-1.85C)
- [Waveshare product: ESP32-S3-Touch-LCD-1.85C](https://www.waveshare.com/esp32-s3-touch-lcd-1.85c.htm)
- [Waveshare product: ESP32-S3-Touch-LCD-1.85C with Smart Speaker Box](https://www.waveshare.com/esp32-s3-touch-lcd-1.85c-with-speaker-box.htm)

## Key Specs (Waveshare-reported)

- MCU: Espressif ESP32-S3R8 (dual-core Xtensa LX7, up to 240 MHz)
- Memory: 512 KB SRAM + 8 MB PSRAM
- Flash: 16 MB
- Wireless: 2.4 GHz 802.11 b/g/n Wi-Fi + Bluetooth LE 5
- Display: 1.85" round IPS, 360x360, 262K colors
  - LCD controller: ST77916
  - LCD interface: QSPI
  - Touch: CST816 (I2C)
- Storage/peripherals:
  - TF (microSD) slot
  - Microphone (I2S)
  - Audio DAC: PCM5101 (I2S)
  - IMU: QMI8658 (I2C)
  - RTC: PCF85063 (I2C)

Notes:
- On this board, GPIO10 and GPIO11 are used for I2C (touch/IMU/RTC) and are not generally available for arbitrary remapping.
- The "Smart Speaker Box" is an optional enclosure; Waveshare sells variants with/without a 3.7V Li battery.

## Software Environment Assumptions

- Runs FreeRTOS via ESP-IDF.
- The Rust target should assume ESP-IDF Rust (`esp-idf` / `esp-idf-sys`, i.e. `std`), because Wi-Fi/BLE, TLS, and filesystem support are pragmatic requirements for NanoClaw-like behavior.

## Hard Constraints vs Current NanoClaw

Compared to the current Node host + containerized runner architecture:

1. No Linux containers on-device.
   - Apple Container and Docker are not available.
   - The current "agent sandbox" boundary cannot be implemented as a container locally.

2. Tight RAM/flash budgets.
   - 8 MB PSRAM is the practical ceiling for heap-heavy workloads.
   - Avoid unbounded queues/buffers and large JSON blobs.
   - Flash writes are wear-sensitive; treat high-frequency DB writes and verbose logging as design hazards unless moved to SD.

3. No POSIX process model.
   - No `fork/exec`, no `container` CLI, no shelling out.
   - The execution backend must be implemented as in-process code or as a remote RPC boundary.

4. Network is intermittent and expensive.
   - Wi-Fi is 2.4 GHz only.
   - TLS handshakes are costly; reuse connections and keep payloads small.
   - Egress policy must be enforced in the networking layer (not via container networking rules).

## Port Implications (Practical)

- Keep `nanoclaw-core` policy/routing logic portable and OS-agnostic.
- Replace the container-centric `nanoclaw-sandbox` layer with an execution backend abstraction that can support:
  - `remote_sandbox` (recommended): ESP32 talks to a LAN/Cloud runner that provides the old container isolation semantics.
  - `local_wasm` (future option): run a small WASM sandbox on-device with capability-limited host calls.
- Storage strategy should assume:
  - A small KV store (ESP-IDF NVS) for critical state, plus optional SD for logs/history.
  - If full SQLite semantics are required, plan to use SD and aggressively minimize write frequency.

## What "Embedded-Ready" Means (For This Board)

- The device can run the Rust host/coordinator and enforce policy/queueing/scheduling under hard resource bounds.
- Agent execution is off-device unless/until a safe, bounded on-device sandbox exists.
- All memory and output buffers are bounded by default; exceeding a bound is an explicit error (not "best effort").

## GUI (Display + Touch)

This board is intended to run a local GUI on the round 360x360 LCD (with touch input).

See `docs/GUI.md` for:
- A framework fit matrix (Slint vs LVGL vs embedded-graphics vs egui/iced).
- Rendering/buffering constraints and why "desktop-style" GUI stacks do not map directly to ESP32-S3 firmware.
- Flashing/iteration notes specific to Waveshare's BOOT/RESET flow.

## Voice (ASR/TTS)

See `docs/VOICE.md` for:
- What voice processing is realistic to run on-device (wake word + command recognition).
- How to integrate remote ASR/TTS models for full transcription and high-quality speech synthesis.

## Hosting + Transport

This device will depend on off-device services (voice inference, LLM calls, remote sandbox execution).

See `docs/MICROCLAW_HOSTING.md` for:
- Recommended LAN-first hosting topology.
- WebSocket vs MQTT transport tradeoffs for speed and robustness.
- Latency tuning notes (Wi-Fi power save, keepalive, buffering).
- OTA update strategy.
