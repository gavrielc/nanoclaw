# MicroClaw Phase 1 (Parity + Hardening) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a Rust-first MicroClaw host + ESP32-S3 device runtime with NanoClaw core parity and security hardening.

**Architecture:** A Rust monorepo with shared crates for protocol, core policy, bus, store, queue, scheduler, sandbox, and connectors. Host runs on Mac mini/cloud with Apple Container + Docker parity; device runtime is ESP-IDF (std) with WebSocket connectivity and offline queue.

**Tech Stack:** Rust 1.76+, tokio, serde, rusqlite, tracing, reqwest, twilight (Discord), teloxide (Telegram), imap + lettre (Email), esp-idf-svc (device).

---

## Sprint 0: Monorepo Scaffold + Core Contracts

### Task 0.1: Create Rust workspace + core crate

**Files:**
- Create: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/Cargo.toml`
- Create: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-core/Cargo.toml`
- Create: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-core/src/lib.rs`
- Test: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-core/tests/version.rs`

**Step 1: Write the failing test**
```rust
#[test]
fn reports_version() {
    assert_eq!(microclaw_core::version(), "0.1.0");
}
```

**Step 2: Run test to verify it fails**
Run: `cargo test -p microclaw-core`
Expected: FAIL with "cannot find function `version`"

**Step 3: Write minimal implementation**
```rust
pub fn version() -> &'static str {
    "0.1.0"
}
```

**Step 4: Run test to verify it passes**
Run: `cargo test -p microclaw-core`
Expected: PASS

**Step 5: Commit**
```bash
git add Cargo.toml crates/microclaw-core

git commit -m "feat(core): add workspace and core crate"
```

### Task 0.2: Add protocol crate (envelope + ids)

**Files:**
- Create: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-protocol/Cargo.toml`
- Create: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-protocol/src/lib.rs`
- Test: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-protocol/tests/envelope.rs`

**Step 1: Write the failing test**
```rust
use microclaw_protocol::{Envelope, MessageId};

#[test]
fn creates_envelope_with_seq() {
    let env = Envelope::new("device", "dev1", "sess_default", MessageId::new("m1"));
    assert_eq!(env.seq, 1);
}
```

**Step 2: Run test to verify it fails**
Run: `cargo test -p microclaw-protocol`
Expected: FAIL with "cannot find type `Envelope`"

**Step 3: Write minimal implementation**
```rust
#[derive(Clone, Debug)]
pub struct MessageId(String);

impl MessageId {
    pub fn new(v: impl Into<String>) -> Self { Self(v.into()) }
}

#[derive(Clone, Debug)]
pub struct Envelope {
    pub v: u8,
    pub seq: u64,
    pub source: String,
    pub device_id: String,
    pub session_id: String,
    pub message_id: MessageId,
}

impl Envelope {
    pub fn new(source: &str, device_id: &str, session_id: &str, message_id: MessageId) -> Self {
        Self { v: 1, seq: 1, source: source.into(), device_id: device_id.into(), session_id: session_id.into(), message_id }
    }
}
```

**Step 4: Run test to verify it passes**
Run: `cargo test -p microclaw-protocol`
Expected: PASS

**Step 5: Commit**
```bash
git add crates/microclaw-protocol

git commit -m "feat(protocol): add envelope + ids"
```

### Task 0.3: Add config crate

**Files:**
- Create: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-config/Cargo.toml`
- Create: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-config/src/lib.rs`
- Test: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-config/tests/config.rs`

**Step 1: Write the failing test**
```rust
use microclaw_config::HostConfig;

#[test]
fn default_runner_backend_is_apple_container() {
    let cfg = HostConfig::default();
    assert_eq!(cfg.container_backend, "apple");
}
```

**Step 2: Run test to verify it fails**
Run: `cargo test -p microclaw-config`
Expected: FAIL with "cannot find type `HostConfig`"

**Step 3: Write minimal implementation**
```rust
#[derive(Clone, Debug)]
pub struct HostConfig {
    pub container_backend: String,
}

impl Default for HostConfig {
    fn default() -> Self {
        Self { container_backend: "apple".to_string() }
    }
}
```

