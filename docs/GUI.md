# GUI on the Target Device (ESP32-S3 Round LCD)

This doc covers GUI options and constraints for the NanoClaw Rust port targeting the Waveshare ESP32-S3 Touch LCD 1.85C board (`docs/TARGET_DEVICE.md`).

## Device Reality (What We're Building For)

Hardware characteristics (high-level):
- MCU-class target (ESP32-S3), no desktop windowing system.
- 360x360 LCD + touch, driven over QSPI/I2C.
- Waveshare board exposes CST816 touch on I2C (shared pins) and ST77916 RGB LCD at QSPI speed.
- Practical "GPU" is not available; expect software rendering.
- Tight RAM/flash constraints relative to desktop.

Framebuffer budget (RGB565):
- 360 * 360 * 2 bytes = 259,200 bytes ~= 253 KiB for one full-screen buffer.
- Double-buffer ~= 506 KiB (plus allocator overhead/caches/fonts).

## Board-native Demo App References

The Waveshare 1.85C documentation references existing demo apps that are useful for immediate flashing validation:

- `LVGL_Arduino` demo (LVGL + audio stack, includes status and music pages)
- `ESP32-S3-Touch-LCD-1.85C-Test` demo (page 1 system parameters, page 2 music interface, with speech recognition path)
- Touch behavior references include 5-point touch validation and driver loops in the ESP-IDF demo flow.

If you need an immediate first-pass on-device visual check before custom UI, these are the quickest “known-good” targets because they exercise:
- display init,
- touch input path,
- I2C peripheral access,
- backlight and audio I/O.

## Waveshare-aligned Component Stack

For this board’s display/touch path, the practical component stack is:

- `espressif/esp_lcd_st77916` (SPI/QSPI panel driver, supports QSPI mode for this board)
- `espressif/esp_lcd_touch_cst816s` (CST816 touch via I2C, touch-event driven behavior)

Important touch caveats from component docs:
- touch reads are event-driven (touch should be polled after interrupt/notification),
- for some chips disable touch-ID reads in config if it causes init failures,
- expect single-finger event behavior in the current CST816S component.

## Framework Fit Matrix (On-Device)

### Slint (recommended for on-device GUI)

Why it fits:
- Slint's software renderer is intended to run on microcontrollers and supports partial rendering and line-by-line rendering (line-by-line is Rust-only). This can avoid needing full-frame buffers.
- Slint has documented MCU support and can be integrated into custom event loops with manual timer/animation updates.
- Slint provides an ESP-IDF component and documents that it has been tested on ESP32-S3 devices.
- There are public example repos showing Rust + Slint on Waveshare ESP32-S3 boards using the ESP-IDF Rust toolchain (`esp-idf-hal`, `espflash`, `ldproxy`).

Constraints to be aware of:
- The software renderer has feature limitations (e.g., no rotations/scaling; partial CSS feature support).
- CPU usage depends heavily on redraw strategy; use partial rendering and limit animation.

### LVGL (pragmatic alternative, but C-first)

Why it fits:
- Waveshare's own board documentation positions LVGL as the expected GUI library for this device family ("can smoothly run GUI programs such as LVGL").

Tradeoffs:
- LVGL is C; using it from Rust means FFI + build-system integration with ESP-IDF.
- Bigger surface area and more configuration/porting work than Slint for "Rust-first".

### embedded-graphics (+ lightweight UI layers)

Why it fits:
- `embedded-graphics` is designed for memory-constrained embedded devices and can draw without allocating large screen-sized buffers.

Tradeoffs:
- It's a drawing library, not a full GUI toolkit.
- You'll build your own widgets/state-management or adopt a small UI layer.

Example of a small embedded GUI layer:
- Kolibri: an immediate-mode embedded GUI mini-framework inspired by egui, built on `embedded-graphics`.

### egui (not recommended on-device; good for desktop companion tooling)

Reality check:
- `egui` is UI logic; it does not collect input or paint pixels by itself. Rendering/input is provided by an integration/backend (e.g. `eframe`).

What that means for ESP32-S3:
- On-device egui would require writing a custom embedded backend (input + a painter that renders into RGB565 and pushes to `esp_lcd`).
- It can still be valuable as a desktop "control panel" for the device during development.

### Iced (not recommended on-device)

Reality check:
- Iced's native renderer stack is built on `wgpu` (Vulkan/Metal/DX, etc.) and expects a desktop-class graphics stack/windowing model.

## Implementation Artifacts

- Plan: `docs/plans/2026-02-13-microclaw-device-display-touch-plan.md`
- Mockups: `docs/plans/2026-02-13-microclaw-device-ui-mockups.md`

## Recommendation

For the ESP32-S3 board UI:
1. Use Slint for the first on-device GUI implementation.
2. Keep LVGL as the fallback if we hit a hard driver/performance limitation.
3. Use egui or iced only for optional desktop tooling (simulators, debug dashboards).

## Flashing and Iteration (Waveshare Board)

The board flashes over USB Type-C and provides BOOT + RESET buttons.

If flashing fails, Waveshare's own FAQ suggests forcing download mode:
- Long press BOOT, press RESET, release RESET, then release BOOT (enter download mode).
- Holding BOOT while reconnecting USB can also enter download mode.

For Rust firmware, a typical workflow is:
- Use the ESP-IDF Rust toolchain (esp-rs / esp-idf-sys stack).
- Flash with `espflash` (often via `cargo run --release` in examples).

## Links

- Target device spec: `docs/TARGET_DEVICE.md`
- Voice stack: `docs/VOICE.md`
- Rust port plan: `RUST_PORT.md`

## External References

- Waveshare wiki (device + flashing FAQ): https://www.waveshare.com/wiki/ESP32-S3-Touch-LCD-1.85C
- Slint: Backends and Renderers: https://docs.slint.dev/latest/docs/slint/src/getting_started/backends_and_renderers
- Slint: MCU docs (Rust): https://docs.rs/slint/latest/slint/docs/mcu/index.html
- Slint: ESP-IDF component docs: https://docs.slint.dev/latest/docs/cpp/esp_idf/
- Slint blog (MCU memory focus): https://slint.dev/blog/porting-slint-to-microcontrollers.html
- embedded-graphics: https://github.com/embedded-graphics/embedded-graphics
- Kolibri: https://github.com/ryankurte/kolibri
- egui: https://github.com/emilk/egui
- Iced: https://github.com/iced-rs/iced
- Waveshare demo page: https://www.waveshare.com/wiki/ESP32-S3-Touch-LCD-1.85C
- ESP LCD component stack:
  - https://components.espressif.com/components/espressif/esp_lcd_st77916
  - https://components.espressif.com/components/espressif/esp_lcd_touch_cst816s
