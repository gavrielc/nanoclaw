# NanoClaw Gap Remediation Sub-Plan #3: Reliability/Security Operations

**Goal:** Close the operational security gap by hardening startup recovery, OTA/update lifecycle, boot-loop protection, provisioning/reset safety, end-to-end transport security, and host/device trust boundaries before final productionization.

**Scope:** Applies to both legacy Node host (`src/*`) and Rust port (`apps/microclaw-device`, `crates/*`) where the same control and auth contracts are required. Host and device behavior should converge on this plan.

## 1) Watchdog + Recovery Loop

### Checklist
1. Add process-level supervision
   - Host:
     - Add a supervisory layer in host startup that tracks container/back-end child health, heartbeat deadlines, and queue lag.
     - Record all process terminations and abnormal exits with reason codes and task metadata.
   - Device:
     - Add explicit reboot-watch and panic markers in `apps/microclaw-device/src/main.rs` with startup reason logging.
2. Split watchdog responsibilities by domain
   - Container runner: separate hard timeout and graceful shutdown window, with a retry budget.
   - Host event loop: recover from transient failures without dropping pending per-group work.
   - Gateway link: auto-reconnect with exponential backoff and bounded retry attempts.
3. Add bounded self-healing queues
   - Host: bounded requeue buffer for in-flight messages with per-group backoff.
   - Device: bounded outbound queue for control/audit events while transport is unavailable.
4. Add restart recovery contract tests
   - Simulate process crash during tool execution and verify checkpointed work resumes exactly-once.
   - Simulate container panic path and assert cleanup + reschedule semantics.

### Acceptance
- Recovery from any single runner/container failure occurs within 60s and does not lose acknowledged in-flight tasks.
- Host and device restart logs contain structured cause markers (watchdog, panic, OOM, timeout).
- No unbounded queue growth during sustained link failures (memory cap enforces drops by oldest-item policy with explicit `DroppedEvent` metric).

## 2) OTA + Rollback

### Checklist
1. Define immutable release artifact metadata
   - Add manifest fields: semver, image sha256, build id, minimum host/device compatibility, migration flags.
2. Add staged activation model
   - Build OTA package flow for device updates:
     - write image to inactive slot
     - atomically switch boot target
     - run health check
     - only then mark image valid
3. Add rollback triggers
   - Automatic rollback when health check fails, heartbeat drops, or fatal startup marker observed.
   - Guard against silent invalidation by requiring signed success handshake before finalize.
4. Add host rollback and freeze controls
   - Host command `ota_pause`, `ota_force_rollback`, and `ota_clear_pending`.
5. Add signing chain
   - Add release signature verification before accepting OTA payload (embedded image + manifest).

### Acceptance
- 100% rollback on injected bad image during staged update in lab scenario.
- No successful boot if manifest signature or hash mismatch.
- OTA success path reports `ota_state=active,health=passed` and finalizes no earlier than after `N` successful health beacons (minimum N=1 for first phase, configurable to 3+ later).
- Manual rollback always completes <90s after command acknowledgement.

## 3) Boot-Loop Guard

### Checklist
1. Add persistent reboot counters
   - Store boot-attempt metadata by `boot_epoch`, `boot_stage`, `last_error`, `consecutive_fails`.
2. Add staged backoff policy
   - 1st failure: immediate retry
   - 2nd-3rd: fixed short backoff (30s)
   - sustained failures >3 within 10 minutes: enter safe mode
3. Add safe mode
   - Disable risky optional capabilities: remote task execution, network tools, auto-start scheduler, aggressive polling.
   - Keep only control channel + health telemetry alive.
4. Add escape hatch
   - Explicit host command + local button / CLI flag to clear boot-loop state after remediation.

### Acceptance
- No hard reboot loop longer than 3 continuous restarts without transition to safe mode.
- In safe mode, host/device sends a structured diagnostic with root cause and recovery hint.
- Clearing boot-loop marker allows normal mode resume on next successful boot.

## 4) Provisioning + Reset Flows

### Checklist
1. Device provisioning flow
   - Provisioning challenge from host (short-lived token or QR/one-time code).
   - Optional certificate signing request and provisioning record persisted in secure storage.