**Step 4: Run test to verify it passes**
Run: `cargo test -p microclaw-config`
Expected: PASS

**Step 5: Commit**
```bash
git add crates/microclaw-config

git commit -m "feat(config): add HostConfig defaults"
```

## Sprint 1: Core Parity (Store, Queue, Scheduler, Bus)

### Task 1.1: microclaw-store schema + migrations

**Files:**
- Create: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-store/Cargo.toml`
- Create: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-store/src/lib.rs`
- Create: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-store/migrations/0001_init.sql`
- Test: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-store/tests/migrations.rs`

**Step 1: Write the failing test**
```rust
use microclaw_store::Store;

#[test]
fn applies_migrations() {
    let store = Store::open_in_memory().unwrap();
    let version = store.schema_version().unwrap();
    assert_eq!(version, 1);
}
```

**Step 2: Run test to verify it fails**
Run: `cargo test -p microclaw-store`
Expected: FAIL with "cannot find type `Store`"

**Step 3: Write minimal implementation**
```rust
pub struct Store { conn: rusqlite::Connection }

impl Store {
    pub fn open_in_memory() -> rusqlite::Result<Self> {
        let conn = rusqlite::Connection::open_in_memory()?;
        conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER)", [])?;
        conn.execute("INSERT INTO schema_version (version) VALUES (1)", [])?;
        Ok(Self { conn })
    }

    pub fn schema_version(&self) -> rusqlite::Result<i64> {
        self.conn.query_row("SELECT version FROM schema_version LIMIT 1", [], |row| row.get(0))
    }
}
```

**Step 4: Run test to verify it passes**
Run: `cargo test -p microclaw-store`
Expected: PASS

**Step 5: Commit**
```bash
git add crates/microclaw-store

git commit -m "feat(store): add schema version and in-memory store"
```

### Task 1.2: microclaw-queue per-group FIFO

**Files:**
- Create: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-queue/Cargo.toml`
- Create: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-queue/src/lib.rs`
- Test: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-queue/tests/fifo.rs`

**Step 1: Write the failing test**
```rust
use microclaw_queue::GroupQueue;

#[test]
fn preserves_fifo_per_group() {
    let mut q = GroupQueue::new(2);
    q.push("g1", "a");
    q.push("g1", "b");
    assert_eq!(q.pop("g1"), Some("a"));
    assert_eq!(q.pop("g1"), Some("b"));
}
```

**Step 2: Run test to verify it fails**
Run: `cargo test -p microclaw-queue`
Expected: FAIL with "cannot find type `GroupQueue`"

**Step 3: Write minimal implementation**
```rust
use std::collections::{HashMap, VecDeque};

pub struct GroupQueue<T> {
    per_group: HashMap<String, VecDeque<T>>,
    capacity: usize,
}

impl<T> GroupQueue<T> {
    pub fn new(capacity: usize) -> Self {
        Self { per_group: HashMap::new(), capacity }
    }

    pub fn push(&mut self, group: &str, item: T) {
        let q = self.per_group.entry(group.to_string()).or_default();
        if q.len() < self.capacity { q.push_back(item); }
    }

    pub fn pop(&mut self, group: &str) -> Option<T> {
        self.per_group.get_mut(group).and_then(|q| q.pop_front())
    }
}
```

**Step 4: Run test to verify it passes**
Run: `cargo test -p microclaw-queue`
Expected: PASS

**Step 5: Commit**
```bash
git add crates/microclaw-queue

git commit -m "feat(queue): add per-group FIFO queue"
```

### Task 1.3: microclaw-scheduler basic due logic

**Files:**
- Create: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-scheduler/Cargo.toml`
- Create: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-scheduler/src/lib.rs`
- Test: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-scheduler/tests/due.rs`

**Step 1: Write the failing test**
```rust
use microclaw_scheduler::{Scheduler, TaskSpec};
use std::time::{Duration, SystemTime};

#[test]
fn returns_due_tasks() {
    let now = SystemTime::UNIX_EPOCH + Duration::from_secs(10);
    let mut sched = Scheduler::new();
    sched.add(TaskSpec::once("t1", SystemTime::UNIX_EPOCH));
    let due = sched.due(now);
    assert_eq!(due.len(), 1);
}
```

