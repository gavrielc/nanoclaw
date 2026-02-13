# MicroClaw Device Baseline Implementation Plan

**Branch:** `feature/microclaw-device-baseline`  
**Goal:** Replace placeholder `microclaw-device` firmware with a usable baseline that boots, connects, renders minimal UI, and can exchange commands with a host transport.

---

## Phase 1 — Foundation Boot + Runtime Loop

### 1.1 Runtime skeleton
- Add `no_std`/`esp` entrypoint scaffold in `apps/microclaw-device`.
- Replace `main()` placeholder with:
  - deterministic startup sequence
  - structured init logging
  - bounded state machine (`Booting -> Ready -> Connected -> Error`)
- Add crash-safe fallback and restart hooks.

### 1.2 Board bring-up checks
- Log chip/flash/build metadata on boot.
- Add boot reason capture and watchdog/panic path markers.
- Add serial output gating for first 60 seconds.

**Acceptance**
- Board boots and prints boot banner over serial.
- No immediate reboot loop in 10 minutes.

---

## Phase 2 — Connectivity and Host Transport

### 2.1 Wi-Fi
- Add Wi-Fi config load/store (NVS or compiled defaults).
- Exponential backoff reconnect + timeout bounds.

### 2.2 Transport
- Add host channel over WSS (or TCP fallback flag).
- Implement control frames:
  - `hello`
  - `status`
  - `command`
  - `ack`
  - `error`
- Add heartbeat + ping/pong and offline queue for short outbound events.

**Acceptance**
- Connects to configured Wi-Fi and host.
- Sends hello within 30 seconds and maintains reconnect after network flap.

---

## Phase 3 — Display and Touch Baseline

### 3.1 Panel init
- Initialize QSPI/LCD driver for Waveshare 1.85" round LCD.
- Initialize touch controller and calibration path.
- Prefer a staged bring-up matching Waveshare docs (Power / I2C / panel init / touch IRQ verification).
- Use QSPI-facing ST77916 path and CST816S touch behavior caveats (post-touch read window, optional ID-read disable).

#### 3.2 Implementation references
- Waveshare pinout and controller references:
  - `docs/TARGET_DEVICE.md`
  - Waveshare ESP32-S3-Touch-LCD-1.85C wiki examples and demo descriptions (`docs/GUI.md` and `docs/plans/2026-02-13-microclaw-device-display-touch-plan.md`).
- ESP component references:
  - `espressif/esp_lcd_st77916` for ST77916
  - `espressif/esp_lcd_touch_cst816s` for CST816S
- Current deeper plan: `docs/plans/2026-02-13-microclaw-device-display-touch-plan.md`
- Key-screen mockups: `docs/plans/2026-02-13-microclaw-device-ui-mockups.md`

### 3.2 Minimal GUI
- Add 3+ screens:
  - boot/status
  - connected/health
  - recent events list (last 8 entries)
  - settings overlay + error/offline views
- No blocking redraw path; single-threaded bounded updates only.

**Acceptance**
- Display and touch report values to serial.
- No frame drops on normal status refresh.

---

## Phase 4 — Command Dispatcher

### 4.1 Message contract
- Define command/action envelope in Rust.
- Validate all incoming host frames against strict schema.

### 4.2 Queue and handlers
- Add bounded command queue (size and age caps).
- Commands:
  - `reboot`
  - `wifi_reconnect`
  - `status_get`
  - `ota_start` (placeholder ack-only first pass)
- Return explicit ack/error responses.

**Acceptance**
- Malformed commands are rejected safely.
- `reboot` and `status_get` round-trip works end-to-end.

---

## Phase 5 — OTA + Recovery

### 5.1 OTA manifest path
- Add manifest fetch and staged image validation flow.
- Health-check state + rollback marker on first boot.

### 5.2 Recovery
- Add "safe mode" marker to disable risky features on next boot.

**Acceptance**
- A simulated bad OTA does not brick the device.
- Manual reset returns to previous app if health check fails.

---

## Phase 6 — Device Security Baseline

### 6.1 Secrets handling
- Secrets from NVS/host provisioning only, never hardcoded.
- In-memory credential usage, no debug dump in normal mode.

### 6.2 Network defaults
- Strict host allowlist.
- Optional cert pinning mode for WSS.

**Acceptance**
- No credentials appear in serial by default.
- Connects only to allowlisted host in secure mode.

---

## Non-Negotiable Execution Notes

- Keep `RUSTFLAGS`, `CARGO_UNSTABLE_BUILD_STD`, and flash profile documented in all scripts.
- Use bounded queues and fixed-size buffers only (no unbounded growth).
- Every phase must include a host-side verification check (serial or websocket + status payload).
- Do not merge beyond baseline UI/transport without transport security pass.

---

## Script and Commands

- Use existing branch script for flash/install:
  - `./scripts/flash-microclaw-device.sh`
- Use transport test mode before any UI heavy changes.

## Gap Remediation Master Plan

- Consolidated remediation plan: `docs/plans/2026-02-13-microclaw-gap-remediation-master-plan.md`
- Display/touch deep plan: `docs/plans/2026-02-13-microclaw-device-display-touch-plan.md`
- UI mockups for interaction screens: `docs/plans/2026-02-13-microclaw-device-ui-mockups.md`
- Reliability/security operations plan: `docs/plans/2026-02-13-gap3-reliability-security-operations.md`
- Voice/UI/transport coupling plan: `docs/plans/2026-02-13-gap5-voice-ui-transport-coupling.md`
