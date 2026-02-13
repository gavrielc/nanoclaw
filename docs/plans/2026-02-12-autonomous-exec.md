# Autonomous Execution Contract - Runner Prebuilt Mode

## 0) Cycle Metadata

- Cycle id: 1
- Timestamp: 2026-02-12
- Current slice: S1 (add contract tests for runner mode mount selection)
- Next cycle kickoff target: S2 (implement runner mode + mount logic)
- Minimum cycle budget for this invocation (default 5): 5
- Cycles completed this invocation: 0
- Remaining cycle budget: 5
- Early stop blocker reason (if any):

## 1) Objective

- Outcome: Remove per-invocation TypeScript compilation in the agent container by default, while preserving a dev mode that mounts source and recompiles when explicitly enabled.
- In scope:
  - Add runner mode configuration and mount gating on host.
  - Make container entrypoint run prebuilt `dist` by default.
  - Add contract tests for mount selection.
  - Update docs for new runner mode.
- Out of scope:
  - Full sandbox/egress policy changes.
  - Any Rust port code.
  - Major container image refactor beyond entrypoint logic.
- Constraints:
  - Preserve existing tests and behavior where possible.
  - Must keep Apple Container and Docker backends working.
  - Keep docs accurate for new behavior.
- Assumptions:
  - Container image includes prebuilt `dist/` from Dockerfile build.
  - Host can set `NANOCLAW_RUNNER_MODE` via environment.

## 2) End-State Goals (must all pass)

- Goal E1: Runner prebuilt mode is default, dev/source mode is optional and documented.
  - Verification command: `npx vitest run src/container-runner.test.ts`
  - Pass signal: new runner-mode tests pass
- Goal E2: Host build/test/format remain green.
  - Verification command: `npm run typecheck && npm run build && npm test && npm run format:check`
  - Pass signal: all commands succeed

## 3) Failure Criteria (must remain protected)

- Failure guard F1: Unit tests must not regress.
  - Verification command: `npm test`
  - Failure signal: any failing tests
- Failure guard F2: Typecheck/build must not regress.
  - Verification command: `npm run typecheck && npm run build`
  - Failure signal: non-zero exit
- Failure guard F3: Formatting must remain clean.
  - Verification command: `npm run format:check`
  - Failure signal: any Prettier warnings

## 4) Acceptance Criteria by Slice

- Slice S1:
  - Change intent: add contract tests for runner mode mount selection (dev vs prebuilt)
  - Files likely affected: `src/container-runner.test.ts`
  - Verification command(s): `npx vitest run src/container-runner.test.ts`
  - Completion signal: tests fail before code changes, pass after
- Slice S2:
  - Change intent: implement runner mode config + mount gating in host
  - Files likely affected: `src/config.ts`, `src/container-runner.ts`
  - Verification command(s): `npx vitest run src/container-runner.test.ts`
  - Completion signal: runner-mode tests pass
- Slice S3:
  - Change intent: propagate runner mode into container env file
  - Files likely affected: `src/container-runner.ts`
  - Verification command(s): `npx vitest run src/container-runner.test.ts`
  - Completion signal: mount tests still pass; new env behavior documented
- Slice S4:
  - Change intent: update container entrypoint to run prebuilt dist by default
  - Files likely affected: `container/Dockerfile`
  - Verification command(s): `docker build -t nanoclaw-agent:latest container` (manual), `container build -t nanoclaw-agent:latest container` (manual)
  - Completion signal: entrypoint selects prebuilt when `NANOCLAW_RUNNER_MODE` not set
- Slice S5:
  - Change intent: document runner mode in README or docs
  - Files likely affected: `README.md`
  - Verification command(s): `rg -n "NANOCLAW_RUNNER_MODE" README.md`
  - Completion signal: docs mention default + dev mode

## 5) Execution Loop Checklist

Use fixed cadence: `SPEC -> TESTS (pre-write) -> WRITE -> TESTS (post-write) -> CHECKPOINT -> LOOP`.

## 6) Cycle Closeout (append every cycle)

