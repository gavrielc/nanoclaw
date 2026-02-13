# MicroClaw Gap Remediation Master Plan (Device + Host)

Date: 2026-02-13

Scope: close the remaining gaps across UI/touch, transport coupling, reliability/security, and voice/resource integration so `feature/microclaw-device-baseline` can move from placeholder to production-lean firmware.

## Why this was created

You asked for a fuller close-the-gap plan that covers:
- Display/touch gaps
- Transport/UI contract gaps
- Reliability/security/ops gaps
- Voice/audio coupling and resource pressure behavior
- Validation and HIL/SoC coverage gaps

This document coordinates those domains as parallel workstreams.

## Source artifacts

- `docs/plans/2026-02-13-microclaw-device-display-touch-plan.md`
- `docs/plans/2026-02-13-microclaw-device-ui-mockups.md`
- `docs/plans/2026-02-13-gap3-reliability-security-operations.md`
- `docs/plans/2026-02-13-gap5-voice-ui-transport-coupling.md`
- `docs/plans/2026-02-13-microclaw-device-baseline-implementation-plan.md`

## Uncovered gap inventory

1. **Core display/touch runtime is still missing**
   - No ST77916/CST816 integration in firmware
   - No deterministic input event model
   - No clipping/hit-testing for round viewport
2. **Transport/UI contracts are not end-to-end implemented**
   - Commands and state deltas are not fully typed, sequenced, and reconciled
   - UI and host state may diverge on reconnect/recovery
3. **Reliability/security/operations not hardened enough for shipping**
   - Boot-loop handling, rollback safety, and secret handling are partial/planning-only
   - OTA signing and egress policy are not production-closed
4. **Audio/voice path not coupled to UI and transport lifecycle**
   - Buffer pressure, stream recovery, and fallback behavior are not implemented
   - UI state does not yet reflect audio session integrity/state pressure
5. **Validation and test coverage gaps**
   - Limited host-unit-only and no comprehensive HIL/SoC stress paths for device UI+tch+transport

---

## Workstreams and owners

### Workstream A — Display/Touch/GUI
**Goal:** replace placeholders with deterministic, bounded UI + touch runtime.

**Lead scope**
- `apps/microclaw-device/src/display*`
- `apps/microclaw-device/src/touch*`
- `apps/microclaw-device/src/ui*`
- `docs/plans/2026-02-13-microclaw-device-ui-mockups.md`

**Core acceptance criteria**
- Panel boots + shows first-screen in bounded time
- Touch interrupt-based event path
- Round-viewport hit-testing and calibrate/recalibrate support
- Stable transitions between states with bounded redraw budget

### Workstream B — Transport/UI Contract
**Goal:** make host-device state authoritative and deterministic.

**Lead scope**
- `crates/microclaw-protocol` message types
- `apps/microclaw-device/src/transport*`
- Host transport handlers in crates host path

**Core acceptance criteria**
- All commands carry `v`, `seq`, `message_id`, `corr_id`, anti-dup checks
- Host/Device recover safely on missed/dropped frames
- No local action without command ack for acknowledged operations

### Workstream C — Reliability/Security/Recovery (R/O)
**Goal:** prevent silent failure, unsafe recovery, and unauthorized command paths.

**Lead scope**
- `apps/microclaw-device` startup + watchdog + reset logic
- Host and gateway auth/policy stack
- OTA update path and trust checks

**Core acceptance criteria**
- No reboot loops >3 attempts without safe-mode transition
- OTA fails closed (bad signature/hash fails)
- Transport uses explicit TLS policy and anti-replay checks
- Provisioning reset + factory reset workflows deterministic

### Workstream D — Voice/Audio Integration
**Goal:** keep voice sessions bounded, recoverable, and UI-authoritative.

**Lead scope**
- `apps/microclaw-device/src/voice*`
- Host gateway ASR/TTS endpoint behavior
- UI state binding to `Listening / Transcribing / Speaking / Fallback / Failed`

**Core acceptance criteria**
- Input/output buffer watermarks never exceed budget
- Packet loss and reconnect preserves stream-state consistency
- Fallback path always surfaced in UI and command telemetry

### Workstream E — Validation/QA Harness
**Goal:** stop discovering regressions only in HIL/SoC only.

**Lead scope**
- `apps/microclaw-device/tests`
- New host-device simulators
- GitHub Actions workflows (`validation-qa`, `hil`, `soc-stress`)

**Core acceptance criteria**
- Automated unit + simulation matrix for transport/state/input/OTA/recovery
- At least one recurring HIL weekly run and soak metrics captured
- SoC stress runs enforce no memory/queue drift and no panic

