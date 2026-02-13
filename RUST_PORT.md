# NanoClaw Rust Port Plan (Embedded-First)

This is the canonical Rust-first migration plan for NanoClaw.

Related docs:
- `docs/SPEC.md` (current system specification)
- `docs/SECURITY.md` (current security model and known gaps)
- `docs/TARGET_DEVICE.md` (Waveshare ESP32-S3 target hardware + constraints)
- `docs/VOICE.md` (voice on ESP32-S3: on-device wake/commands + remote ASR/TTS)
- `docs/GUI.md` (GUI on ESP32-S3: framework options + flashing notes)
- `docs/MICROCLAW_HOSTING.md` (hosting + transport for the ESP32-S3 "microClaw" device)
- `docs/HAL_EVAL_PLAN.md` (HAL harness plan for agent evaluation and tuning)

## Audit Snapshot (verified 2026-02-12)

Commands executed in this workspace:
- `npm ci`
- `npm run typecheck`
- `npm run build`
- `npm test`
- `npm run format:check`

Observed results:
- Typecheck: passes.
- Build: passes.
- Tests: 4/7 suites pass (91 tests pass). 3 suites fail before executing tests due to `Failed to resolve entry for package "fs"` in Vitest.
- CI uses Node 20 (`.github/workflows/test.yml`). Local run used Node 24.1.0. The Vitest failure appears runtime/version sensitive.
- Formatting: `npm run format:check` fails on 15 files.

System summary:
- Single-process Node/TypeScript host.
- WhatsApp ingestion via `@whiskeysockets/baileys`.
- SQLite state via `better-sqlite3`.
- Agent runs in isolated containers (Apple Container by default on macOS, or Docker via `CONTAINER_BACKEND`) with file-based IPC.
- Per-group serialization plus global concurrency limit.

Core modules (TypeScript host):
- `src/index.ts`: orchestrator loops + startup
- `src/channels/whatsapp.ts`: WhatsApp I/O and metadata sync
- `src/container-runner.ts`: container lifecycle + mounts + output parsing
- `src/group-queue.ts`: per-group queue and global concurrency limits
- `src/ipc.ts`: tool IPC authorization and task operations
- `src/task-scheduler.ts`: due-task dispatch
- `src/db.ts`: SQLite schema and state access

Embedded readiness indicators (approx):
- `node_modules`: ~144 MB
- compiled host `dist`: ~580 KB
- TypeScript source (`src` + container runner): ~7k LOC

## Current Gaps / Mismatches (as of 2026-02-12)

Test runner environment sensitivity:
- `npm test` failures observed depending on Node version (CI Node 20; local failures observed on newer runtime).

Cold start overhead:
- `container/Dockerfile` recompiles TypeScript on every invocation (`npx tsc --outDir /tmp/dist`).
- This is expensive and is a hard non-starter for small devices.

Credential exposure tradeoff:
- Auth env vars are filtered but written to a mounted file (`/workspace/env-dir/env`).
- In-container agent code can read these credentials, so the sandbox boundary does not protect secrets from the agent itself.

Network egress:
- Outbound network is unrestricted by default for the sandbox.
- For hostile prompt contexts, this is an avoidable exfil path.

Docker parity and ops:
- Docker backend exists (`CONTAINER_BACKEND=docker`) and is documented in `README.md`.
- The container image build script (`container/build.sh`) is Apple Container oriented; Docker builds should be treated as a first-class, tested path.

## Port Goals (Rust-First, Embedded-Oriented)

Primary objective:
- Replace the Node/TypeScript host with an on-device Rust host (ESP32-S3) that enforces policy/queueing/scheduling under hard bounds and uses security-first defaults.

Non-goals during parity phases:
- New channel/platform expansion.
- Major user-facing behavior changes.
- Large framework-scale architecture growth.

Security posture:
- Default deny where possible.
- Make insecure states hard or impossible to enable accidentally.

## Target Deployment (Baseline)

