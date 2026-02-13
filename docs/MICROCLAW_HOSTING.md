# MicroClaw Hosting + Transport (ESP32-S3 Target)

This doc describes how to host the off-device services that the ESP32-S3 "microClaw" device depends on, and how to make the device <-> host transport low-latency and robust.

Context:
- Target device: Waveshare ESP32-S3 Touch LCD 1.85C (+ Smart Speaker Box), 16 MB flash, 8 MB PSRAM (`docs/TARGET_DEVICE.md`)
- Voice: on-device wake/commands + remote ASR/TTS (`docs/VOICE.md`)
- GUI: local UI on the device (`docs/GUI.md`)
- Rust port plan: `RUST_PORT.md` (remote sandbox backend is required for ESP32-S3)

## Definitions

- microClaw device: the ESP32-S3 firmware. Owns UI + audio I/O + wake word, and brokers requests to off-device services.
- microClaw host: a LAN (preferred) or cloud service that runs the heavy parts: ASR/TTS inference, LLM calls, and any "sandbox/tool execution" that cannot safely run on the microcontroller.

## Why We Need a Host (Non-Negotiable)

On ESP32-S3 class hardware, we cannot run:
- Linux containers (Apple Container/Docker).
- General ASR (Whisper/Distil-Whisper class).
- "Crisp" neural TTS (hundreds of millions of params).

So the device must talk to a host that can:
- run the remote sandbox backend (containers or equivalent)
- run voice models (ASR/TTS) and stream audio
- connect to LLM services with streaming responses

## Hosting Topology (Recommended)

### LAN-first (recommended)

Run microClaw host on a machine on the same Wi-Fi LAN as the device:
- mini PC / NUC
- always-on Mac mini
- Raspberry Pi-class device (voice inference may need more CPU/GPU; plan accordingly)

Benefits:
- lowest RTT (biggest latency win)
- keeps voice data local (privacy)
- reduces cloud dependency

### Cloud (fallback)

If you must host in the cloud:
- use a VPN overlay (WireGuard/Tailscale) so the ESP32 can reach a stable private address
- expect higher latency and more jitter
- treat credentials and audio privacy as higher risk

## Transport Requirements (What We Optimize For)

Control-plane requirements:
- bidirectional messages (device <-> host)
- request/response RPC (start task, cancel, status, etc.)
- push notifications (host can push TTS chunks, UI updates, etc.)
- device provisioning/authentication

Data-plane requirements:
- stream audio upstream (mic -> host ASR) with bounded jitter buffer
- stream audio downstream (host TTS -> device speaker) with bounded jitter buffer
- optional partial transcripts + partial TTS synthesis for best perceived latency

Security requirements:
- TLS with server cert validation (no "accept any cert" defaults)
- device auth without embedding long-lived cloud API keys in firmware
- explicit egress allowlist

## Transport Options (Device <-> Host)

### Option A: WebSocket over TLS (wss) (recommended for interactive voice + UI)

Why:
- single persistent full-duplex connection (no per-request handshake)
- good fit for streaming audio + control messages on one channel
- supported by ESP-IDF (esp_websocket_client) and by Rust servers

ESP-IDF WebSocket client features:
- supports `ws://` and `wss://` and TLS via mbedtls
- configurable keepalive and ping/pong behavior
- configurable buffer sizes, reconnect behavior

See ESP-IDF WebSocket client docs for TLS requirements and configuration fields (including `cert_pem`, `buffer_size`, keep-alive settings). Note: if no certificate is provided, TLS may default to not verifying the server. Treat that as insecure-by-default and always configure proper verification.

How to make it fast:
- keep the WebSocket open for the whole session
- binary frames (avoid JSON for hot paths)
- small audio frames (e.g. 20 ms PCM16 @ 16 kHz = 640 bytes payload) to reduce buffering latency
- prioritize audio frames over telemetry

### Option B: MQTT over TLS (mqtts) (recommended for telemetry + background commands)

Why:
- simple IoT pub/sub
- excellent for state sync, telemetry, and background messaging
- built-in keepalive and reconnect knobs

Notes:
- MQTT is not ideal for low-latency audio streaming unless you build chunking carefully.
- ESP-IDF default keepalive is 120s, configurable.
- Rust on ESP-IDF can use `esp-idf-svc`'s `EspMqttClient` and `MqttClientConfiguration` (includes keep-alive interval, reconnect timeout, buffer sizing, and TLS options).

### Option C: Raw TCP + custom framing

