# MicroClaw Device Display + Touch Plan (Waveshare 1.85" Round LCD)

**Branch:** `feature/microclaw-device-baseline`

**Goal:** Implement a deterministic, low-memory on-device UI stack for the Waveshare ESP32-S3-Touch-LCD-1.85C using the current Rust/ESP-IDF toolchain, with explicit phased milestones and a concrete fallback path.

## 1) Confirmed hardware facts

From Waveshare product + wiki sources, this board is:

- ESP32-S3R8, 240MHz, 512KB SRAM + 8MB PSRAM, 16MB Flash
- 1.85" round 360x360 ST77916 panel (SPI/QSPI)
- CST816 (I2C) touch controller on GPIO10/11 I2C shared with RTC/IMU path
- Fixed pins in internal connection list include:
  - LCD control: GPIO40/41/42/45/46 data+clock, CS21, RST(EXIO2), BL5
  - Touch: TP_SDA11, TP_SCL10, TP_INT4, TP_RST(EXIO1)
  - Speaker/Mic/I2C extras as documented in Waveshare interfaces section
- Official demo apps reference includes:
  - LVGL Arduino demo
  - ESP32-S3-Touch-LCD-1.85C-Test (device functions page + audio playback + speech commands)
  - 1.85C Wiki’s ESP-IDF demo list references the broader Waveshare pattern used across 1.8–4.3" touch panels

## 2) Current `microclaw-device` gap

Current firmware does not include display/touch runtime at all (boot banner + placeholder stubs only).

Missing core capabilities:

- No LCD controller init (`st77916` path)
- No touch I2C / interrupt handling
- No display surface abstraction
- No UI scene graph / event loop
- No rendering scheduler, invalidation, or frame lifecycle
- No touch-to-command mapping

## 3) Design principles

- Bound memory first: use bounded buffers and event queues only.
- Keep frame work bounded: dirty-rect + batched updates, avoid full-screen redraws unless needed.
- Keep touch deterministic: ISR triggers + sampled queue, then event consumption on UI task.
- Keep startup and errors visible: status boot screen must always render meaningful state.
- Feature gating: compile-time traits (`no_ui`, `sim`, `esp`) so host tests remain valid on non-embedded targets.

## 4) Implementation approach by milestones

### Milestone A — Driver foundations (target: 1 week)

1. Add a tiny platform abstraction crate/file:
   - `DisplayDriver` trait with `init`, `flush_region`, `set_brightness`, `deinit`
   - `TouchDriver` trait with `init`, `read_once`, `calibrate`, `set_transform`
2. Wire board pin map constants for 1.85C into one module:
   - display pins
   - touch pins
   - backlight + reset pins
3. Add ESP-IDF component dependency plan:
   - `espressif/esp_lcd_st77916` for panel
   - `espressif/esp_lcd_touch_cst816s` for touch
4. Add startup sequence log checkpoints:
   - `boot_display_init_ok`
   - `boot_touch_irq_ok`
   - `boot_ui_scene_ready`

Acceptance:
- Cold boot brings up display and shows boot UI.
- Touch interrupt line transition is observed in logs.

### Milestone B — Touch event pipeline (target: 1 week)

1. Implement interrupt-driven touch sampling task:
   - ISR posts semaphore/event to touch task.
   - Touch task calls `read_data()` and fetches `get_data()`.
2. Add geometry normalization:
   - clamp to 360x360 then map to logical circle boundary when rendering UI.
   - apply orientation and mirror swap transform from config.
3. Add bounded queue:
   - e.g. 32-event ring buffer, drop-on-overflow with overflow counter metric.
4. Add synthetic-up safeguard and stale event purge:
   - auto-up if finger timeout crosses 2s.

Acceptance:
- No queue overflow in 10-min touch stress test.
- Raw miss/hot-noise does not freeze UI tasks.

### Milestone C — Scene + render loop baseline (target: 1–2 weeks)

1. Build screen state enum and minimal scene renderer:
   - `Boot`, `Pairing`, `Connected`, `Conversation`, `Settings`, `Error`, `Offline`
2. Add event loop contract:
   - 60Hz internal tick cap, 10–20Hz real render for status-heavy scenes.
3. Add dirty region rendering and partial updates (where library allows).
4. Include touch hit targets >=48px (recommend 56px on round board), with edge-safe spacing.
5. Ensure every scene has "status line" + "primary action" in one render pass.

Acceptance:
- Scene transitions complete <100ms on normal workload.
- No full-screen redraw >70% of frames after baseline idle.

### Milestone D — Demo mode (target: 1 week)

Until custom app is ready, ship `--demo-sim` profile:

- Scene 1: Diagnostics (flash, I2C state, Wi-Fi, host state)
- Scene 2: touch pointer indicator + recent events
- Scene 3: audio path and wake-word visual feedback

Demo mode can run while backend transport is incomplete so onboard hardware validation is unblocked.

Acceptance:
- On-device UI proves all touch zones and scene transitions with real touch.

### Milestone E — Integration with host transport (target: 1–2 weeks)

1. Connect status updates from transport frames:
   - update host connected/disconnected
   - show command in-flight / reply state
2. Dispatch touch events to command actions:
   - `reconnect`, `sync`, `settings`, `mute`, `end`, `pause`
3. Add offline mode fallback:
   - keep local status UI functional when link is down.

Acceptance:
- No panic from transport state spikes (heartbeat lost/recovered).
- At least 3 actionable touch controls work end-to-end.

## 5) Demo and firmware references for early bring-up

Use these as interim validation before custom UI:

1. Waveshare LVGL_Arduino sample and `ESP32-S3-Touch-LCD-1.85C-Test`
2. Waveshare family ESP-IDF demo pattern list (e.g. 01_i2c, 02_rtc, 03_lcd, 06_touch, 11_speaker_microphone, 12/13 LVGL variants) as smoke-test matrix equivalents.
3. Existing `flash-microclaw-device.sh` for flashing workflow.

## 6) Risk watchlist

- CST816 behavior: only responds after touch event; avoid eager read loops.
- Touch initialization may fail with ID reads on some chips; support ID-read disable option.
- QSPI/clock misconfiguration can silently fail, so always include a backlight-safety path.
- PSRAM contention with audio + transport tasks; throttle draw cadence under load.

## 7) Immediate next actions (next 72h)

1. Wire driver abstraction stubs + board pin constants.
2. Add UI scene enum + event structs in `apps/microclaw-device` (desktop-compilable via `cfg(not(feature=\"esp\"))`).
3. Add a `docs` + `mockups` package for key screens.
4. Add acceptance tests in `apps/microclaw-device/tests` for geometry/event mapping (host-mode unit path).

