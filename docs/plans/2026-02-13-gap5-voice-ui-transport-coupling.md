# NanoClaw Gap Remediation Sub-Plan #5: Voice/Audio, UI, and Transport Coupling

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the audio/voice-resource gap by making voice state authoritative across capture/ASR/TTS, transport, and UI, with bounded buffering, explicit backpressure, and deterministic fallback behavior when voice fails.

**Architecture:** Keep voice runtime in the device, keep heavy inference and tool orchestration on host/service gateways, and enforce one source of truth for voice session state. Transport carries both control and binary audio state transitions through typed envelopes.

**Tech Stack:** Rust + `tokio` on host, `embassy`/`esp-idf-svc` tasks on device, ring-buffered PCM paths, CBOR/JSON control framing, and shared protocol types in `microclaw-protocol`.

## Module Boundaries

### Shared Protocol
- `crates/microclaw-protocol/src/lib.rs`
- Add `VoiceEvent`, `VoiceCommand`, `VoiceError`, `AudioFrame`, and sequence/`session_id`-aware envelopes.
- Keep transport control schema stable and explicitly versioned (`voice_version` field).

### Device Voice Subsystem
- `apps/microclaw-device/src/voice/mod.rs`
- `apps/microclaw-device/src/voice/state.rs`
- `apps/microclaw-device/src/voice/pcm.rs`
- `apps/microclaw-device/src/voice/buffering.rs`
- `apps/microclaw-device/src/voice/gateway_client.rs`
- `apps/microclaw-device/src/voice/fallback.rs`
- `apps/microclaw-device/src/voice/modes.rs`

#### Voice domain boundary
- Single authoritative state machine in `state.rs`.
- `pcm.rs` owns capture/playback ring buffers and codec constants.
- `buffering.rs` owns bounded queue policy (drop-oldest/priority drop, overflow counters, underrun counters).
- `gateway_client.rs` owns ASR/TTS RPC lifecycle and transport retries.
- `fallback.rs` defines policy for degraded modes.

### Device UI Coupling
- `apps/microclaw-device/src/ui.rs`
- `apps/microclaw-device/src/ui/scene.rs`
- `apps/microclaw-device/src/ui/events.rs`
- Add a `VoiceUiBinding` adapter that maps `VoiceState` to UI scene and action affordances (mute, active speech, retry, fail banner).

### Device Transport Bridge
- `apps/microclaw-device/src/transport.rs`
- `apps/microclaw-device/src/transport/frame_codec.rs`
- Keep transport command channel and media channel separate with distinct bounded queues.
- Transport sends state snapshots and accepts host commands to force voice mode transitions (mute, kill_stream, prefer_local_tts).

### Host Gateway (where ASR/TTS and task orchestration currently run)
- `crates/microclaw-sandbox` or new `apps/microclaw-voice-gateway` adapter module
- `apps/microclaw-host` orchestration path if present in current branch
- Add explicit voice gateway endpoints:
  - `POST /voice/asr/stream`
  - `POST /voice/tts/stream`
  - `DELETE /voice/stream/:id`
- Add audit and metrics for voice stream lifecycle.

### Operational Safety Layer
- Add `apps/microclaw-device/src/health.rs` (optional)
- Track heartbeat, stream age, CPU budget breaches, heap usage deltas, and buffer watermarks.
- Enforce feature flags:
  - `voice_remote_asr`
  - `voice_remote_tts`
  - `voice_local_fallback`

## Milestones

### Milestone 1 — State and protocol contract
1. Extend protocol with voice-oriented envelope types and typed stream lifecycle events.
2. Introduce explicit command/state parity on both device and host pathways.
3. Add transport metadata for queue pressure (`pcm_in_queue`, `asr_inflight`, `tts_pending`, `reason`).

Acceptance:
- A `Started` state emits a matching host ack and device state transition within one frame.
- Unknown voice event ids are rejected and logged with `reason`.

### Milestone 2 — Bounded audio pipelines with explicit overflow behavior
1. Build bounded capture/playback ring buffers for PCM16@16 kHz.
2. Define hard caps:
  - input queue depth: 100 PCM frames
  - output queue depth: 80 PCM frames
  - ASR in-flight chunks: max 2 MB (compressed or raw windowed aggregate)
3. Implement drop policy:
  - normal mode: drop oldest oldest for input frames.
  - critical mode: reject new capture if output stall > timeout and raise local alert.