Fastest in theory, most engineering effort:
- you reinvent ping/keepalive/reconnect/backpressure
- you still need TLS and cert verification

Not recommended unless WebSocket/MQTT are insufficient.

## Recommendation (Pragmatic)

1. Use `wss://` WebSocket as the primary transport for interactive sessions:
   - control messages (CBOR/protobuf)
   - audio upstream/downstream (binary frames)
2. Optionally add MQTT later for telemetry/state replication if we want offline-ish buffering and pub/sub semantics.

## Device-Side Latency Tuning (ESP32-S3)

### Wi-Fi power save modes

Power saving can add measurable receive latency.
To minimize real-time latency, disable modem-sleep:
- `esp_wifi_set_ps(WIFI_PS_NONE)` (higher power, lower latency)

If battery life matters, you can enable modem-sleep, but expect the receive delay to correlate with DTIM/listen-interval settings.

### Keepalive and reconnect

For WebSocket:
- configure keepalive (TCP keepalive + ping/pong where supported)
- tune buffer sizes to avoid fragmentation while keeping memory bounded

For MQTT:
- keepalive, reconnect timeout, and buffers should be explicit, not left at defaults

## Protocol Sketch (Over WebSocket)

Goal: keep parsing simple and allocations bounded.

Frame types (binary):
- `0x01` CONTROL: CBOR/protobuf envelope
- `0x02` AUDIO_IN: PCM16/16k frames (or Opus if we add compression later)
- `0x03` AUDIO_OUT: PCM16/16k frames

CONTROL message types (examples):
- hello/auth (device id, firmware version, time sync)
- ping/pong (host RTT)
- start_asr_stream / stop_asr_stream
- asr_partial / asr_final
- tts_start / tts_chunk / tts_end
- run_task (remote sandbox execution request)
- task_status (streamed progress)
- ui_state (small updates: volume, network, "thinking", etc.)

## OTA Updates (How We Ship Device Firmware)

We should treat OTA as a first-class requirement for microClaw.

ESP-IDF OTA model (high-level):
- Partition table needs at least two OTA app slots (e.g. `ota_0`, `ota_1`) plus an OTA data partition.
- OTA writes the new image to the inactive slot, then updates OTA data to boot that slot next reboot.

Rust-friendly wrapper:
- `esp-idf-svc` provides `EspOta` / `EspOtaUpdate` and documents the "write -> complete -> reboot -> mark valid" flow.

Host responsibilities for OTA:
- host serves signed firmware images and a manifest (version, sha256, size)
- device downloads via HTTPS and performs OTA write
- device reports success and marks slot valid only after a health check

## Host Implementation Notes (microClaw host)

Hard requirements:
- persistent device connections (WebSocket)
- streaming endpoints for ASR/TTS
- remote sandbox backend (Docker/Apple Container) for tool execution
- bounded queues/buffers and timeouts (to avoid host-side DoS from buggy devices)

Security defaults:
- mTLS or device tokens (rotateable, short-lived where possible)
- strict egress allowlist on the host sandbox backend
- audio and prompt logs are redacted/disabled by default

## Measurable "Fast" (What We Track)

On LAN, target these metrics:
- device -> host RTT (ping): p50/p95
- wake word -> first partial transcript
- wake word -> first audible TTS
- sustained audio stream under packet loss (glitch rate)

We should bake these into a simple benchmark harness early.

## References

- [ESP-IDF Wi-Fi performance/power save (ESP32-S3)](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-guides/wifi-driver/wifi-performance-and-power-save.html)
- [ESP-IDF WebSocket client docs (example)](https://docs.espressif.com/projects/esp-idf/en/v4.4.1/esp32/api-reference/protocols/esp_websocket_client.html)
- [esp_websocket_client component registry](https://components.espressif.com/components/espressif/esp_websocket_client)
- [esp-idf-svc crate](https://docs.esp-rs.org/esp-idf-svc/esp_idf_svc/)
- [esp-idf-svc MQTT client docs](https://docs.esp-rs.org/esp-idf-svc/esp_idf_svc/mqtt/client/struct.EspMqttClient.html)
- [esp-idf-svc MQTT config](https://docs.esp-rs.org/esp-idf-svc/esp_idf_svc/mqtt/client/struct.MqttClientConfiguration.html)
- [ESP-IDF OTA docs (stable)](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/ota.html)
- [esp-idf-svc OTA module](https://docs.esp-rs.org/esp-idf-svc/esp_idf_svc/ota/index.html)