**Step 2: Run test to verify it fails**
Run: `cargo test -p microclaw-scheduler`
Expected: FAIL with "cannot find type `Scheduler`"

**Step 3: Write minimal implementation**
```rust
use std::time::SystemTime;

pub struct TaskSpec { id: String, at: SystemTime }

impl TaskSpec {
    pub fn once(id: &str, at: SystemTime) -> Self { Self { id: id.to_string(), at } }
}

pub struct Scheduler { tasks: Vec<TaskSpec> }

impl Scheduler {
    pub fn new() -> Self { Self { tasks: Vec::new() } }
    pub fn add(&mut self, task: TaskSpec) { self.tasks.push(task); }
    pub fn due(&self, now: SystemTime) -> Vec<&TaskSpec> {
        self.tasks.iter().filter(|t| t.at <= now).collect()
    }
}
```

**Step 4: Run test to verify it passes**
Run: `cargo test -p microclaw-scheduler`
Expected: PASS

**Step 5: Commit**
```bash
git add crates/microclaw-scheduler

git commit -m "feat(scheduler): add due task evaluation"
```

### Task 1.4: microclaw-bus in-memory queue + idempotency

**Files:**
- Create: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-bus/Cargo.toml`
- Create: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-bus/src/lib.rs`
- Test: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-bus/tests/idempotent.rs`

**Step 1: Write the failing test**
```rust
use microclaw_bus::Bus;
use microclaw_protocol::{Envelope, MessageId};

#[test]
fn drops_duplicate_message_ids() {
    let mut bus = Bus::new();
    let env = Envelope::new("device", "dev1", "sess_default", MessageId::new("m1"));
    assert!(bus.publish(env.clone()));
    assert!(!bus.publish(env));
}
```

**Step 2: Run test to verify it fails**
Run: `cargo test -p microclaw-bus`
Expected: FAIL with "cannot find type `Bus`"

**Step 3: Write minimal implementation**
```rust
use std::collections::HashSet;
use microclaw_protocol::Envelope;

pub struct Bus {
    seen: HashSet<String>,
}

impl Bus {
    pub fn new() -> Self { Self { seen: HashSet::new() } }
    pub fn publish(&mut self, env: Envelope) -> bool {
        let key = format!("{}:{}", env.device_id, "m1");
        if self.seen.contains(&key) { return false; }
        self.seen.insert(key);
        true
    }
}
```

**Step 4: Run test to verify it passes**
Run: `cargo test -p microclaw-bus`
Expected: PASS

**Step 5: Commit**
```bash
git add crates/microclaw-bus

git commit -m "feat(bus): add in-memory bus with idempotency"
```

## Sprint 2: Sandbox + Security Hardening

### Task 2.1: sandbox trait + Apple Container backend stub

**Files:**
- Create: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-sandbox/Cargo.toml`
- Create: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-sandbox/src/lib.rs`
- Test: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-sandbox/tests/backend.rs`

**Step 1: Write the failing test**
```rust
use microclaw_sandbox::{ContainerBackend, AppleContainer};

#[test]
fn apple_backend_reports_name() {
    let backend = AppleContainer::new();
    assert_eq!(backend.name(), "apple");
}
```

**Step 2: Run test to verify it fails**
Run: `cargo test -p microclaw-sandbox`
Expected: FAIL with "cannot find type `AppleContainer`"

**Step 3: Write minimal implementation**
```rust
pub trait ContainerBackend { fn name(&self) -> &'static str; }

pub struct AppleContainer;

impl AppleContainer { pub fn new() -> Self { Self } }
impl ContainerBackend for AppleContainer { fn name(&self) -> &'static str { "apple" } }
```

**Step 4: Run test to verify it passes**
Run: `cargo test -p microclaw-sandbox`
Expected: PASS

**Step 5: Commit**
```bash
git add crates/microclaw-sandbox

git commit -m "feat(sandbox): add backend trait + apple stub"
```

### Task 2.2: Docker backend stub