The primary embedded target hardware for this plan is:
- Waveshare ESP32-S3 Touch LCD 1.85C (1.85" round 360x360) with the Smart Speaker Box variant.

See `docs/TARGET_DEVICE.md` for the verified spec and constraints (notably: no on-device Linux containers, no POSIX process model, tight RAM/flash budgets, flash wear considerations, and intermittent Wi-Fi).

Implications:
- The host must run on-device without relying on Apple Container/Docker.
- Default execution should be on-device and capability-limited (no arbitrary Bash).
- Remote sandbox execution (Apple Container/Docker) is optional for workloads that cannot be done safely on-device (example: full browser automation).
- `local_wasm` is a future on-device sandbox option to run small, capability-limited modules without reflashing.

## On-Device Maximization (What Runs Where)

Goal: Everything runs on-device except what is physically or practically impossible on ESP32-S3.

Expected off-device dependencies:
- WhatsApp connectivity requires a gateway (the current WhatsApp stack is Node-based via Baileys).
- LLM inference is expected to be remote (API) for anything beyond tiny on-device classification.

Optional off-device components:
- Remote sandbox runner for heavyweight or high-risk tools (containers), behind an explicit feature flag.

On-device baseline responsibilities:
- Policy and authorization (deny-by-default).
- Scheduling and queueing (hard-bounded).
- Persistent state and memory management under flash-wear constraints.
- Network egress enforcement (deny-by-default + allowlist).
- Agent orchestration loop runs on-device; remote LLM is used only for inference (device remains source of truth for state).
- Tool execution for a small, explicitly supported toolset (HTTP fetch, storage, UI/voice, sensors).

## On-Device Feasibility Notes (Sourced)

Hardware baseline references:
- Waveshare board wiki: https://www.waveshare.com/wiki/ESP32-S3-Touch-LCD-1.85C
- ESP32-S3 datasheet (Espressif): https://www.espressif.com/sites/default/files/documentation/esp32-s3_datasheet_en.pdf

Rust on ESP-IDF (pragmatic for Wi-Fi/TLS/filesystems):
- esp-rs book: https://docs.esp-rs.org/book/
- esp-idf-hal: https://github.com/esp-rs/esp-idf-hal

Device security primitives we should assume and leverage:
- ESP-IDF secure boot: https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/security/secure-boot-v2.html
- ESP-IDF flash encryption: https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/security/flash-encryption.html
- ESP-IDF NVS (key-value storage in flash): https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/storage/nvs_flash.html

`local_wasm` (future) runtime candidates:
- WAMR (wasm-micro-runtime): https://github.com/bytecodealliance/wasm-micro-runtime
- Espressif WAMR component (ESP-IDF): https://components.espressif.com/components/espressif/wasm-micro-runtime
- wasm3: https://github.com/wasm3/wasm3

On-device ML that can reduce remote LLM calls (optional):
- ESP-DL (Espressif): https://github.com/espressif/esp-dl
- TensorFlow Lite for Microcontrollers: https://www.tensorflow.org/lite/microcontrollers
- TFLM micro_speech example: https://github.com/tensorflow/tflite-micro/tree/main/tensorflow/lite/micro/examples/micro_speech

On-device LLM reality check (experimental):
- Tiny LLM demo on ESP32-S3 (demo-scale model, 260k parameters): https://github.com/DaveBben/esp32-llm

WhatsApp gateway reality check:
- Baileys (WhatsApp Web API for Node.js): https://github.com/WhiskeySockets/Baileys
- WhatsApp Business platform restrictions on general-purpose AI chatbots (reported, effective 2026-01-15); treat Cloud API as potentially non-viable for NanoClaw-like assistants: https://techcrunch.com/2025/01/06/meta-is-banning-general-purpose-ai-chatbots-from-whatsapp/ ; https://www.theverge.com/2025/1/7/24337746/meta-whatsapp-general-purpose-ai-chatbots-business-messaging-ban ; https://www.reuters.com/business/media-telecom/meta-plans-stop-allowing-ai-chatbots-whatsapp-business-platform-2025-01-07/

## Target Principles

- Keep NanoClaw small: avoid platform sprawl.
- Prefer static binaries and minimal runtime dependencies.
- Preserve strict isolation boundaries and explicit mount policy.
- Add backpressure everywhere (bounded queues, bounded output buffers).
- Measure before and after: parity first, optimization second.

## Migration Strategy (Pragmatic Phases)

Reference considered:
- [IronClaw](https://github.com/nearai/ironclaw) as pattern input, not as a drop-in architecture.

Phase 0: Freeze behavior with contract tests (before rewrite)
- Add black-box tests around current host behavior: routing, trigger semantics, queue ordering, scheduler semantics, IPC auth rules, DB state transitions.
- Add fixtures and a replay harness (recorded message/task timeline) to compare TS vs Rust outputs.

Phase 1: Port core domain + store (Rust libraries first)
- Implement `nanoclaw-core` (domain/policy) and `nanoclaw-store` (persistence).
- Validate against an existing DB with fixture-driven parity checks.

Phase 2: Implement on-device host skeleton (ESP-IDF)
- Implement an on-device binary with scheduler timers, per-group queueing with hard bounds, and persistence under flash-wear-aware constraints.
- Do not attempt to run the current in-container Claude Code runner on-device.

Phase 3: WhatsApp gateway (thin bridge to the device host)
- The current WhatsApp integration (`@whiskeysockets/baileys`) is Node-based and not viable on ESP32-S3.
- Implement a minimal gateway process that forwards WhatsApp events to the device and sends outbound messages on behalf of the device.
- Keep the gateway as dumb as possible (transport + retries); the device host is the source of truth for state and policy.

Phase 4: Replace container sandbox with execution backends
- Introduce an execution backend abstraction (see `nanoclaw-sandbox` below).
- Default backend: on-device capability-limited tool broker (no arbitrary Bash).
- Future option: local WASM sandbox on-device (`local_wasm`) with capability-limited host calls.
- Optional parity backend: remote sandbox runner (Apple Container/Docker) for heavyweight tools.

Phase 5: Harden security model (default-on)
- Add egress allowlist/proxy support (default deny).
- Move credentials to brokered injection (never filesystem-visible inside sandbox by default).
- Add structured audit logs for policy decisions and denied operations.

Phase 6: Embedded optimization + cutover
- Tighten timeouts/concurrency defaults and bound buffers.
- Run benchmarks and a 24h soak test on target hardware.
- Declare the on-device Rust host as the primary implementation.

## Phase Gates and Verification Commands

End-state goals for the overall port:
- An on-device Rust host can enforce policy/queueing/scheduling under ESP32-S3 resource bounds.
- End-to-end message flow works through the WhatsApp gateway (or an equivalent bridge) with deterministic per-group ordering.
- Secrets are not filesystem-visible inside the sandbox by default.
- Outbound network is deny-by-default, with explicit allowlisting/proxy support.
- Embedded benchmarks and soak tests show stability within RAM/flash budgets.

Failure criteria (must not regress during migration):
- IPC authorization must remain deny-by-default (non-main cannot affect other groups).
- Per-group isolation boundaries must remain intact (sessions, mounts, IPC namespaces).
- Task scheduling semantics must remain stable (cron/interval/once next-run computation).
- Output and logs must remain bounded (no unbounded buffer growth).

Suggested per-phase gates (commands are targets to implement and keep green):

Phase 0 gate:
- `npm run typecheck`
- `npm run build`
- `npm test` (contract suite included)

Phase 1 gate:
- `cargo test -p nanoclaw-core`
- `cargo test -p nanoclaw-store`
- `cargo test -p nanoclaw-queue`
- `cargo test -p nanoclaw-scheduler`
- `cargo run -p nanoclaw-store --bin parity-check -- --db <path> --fixtures <path>`

Phase 2 gate:
- Device build: `cargo build -p nanoclaw-device --release` (ESP-IDF toolchain).
- Device smoke: boot-to-ready (Wi-Fi connected + scheduler running) under a test config.

Phase 3 gate:
- Run gateway + device host and pass end-to-end replay harness.

Phase 4 gate:
- Remote sandbox runner backend passes integration tests (if parity mode is enabled).
- On-device tool broker backend passes core contract tests (bounded buffers; no arbitrary Bash).
- Remote runner: no runtime `tsc` in container entrypoint.

Phase 5 gate:
- Secrets cannot be read from within sandbox filesystem by default (negative tests).
- Egress deny-by-default enforced (negative tests).

Phase 6 gate:
- Embedded profile measurements documented on the ESP32-S3 target.
- Soak test on device passes (including Wi-Fi dropouts and reboots).

## Open Decisions (Resolve Early)

DB access strategy:
- `rusqlite` (sync) vs `sqlx` (async). Recommended default for embedded: `rusqlite` plus `tokio::task::spawn_blocking` where needed.

Device persistence strategy:
- On ESP32-S3: decide what state lives in NVS vs SD vs flash FS.
- If SQLite is required on-device, plan to store it on SD and minimize write frequency.

Sandbox enforcement strategy:
- Define the on-device execution boundary as capability-limited tools (no shell, no arbitrary code execution).
- If a remote container runner is supported, define how policy parity is enforced across device and remote.

Local WASM sandbox strategy (future):
- Decide whether to support `local_wasm` on-device execution (no JIT; use an embedded-friendly runtime).
- Treat hostcalls as the security boundary; do not expose raw filesystem/network primitives.
- Enforce per-module memory/time/output caps and fail closed when exceeded.
- Define module loading/signing/update and the hostcall surface (capabilities and limits).

Gateway protocol strategy:
- Define the gateway<->device protocol (auth, replay protection, ordering guarantees, retries).
- Decide whether the gateway buffers when the device is offline, and what the max buffer is.

IPC/watch strategy (desktop only):
- Keep file-based IPC for the legacy container runner and parity harnesses, but replace polling with filesystem notifications where available.

Secrets injection strategy:
- Define how LLM auth is stored on-device (NVS/secure storage) without exposing it to the tool layer.
- If a remote container runner is used, do not place secrets in a readable mounted file inside the sandbox.

Runner packaging:
- Keep TypeScript runner but ship prebuilt artifacts (no `tsc` at runtime), or port runner to Rust once host parity is stable.

## Proposed Rust Crate Layout

- `nanoclaw-core`: domain types, routing, trigger checks, policy rules
- `nanoclaw-store`: persistence traits + implementations (desktop SQLite, device storage)
- `nanoclaw-scheduler`: cron/interval/once task engine
- `nanoclaw-queue`: per-group execution queue + retry/backoff
- `nanoclaw-sandbox`: execution backend abstraction + egress policy + secret broker
- `nanoclaw-bridge-proto`: gateway<->device message protocol types
- `nanoclaw-device`: ESP-IDF on-device host binary
- `nanoclaw-host`: optional desktop host binary (parity harnesses, development)

## Rust Runtime Model (Host)

- `tokio` runtime.
- One per-group actor with a bounded mailbox to preserve deterministic ordering.
- Global semaphore for max concurrent sandboxes.
- Event-driven wakeups when possible (channel events, queue signals) instead of fixed polling loops.
- Bounded log/output capture with explicit truncation markers.

## Sandbox Abstraction (Execution Layer)

Define a Rust trait boundary for sandbox execution:
- Inputs: task request, policy, timeouts, secrets handle.
- Outputs: structured status, bounded stdout/stderr, tool/IPC messages.

Default backend (on-device):
- Capability-limited tool broker (no arbitrary Bash, no arbitrary code execution).

On-device backend (future option):
- Local WASM sandbox (`local_wasm`) for running bounded task logic with capability-limited host calls.

Optional parity backend (off-device):
- Remote container runner using Apple Container or Docker.

Policy responsibilities:
- Enforce mount allowlist and read-only rules (remote backend only).
- Enforce network egress policy (deny-by-default).
- Inject secrets without filesystem exposure in sandbox.
- Enforce timeouts and kill semantics.
- Emit structured audit logs for allows/denies.

## Data and Compatibility Constraints

During parity phases:
- Keep SQLite schema semantics compatible for desktop fixtures and parity harnesses.
- Keep IPC authorization semantics equivalent (main vs non-main).
- Keep per-group isolation semantics equivalent across deployments. Desktop/remote runner uses folders, sessions, mounts, and IPC namespaces; on-device uses per-group namespaces/partitions with explicit capability limits.

## Current Host <-> Runner Contract (Legacy Desktop Container Runner)

This describes the current host<->container protocol. It is useful for parity testing and for an optional remote container backend, but it is not the on-device execution model.

Container stdin JSON (single request per run):
- Schema: `ContainerInput` (see `src/container-runner.ts` and `container/agent-runner/src/index.ts`).
- Fields: `prompt`, optional `sessionId`, `groupFolder`, `chatJid`, `isMain`, optional `isScheduledTask`.

Container stdout JSON (streamed results):
- Each result is emitted between markers: `---NANOCLAW_OUTPUT_START---`, then a JSON line (`ContainerOutput`), then `---NANOCLAW_OUTPUT_END---`.
- Multiple results may be emitted per run (agent teams / streamed outputs).

File-based IPC layout (per-group namespace):
- Host mounts `data/ipc/<groupFolder>` to container as `/workspace/ipc`.
- Container writes outbound messages to `/workspace/ipc/messages/*.json`.
- Container writes task/group operation requests to `/workspace/ipc/tasks/*.json`.
- Host writes follow-up user messages to `/workspace/ipc/input/*.json`.
- Host writes `/workspace/ipc/input/_close` sentinel to request shutdown.
- Host writes `/workspace/ipc/current_tasks.json` snapshot for MCP `list_tasks`.
- Host writes `/workspace/ipc/available_groups.json` snapshot for group registration flows (main group only).

IPC authorization invariant:
- Host derives caller identity from the IPC directory name, not from JSON payload fields.
- Non-main groups can only operate on themselves unless explicitly permitted by the host policy.

## Immediate High-Impact Fixes (Before Any Port)

These reduce risk and improve parity testing even before Rust exists:

1. Fix Vitest compatibility on modern Node (or pin supported runtime explicitly).
2. Remove per-invocation `tsc` compile in container entrypoint.
3. Add a security option for outbound network allowlisting (toward default deny).
4. Replace mounted-secret-file auth with brokered secret injection (no filesystem-visible secrets in sandbox by default).
5. Make Docker backend a fully supported path with explicit tests and build/run docs (not just a best-effort fallback).
6. Define the WhatsApp gateway<->device protocol and threat model (device is source of truth).

## Security Hardening Plan (Rust Default-On)

Credentials:
- Remove secret file mounts from the sandbox by default.
- Use brokered, per-run injection; prefer one-shot tokens over long-lived keys.
- Keep secrets in host memory only; avoid logs/panics containing secrets.
- Add negative tests that attempt in-sandbox credential reads and assert denial.

Egress:
- Default outbound policy is deny.
- Support allowlist by host/domain/IP and port.
- Support explicit proxy mode for all outbound traffic.
- Record audit events for denied egress attempts.
- Make policy overrides explicit, time-bounded, and logged.

Sandbox policy invariants:
- Enforce read-only mounts by default for non-main groups.
- Validate mount paths after symlink resolution.
- Reject relative traversal and ambiguous container target paths.
- Enforce resource limits (time, memory, output size) at the backend level.

## Verification and Benchmark Plan

Functional verification:
- Contract suite covering routing, trigger semantics, queue ordering, scheduler due-task logic, IPC auth matrix.
- Cross-implementation replay harness (TS vs Rust) diffing outputs and DB state.

Security verification:
- Mount traversal and symlink attack tests.
- Credential exfiltration tests from sandbox.
- Egress policy deny/allow tests.
- Fuzzing for IPC command parser and policy evaluator.

Performance benchmark matrix:
- Baselines on Apple Silicon laptop (developer iteration).
- Baselines on the target device: Waveshare ESP32-S3 Touch LCD 1.85C (`docs/TARGET_DEVICE.md`).
- Optional comparative baselines on Linux ARM (example: Raspberry Pi-class) if a remote sandbox backend is used.

Scenarios:
- Boot-to-ready on device (power-on/reset -> Wi-Fi connected + scheduler running).
- Warm task latency.
- Burst dispatch across multiple groups.
- Idle CPU draw.
- 24h soak stability.

Metrics:
- p50/p95/p99 end-to-end task latency.
- CPU time per task.
- Peak heap/stack memory.
- Execution backend startup time (local or remote).
- Throughput under bounded concurrency.
- Denied policy event counts (and false-positive/false-negative rate).

Acceptance criteria (ESP32-S3 embedded Rust milestone):
- Functional parity: contract tests for core policy/queue/scheduler/IPC auth pass (desktop test harness).
- On-device: `nanoclaw-device` runs on the ESP32-S3 target, connects to Wi-Fi, persists a scheduled task, survives reboot, and dispatches via the configured execution backend.
- Security: secrets are not filesystem-visible to untrusted code by default; egress policy is enforced (deny-by-default + explicit allowlist).
- Resource: queues/buffers are bounded by default; peak memory fits within device RAM/PSRAM budgets with headroom.
- Reliability: 24h soak on the target device (including Wi-Fi dropouts and reboots) passes without crash, deadlock, or unbounded growth.

## Performance Tuning Guidance for Constrained Hardware

Build and binary profile:
- Compile with `--release`, `lto = "thin"`, `codegen-units = 1`, `panic = "abort"` (for release profile).
- Prefer `rusqlite` for minimal dependency/runtime overhead unless async DB contention proves material.
- Strip symbols in release artifacts intended for device deployment.

Runtime defaults (embedded profile):
- Reduce global execution-backend concurrency default (example: `max_concurrent = min(2, logical_cores - 1)`, floor 1).
- Reduce idle/execution timeouts from 30 minutes to workload-appropriate values.
- Bound all in-memory queues; reject or defer beyond hard limits.
- Bound stdout/stderr capture and task result size with truncation markers.
- Use event-driven signaling over fixed polling where possible.

SQLite tuning:
- Enable WAL mode.
- Set `synchronous = NORMAL` (or stricter when required).
- Configure `busy_timeout` to avoid spin retries.
- Add/verify indexes for due-task lookup and recent-message scans.
- Run `PRAGMA optimize` on a controlled cadence.

Execution backend startup optimization:
- On-device: reuse TLS sessions and HTTP connections where possible; keep payloads small.
- Remote container runner (optional): remove runtime compilation paths entirely; use prebuilt runner artifacts and cache-friendly layers.
- Keep metadata small and deterministic (mounts for remote backend; capabilities for on-device backend).

Power-aware operations:
- Coalesce non-urgent work when device is thermally constrained.
- Prefer backoff with jitter over tight retry loops.
- Keep logging level conservative in steady state.

## Risks and Fallback Strategy

Key risks:
- WhatsApp integration parity risk if channel behavior diverges.
- Backend parity risk across Apple Container and Docker semantics.
- Hidden behavior coupling in current polling loops and cursor advancement.
- Security regressions during transition from mounted secrets to brokered secrets.
- Benchmark variance across hardware causing misleading optimization conclusions.

Mitigations:
- Keep behavior contract tests as release gates.
- Use feature flags for each major subsystem cutover.
- Canary rollout per group before global switch.
- Keep deterministic structured logs for incident replay.
- Freeze schema changes during high-risk migration phases.

Fallback/rollback plan:
- Maintain dual-host capability during migration (`host_impl = ts | rust` runtime selection).
- Keep sandbox compatibility mode only as a temporary escape hatch.

Rollback steps on regression:
1. Flip host to previous stable implementation.
2. Preserve DB and message cursors; do not destructive-migrate.
3. Export incident bundle (logs, config, benchmark snapshot).
4. Patch forward and re-run parity and soak gates before re-enable.

## Delivery Checklist

- [ ] `RUST_PORT.md` reviewed and approved.
- [ ] Contract test plan committed.
- [ ] Benchmark harness and baseline results committed.
- [ ] Security hardening tasks tracked with owners and target dates.
- [ ] Cutover and rollback runbooks validated in staging.

## What To Borrow From IronClaw vs Avoid

Borrow:
- Strong typed config and explicit module boundaries.
- Sandbox manager abstraction.
- Security-first posture around tools and outbound calls.

Avoid (for NanoClaw's goals):
- Multi-channel platform sprawl.
- Large feature matrix before parity.
- Heavy database/service footprint unless required.

## Definition of Done (Embedded-Ready Rust Milestone)

- On-device Rust host binary (`nanoclaw-device`) runs on the target ESP32-S3 hardware.
- End-to-end tests for message flow (via gateway/bridge), IPC auth semantics, and scheduler pass.
- Boot-to-ready time and end-to-end latency are measured and documented on the target device.
- Memory/CPU/flash-write profile documented on the target embedded hardware.
- Credential handling and egress policy audited and enforced by default.