---

## Prioritized execution plan (parallelized)

### Sprint 1 (2 weeks) — Foundation and safety nets

1. Add protocol envelope hardening (Workstream B)
   - typed frame types and sequence handling
   - duplicate/replay rejection
   - command/result/error lifecycle
2. Add display/touch skeleton + abstraction layer (Workstream A)
   - interface traits + host-only fake impl
   - compile-time parity across host/esp
3. Add boot-loop guard + watchdog markers (Workstream C)
   - boot attempt counters
   - safe-mode switch + diagnostics marker
4. Add validation harness scaffolding (Workstream E)
   - baseline tests for message parsing/state reconciliation

**Exit criteria for Sprint 1**
- Device can boot to known status scene in host-compile and real flash path
- Hard-coded placeholder branches replaced by dispatchable interfaces
- At least one replay-safe test suite green

### Sprint 2 (2 weeks) — Primary functionality

1. Implement ST77916/CST816S driver bring-up + event queue (Workstream A)
2. Implement transport command lifecycle + scene reducer (Workstream B)
3. Implement OTA manifest validation skeleton + signed-check plumbing (Workstream C)
4. Implement bounded audio pipeline + voice states + fallback enums (Workstream D)
5. Add offline/online state transitions and recovery assertions (E)

**Exit criteria for Sprint 2**
- Touch + transport loop works with a fake host
- Device remains operable during simulated reconnects
- OTA bad image simulation rolls back cleanly

### Sprint 3 (2 weeks) — Hardening + production prep

1. Add calibration persistence + round-screen hit testing + gesture/noise filtering (A)
2. Add anti-replay, cert pinning, scope checks, and denial telemetry (C)
3. Add media/control transport lane split and stream recovery (D)
4. Add command-level audit and security regression tests (C)
5. Add HIL suite for touch, transport, boot-loop, OTA fail paths (E)

**Exit criteria for Sprint 3**
- No unbounded queue growth in 12h mock stress
- Security posture enforced by default (deny-by-default)
- At least 3 major HIL scenarios pass consistently

### Sprint 4 (1-2 weeks) — Integration stabilization

1. Close remaining UX gaps from mockups
2. Implement host-side diagnostics and reset/provisioning workflows
3. SoC 24h soak pass with telemetry thresholds
4. finalize go/no-go criteria

**Exit criteria for Sprint 4**
- End-to-end demo mode and real command flow pass
- Recovery behavior is documented and test-covered
- No blocker gaps in master list

---

## Dependency graph (short)

- B and C are prerequisites for finalizing A/D interactions because state and auth must be stable before production actioning.
- A can run in parallel with B/C but scene rendering should consume only stable `state` outputs.
- D depends on B transport guarantees and B and A for visible state.
- E must be integrated continuously and is the gating layer for release.

## Acceptance matrix

- **Functional:** scenes + touch + basic commands all work on real device
- **Reliability:** no uncontrolled restarts, bounded recovery windows
- **Security:** TLS + host authentication + anti-replay + allowlisting + auditing
- **Performance:** stable memory/heap under stress
- **Quality:** deterministic state, bounded queues, reproducible tests

## Open issues / likely blockers

- GPIO10/11 I2C contention with IMU/RTC and potential bus arbitration
- CST816 init/read quirks on variant hardware
- QSPI timing differences by board revision
- OTA path may need partition/bootloader updates before runtime validation
- Full desktop-style GUI stacks are likely too heavy; Slint or lightweight renderer strategy should win on first iteration

## Decision log (to be updated during execution)

- Day 0: confirm driver stack choice (Slint vs minimal embeddable renderer)
- Day 7: confirm transport envelope + anti-replay schema freeze
- Day 14: confirm OTA rollback/health policy and safe-mode policy
- Day 21: confirm voice fallback policy and queue budget
- Day 28: go/no-go for HIL stress acceptance

---

## Next concrete change set (from this plan)

1. Update `docs/GUI.md` and baseline plan links (already done)
2. Keep `docs/plans/2026-02-13-microclaw-device-display-touch-plan.md` and `docs/plans/2026-02-13-microclaw-device-ui-mockups.md` as implementation artifacts
3. Implement Sprint 1 work in code next, in this order:
   - `crates/microclaw-protocol` schema
   - `apps/microclaw-device` runtime modules
   - `apps/microclaw-device` watchdog + boot markers
   - `apps/microclaw-device`/tests + `scripts/*` harness entries