- Cycle budget status (completed/target/remaining):
- Pre-write tests status (pass/fail):
- Post-write tests status (pass/fail):
- Acceptance criteria status (pass/fail):
- Failure criteria guard status (pass/fail):
- Commands run:
- Files changed:
- Residual risks:
- Deferred items:
- Next cycle kickoff:

### Cycle 1 Closeout

- Cycle budget status (completed/target/remaining): 1/5/4
- Pre-write tests status (pass): `npx vitest run src/container-runner.test.ts`
- Post-write tests status (fail as expected): `npx vitest run src/container-runner.runner-mode.test.ts`
- Acceptance criteria status: S1 in progress (prebuilt test failing as expected)
- Failure criteria guard status: not run this cycle beyond targeted test
- Commands run:
  - `npx vitest run src/container-runner.test.ts`
  - `npx vitest run src/container-runner.runner-mode.test.ts`
- Files changed:
  - `src/container-runner.runner-mode.test.ts`
- Residual risks:
  - Runner mode logic not yet implemented; tests currently failing (expected).
- Deferred items:
  - Implement runner mode config + mount gating (S2).
- Next cycle kickoff:
  - Cycle 2, S2 (implement runner mode + mount gating).

### Cycle 2 Closeout

- Cycle budget status (completed/target/remaining): 2/5/3
- Pre-write tests status (fail as expected): `npx vitest run src/container-runner.runner-mode.test.ts`
- Post-write tests status (pass): `npx vitest run src/container-runner.runner-mode.test.ts`
- Acceptance criteria status: S2 complete
- Failure criteria guard status: not run this cycle beyond targeted test
- Commands run:
  - `npx vitest run src/container-runner.runner-mode.test.ts`
- Files changed:
  - `src/config.ts`
  - `src/container-runner.ts`
  - `src/container-runner.test.ts`
- Residual risks:
  - Runner mode not yet propagated into container env; entrypoint still recompiles.
- Deferred items:
  - S3: env propagation.
  - S4: entrypoint prebuilt mode.
- Next cycle kickoff:
  - Cycle 3, S3 (propagate runner mode into container env file).

### Cycle 3 Closeout

- Cycle budget status (completed/target/remaining): 3/5/2
- Pre-write tests status (fail as expected): `npx vitest run src/container-runner.env-file.test.ts`
- Post-write tests status (pass): `npx vitest run src/container-runner.env-file.test.ts`
- Acceptance criteria status: S3 complete
- Failure criteria guard status: not run this cycle beyond targeted test
- Commands run:
  - `npx vitest run src/container-runner.env-file.test.ts`
- Files changed:
  - `src/container-runner.env-file.test.ts`
  - `src/container-runner.ts`
- Residual risks:
  - Container entrypoint still recompiles by default.
- Deferred items:
  - S4: entrypoint prebuilt mode.
  - S5: docs update for runner mode.
- Next cycle kickoff:
  - Cycle 4, S4 (update container entrypoint for prebuilt default).

### Cycle 4 Closeout

- Cycle budget status (completed/target/remaining): 4/5/1
- Pre-write tests status: not run (config-only change)
- Post-write tests status: not run (Docker/Apple Container builds not executed in this cycle)
- Acceptance criteria status: S4 complete (entrypoint updated); manual build verification deferred
- Failure criteria guard status: not run this cycle beyond prior tests
- Commands run: none
- Files changed:
  - `container/Dockerfile`
- Residual risks:
  - Entry point change not validated by a container build in this environment.
- Deferred items:
  - Manual `docker build` / `container build` validation.
- Next cycle kickoff:
  - Cycle 5, S5 (document runner mode in README).

### Cycle 5 Closeout

- Cycle budget status (completed/target/remaining): 5/5/0
- Pre-write tests status: not run (docs-only change)
- Post-write tests status: `rg -n "NANOCLAW_RUNNER_MODE" README.md` (pass)
- Acceptance criteria status: S5 complete
- Failure criteria guard status: pending end-state verification
- Commands run:
  - `rg -n "NANOCLAW_RUNNER_MODE" README.md`
- Files changed:
  - `README.md`
- Residual risks:
  - Container build verification deferred (S4 note).
- Deferred items:
  - Manual container image build validation.
- Next cycle kickoff:
  - End-state verification (E1/E2) and final summary.