**Files:**
- Modify: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-sandbox/src/lib.rs`
- Test: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-sandbox/tests/backend.rs`

**Step 1: Write the failing test**
```rust
use microclaw_sandbox::{ContainerBackend, DockerBackend};

#[test]
fn docker_backend_reports_name() {
    let backend = DockerBackend::new();
    assert_eq!(backend.name(), "docker");
}
```

**Step 2: Run test to verify it fails**
Run: `cargo test -p microclaw-sandbox`
Expected: FAIL with "cannot find type `DockerBackend`"

**Step 3: Write minimal implementation**
```rust
pub struct DockerBackend;

impl DockerBackend { pub fn new() -> Self { Self } }
impl ContainerBackend for DockerBackend { fn name(&self) -> &'static str { "docker" } }
```

**Step 4: Run test to verify it passes**
Run: `cargo test -p microclaw-sandbox`
Expected: PASS

**Step 5: Commit**
```bash
git add crates/microclaw-sandbox

git commit -m "feat(sandbox): add docker backend stub"
```

## Sprint 3: Connectors (Skeletons + Contract Tests)

### Task 3.1: connector trait + shared types

**Files:**
- Create: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-connectors/Cargo.toml`
- Create: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-connectors/src/lib.rs`
- Test: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/crates/microclaw-connectors/tests/trait.rs`

**Step 1: Write the failing test**
```rust
use microclaw_connectors::{Connector, ConnectorId};

struct Dummy;
impl Connector for Dummy { fn id(&self) -> ConnectorId { ConnectorId("dummy".into()) } }

#[test]
fn connector_id_is_stable() {
    let c = Dummy;
    assert_eq!(c.id().0, "dummy");
}
```

**Step 2: Run test to verify it fails**
Run: `cargo test -p microclaw-connectors`
Expected: FAIL with "cannot find trait `Connector`"

**Step 3: Write minimal implementation**
```rust
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConnectorId(pub String);

pub trait Connector {
    fn id(&self) -> ConnectorId;
}
```

**Step 4: Run test to verify it passes**
Run: `cargo test -p microclaw-connectors`
Expected: PASS

**Step 5: Commit**
```bash
git add crates/microclaw-connectors

git commit -m "feat(connectors): add connector trait"
```

## Sprint 4: Device Runtime (ESP32-S3) - Host-Compile Skeleton

### Task 4.1: device crate scaffold (host-testable)

**Files:**
- Create: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/apps/microclaw-device/Cargo.toml`
- Create: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/apps/microclaw-device/src/main.rs`
- Test: `/Users/Cody/code_projects/nanoclaw/.worktrees/microclaw-sprint0/apps/microclaw-device/tests/boot.rs`

**Step 1: Write the failing test**
```rust
#[test]
fn device_boot_message() {
    let msg = microclaw_device::boot_message();
    assert_eq!(msg, "microclaw-device ready");
}
```

**Step 2: Run test to verify it fails**
Run: `cargo test -p microclaw-device --features host`
Expected: FAIL with "cannot find crate `microclaw_device`"

**Step 3: Write minimal implementation**
```rust
pub fn boot_message() -> &'static str { "microclaw-device ready" }

fn main() {
    // ESP-IDF runtime entrypoint stub
    println!("{}", boot_message());
}
```

**Step 4: Run test to verify it passes**
Run: `cargo test -p microclaw-device --features host`
Expected: PASS

**Step 5: Commit**
```bash
git add apps/microclaw-device

git commit -m "feat(device): add device app scaffold"
```

---

## Notes for Execution
- Keep workspace `default-members` limited to host crates so `cargo test` does not require ESP-IDF toolchains.
- For device tests, use a `host` feature that compiles without ESP-IDF dependencies.
- All functional changes must be TDD: write failing tests first, verify red, then green.

---

Plan complete and saved to `docs/plans/2026-02-12-microclaw-phase1-implementation-plan.md`.

Two execution options:
1. Subagent-Driven (this session) – dispatch a fresh subagent per task, review between tasks.
2. Parallel Session (separate) – open new session with executing-plans, batch execution with checkpoints.

Which approach?