Acceptance:
- Overflow increments a typed metric and triggers `VoiceState::BufferPressure`.
- After injected overflow, device continues, no panic.
- No allocator growth above defined frame budget in a 60s synthetic stress run.

### Milestone 3 — UI integration and deterministic state visibility
1. Add `VoiceUiState` subscription in UI event bus.
2. Bind every voice state transition to a scene and control button state:
  - `Listening`, `Transcribing`, `Speaking`, `Failing`, `Fallback`.
3. UI indicates network/state degradation with explicit action path (`Retry`, `Local fallback`, `Mute`) and disables conflicting actions.

Acceptance:
- For each state transition in protocol fixtures, the corresponding scene updates in <=100 ms.
- No control input is applied when a stream is in `Cancelling` or `Failed` transitions.

### Milestone 4 — Transport coupling, retries, and dead stream recovery
1. Split transport lanes:
  - control lane: control envelopes.
  - media lane: PCM chunk frames and TTS frames.
2. Add heartbeat + stream lease tokens.
3. Detect half-open conditions:
  - no host ack for `N=5` control frames.
  - missing TTS chunk for `3 * expected_chunk_interval_ms`.
4. On stream failure, transition to recovery path:
  - send `stream_error`
  - stop capture/playback
  - expose `FallbackCandidate`.

Acceptance:
- Transport flap for 30% packet loss does not drop UI state updates.
- Recovery does not replay stale frames after reconnect.

### Milestone 5 — CPU/memory contention controls and fallback behavior
1. Introduce resource budget monitor in device runtime:
   - max heap reserve for audio tasks
   - max stack high-water for audio/UI tasks
   - max CPU duty-cycle for audio path
2. Add adaptive quality gates:
   - disable UI full redraw if backlog > threshold.
   - reduce wake word polling duty in active backlog events.
3. Define fallback policy by failure class:
   - ASR timeout -> local command grammar (off-device model unavailable message + PTT mode).
   - TTS transport failure -> text-first reply + muted beep + optional local Pico fallback.
   - repeated stream errors -> local "offline queue" mode (capture last utterance once; defer send).

Acceptance:
- Under CPU pressure, device does not drop capture buffer silently; it degrades gracefully.
- Explicit fallback path is always observable in UI and protocol.
- At 85% buffer pressure or 2 CPU breaches, voice tasks self-throttle instead of OOMing.

### Milestone 6 — End-to-end reliability validation
1. Integration harness:
   - fake transport with injected stalls
   - fake ASR/TTS returning malformed or slow chunks
   - UI event probe assertions
2. Soak test:
   - 30 min continuous wake/tts loop with bursty network loss
   - 2 MB max queue memory envelope
3. Regression matrix:
   - wake -> asr_error -> fallback -> local response path
   - asr success -> tts_error -> local TTS/text path
   - transport reconnect mid-utterance

Acceptance:
- 95%+ successful interaction completion on degraded network script.
- No unbounded queue growth in any test.
- `stream_error` recovery path is covered by contract tests.

## Acceptance Test Plan (Concrete)

### Unit
- Add protocol tests:
  - `crates/microclaw-protocol/tests/voice_frames.rs`
  - Roundtrip encode/decode for all `VoiceEvent` variants.
  - Reject malformed payloads and stale sequence ids.
- Add device buffering tests:
  - `apps/microclaw-device/tests/voice_buffering.rs`
  - Overflow behavior: newest-drop vs oldest-drop correctness for both input and output lanes.
  - Backpressure flags assert deterministic transitions.
- Add UI binding tests:
  - `apps/microclaw-device/tests/voice_ui_state.rs`
  - Voice state drives expected scenes and action enablement.

### Integration
- Add host transport tests:
  - `apps/microclaw-device/tests/voice_transport.rs`
  - Stalled stream -> recovery event -> rebind state.
- Add service-level gateway contract tests:
  - `apps/microclaw-*/tests/voice_gateway_contract.rs`
  - Endpoint timeout, malformed chunk, and cancel semantics.

### End-to-end
- Add script-driven harness in repo `scripts/voice-harness.sh`:
  - 60-second script with injected latency and loss
  - transcript latency and tts completion metrics exported as JSON
- Acceptance thresholds:
  - 95th percentile wake-to-first-partial under 1.5s on LAN.
- Add memory test:
  - synthetic 10-minute loop with max audio load.
  - assert no growth above 5% in retained heap after GC/allocator watermarks.

## Milestone Order

1. Milestone 1
2. Milestone 2
3. Milestone 3
4. Milestone 4
5. Milestone 5
6. Milestone 6