2. Runtime secret bootstrap
   - Provision credentials only into secure storage abstraction (never plaintext file in runtime containers).
   - Never reuse long-lived cloud secrets in firmware.
3. Config reset and factory reset
   - Add explicit `provision.reset` command:
     - revoke device cert/session
     - clear non-essential state
     - keep immutable identity pair and telemetry consent policy
   - Add `factory_reset` command with explicit warning path and two-step confirmation.
4. Recovery of partially provisioned state
   - Detect stale provisioning artifacts and allow re-provisioning with bounded cleanup.

### Acceptance
- End-to-end provision: unprovisioned device can join, authenticate, and appear in host registry within 2 minutes.
- Provisioning reset fully removes host trust artifacts for that device in one operation.
- Factory reset removes all user state and returns device to unpaired bootstrap state.
- Secrets remain inaccessible in logs, core dumps, and mounted containers.

## 5) Cert and E2E Security

### Checklist
1. Transport security baseline
   - Enforce TLS + cert verification on all host-device links.
   - Add cert pinning mode for production endpoints.
2. Device-host identity model
   - Device presents device cert; host validates cert + revocation status.
   - Host issues short-lived command/session token after hello handshake.
3. Envelope hardening
   - Extend `crates/microclaw-protocol` to include:
     - `seq`, `ttl_ms`, `issued_at`, `command_id`, `signature`, `nonce`
     - anti-replay checks in host and device
4. End-to-end encryption decision boundary
   - Keep sensitive payload fields opaque at transport layer where possible (or wrap with authenticated encryption if feasible).
5. Key lifecycle
   - Rotation process for device certs and host API keys.
   - Revocation list sync path and on-device CRL or local allowlist updates.

### Acceptance
- Handshake fails on untrusted CA / invalid hostname / wrong cert pin.
- Replay attempts with reused `command_id`/`nonce` are rejected.
- Certificate expiration and revocation tested in simulated deployment with expected disconnect and re-provision path.
- No plaintext credential material or bearer tokens transmitted outside TLS tunnel in logs.

## 6) Host/Device Auth Boundaries

### Checklist
1. Separate authority planes
   - Host: policy engine, queue scheduler, and state store are source of truth.
   - Device: local execution shell, UI/audio, and transport endpoint.
2. Scoped capabilities
   - Device command envelope includes least-privilege token type (`read-status`, `ack`, `command`, `reset`, `ota`).
   - Host enforces capability matrix on every inbound command.
3. Mutual session state
   - Store and validate `last_seen_seq`, `last_seen_msg`, and `agent_state_generation` on each direction.
4. Audit boundaries
   - Append every auth decision (allow/deny) with actor, command, scope, and reason.
   - Ship a daily signed audit snapshot from device and host.
5. Contract tests
   - Add tests for privilege escalation attempts, command confusion attacks, and token-scoped operation denial.

### Acceptance
- Devices cannot invoke host-only operations (provision/deprovision/rollback) without explicit permission.
- Host rejects all commands lacking required scope; deny events are non-retriable unless token/class is updated.
- 100% of auth decisions are logged and queryable with filterable actor and reason.

## Delivery Checklist (Minimum Viable Sequence)

1. Implement boot-loop guard + watchdog first to stabilize recovery.
2. Add protocol/auth envelope and audit events.
3. Add provisioning/reset and secret bootstrap on both host and device.
4. Add OTA staging + signed rollback path.
5. Enforce TLS/mTLS + cert pinning and anti-replay.
6. Run full security/reliability regression matrix and close gaps.

## Required Verification Matrix

- Unit tests: `crates/*` recovery/sandbox/protocol/store boundaries.
- Integration tests:
  - host<->device transport handshake
  - OTA bad image rollback
  - provisioning reset and re-provision
  - boot-loop and safe-mode entry transitions
- Soak:
  - 72h power-cycle and network-flap test with bounded memory and no leaks.
- Security regression:
  - replay attack
  - cert mismatch
  - unauthorized host command
  - unauthorized device command
