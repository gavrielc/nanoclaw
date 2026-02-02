# NanoClaw: TypeScript to Babashka Migration Plan

**Date**: 2026-02-02
**Author**: Claude
**Status**: Planning Phase

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current Architecture Overview](#current-architecture-overview)
3. [Data Structures & Interfaces](#data-structures--interfaces)
4. [Function Signatures](#function-signatures)
5. [Library Mapping](#library-mapping)
6. [Migration Strategy](#migration-strategy)
7. [Detailed Component Analysis](#detailed-component-analysis)
8. [Risk Assessment](#risk-assessment)
9. [Recommendations](#recommendations)

---

## Executive Summary

This document outlines a plan to migrate NanoClaw from TypeScript/Node.js to Babashka (Clojure). The migration presents several challenges, particularly around WhatsApp connectivity which has no native Clojure implementation. A **hybrid architecture** using nbb (ClojureScript on Node.js) for WhatsApp and Babashka for core logic is recommended.

### Key Findings

| Component | Migration Path | Difficulty |
|-----------|---------------|------------|
| WhatsApp Client | nbb + Baileys OR subprocess bridge | High |
| SQLite Database | pod-babashka-go-sqlite3 | Low |
| Container Runner | babashka.process | Low |
| Task Scheduler | at-at + manual cron parsing | Medium |
| IPC Watcher | pod-babashka-fswatcher | Low |
| JSON Handling | cheshire.core (built-in) | Low |
| Schema Validation | malli | Low |
| MCP Server (container) | clojure-mcp or modex | Medium |

---

## Current Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        HOST (macOS)                                  │
│                   (Single Node.js Process)                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐    ┌────────────────────┐    ┌───────────────┐   │
│  │  WhatsApp    │    │   SQLite Database  │    │  Registered   │   │
│  │  (baileys)   │───▶│   (better-sqlite3) │    │  Groups JSON  │   │
│  └──────────────┘    └─────────┬──────────┘    └───────────────┘   │
│                                │                                    │
│  ┌──────────────────┐  ┌───────┴───────┐  ┌───────────────────┐   │
│  │  Message Loop    │  │  Scheduler    │  │  IPC Watcher      │   │
│  │  (2s polling)    │  │  (60s polling)│  │  (1s file polling)│   │
│  └────────┬─────────┘  └───────┬───────┘  └─────────┬─────────┘   │
│           │                    │                    │              │
│           └────────────────────┴────────────────────┘              │
│                                │                                    │
│                       Container Runner                              │
│                    (spawn Apple Container)                          │
├─────────────────────────────────────────────────────────────────────┤
│                  APPLE CONTAINER (Linux VM)                         │
├─────────────────────────────────────────────────────────────────────┤
│  Agent Runner (Node.js) + Claude Agent SDK + IPC MCP Server        │
└─────────────────────────────────────────────────────────────────────┘
```

### Source File Inventory

| File | Lines | Purpose |
|------|-------|---------|
| `src/index.ts` | 613 | Main: WhatsApp, routing, IPC |
| `src/container-runner.ts` | 440 | Container orchestration |
| `src/db.ts` | 285 | SQLite operations |
| `src/task-scheduler.ts` | 139 | Scheduler loop |
| `src/mount-security.ts` | 385 | Mount validation |
| `src/config.ts` | 32 | Configuration |
| `src/types.ts` | 80 | TypeScript interfaces |
| `src/utils.ts` | 19 | JSON utilities |
| `container/agent-runner/src/index.ts` | 290 | Container entry point |
| `container/agent-runner/src/ipc-mcp.ts` | 322 | MCP server for IPC |

**Total**: ~2,585 lines of TypeScript

---

## Data Structures & Interfaces

### Core Domain Types

```typescript
// src/types.ts

// Mount configuration for containers
interface AdditionalMount {
  hostPath: string;      // Absolute path on host (supports ~)
  containerPath: string; // Path inside container
  readonly?: boolean;    // Default: true
}

// Security allowlist (external config)
interface MountAllowlist {
  allowedRoots: AllowedRoot[];
  blockedPatterns: string[];
  nonMainReadOnly: boolean;
}

interface AllowedRoot {
  path: string;
  allowReadWrite: boolean;
  description?: string;
}

// Per-group container configuration
interface ContainerConfig {
  additionalMounts?: AdditionalMount[];
  timeout?: number;
  env?: Record<string, string>;
}

// Registered WhatsApp group
interface RegisteredGroup {
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  containerConfig?: ContainerConfig;
}

// Session mapping (group folder -> session ID)
interface Session {
  [folder: string]: string;
}

// Message from database
interface NewMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
}

// Scheduled task
interface ScheduledTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode: 'group' | 'isolated';
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: 'active' | 'paused' | 'completed';
  created_at: string;
}

// Task execution log
interface TaskRunLog {
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: 'success' | 'error';
  result: string | null;
  error: string | null;
}
```

### Clojure Equivalents (using Malli)

```clojure
(ns nanoclaw.schemas
  (:require [malli.core :as m]))

;; Mount configuration
(def AdditionalMount
  [:map
   [:host-path :string]
   [:container-path :string]
   [:readonly {:optional true :default true} :boolean]])

(def AllowedRoot
  [:map
   [:path :string]
   [:allow-read-write :boolean]
   [:description {:optional true} :string]])

(def MountAllowlist
  [:map
   [:allowed-roots [:vector AllowedRoot]]
   [:blocked-patterns [:vector :string]]
   [:non-main-read-only :boolean]])

(def ContainerConfig
  [:map
   [:additional-mounts {:optional true} [:vector AdditionalMount]]
   [:timeout {:optional true} :int]
   [:env {:optional true} [:map-of :string :string]]])

(def RegisteredGroup
  [:map
   [:name :string]
   [:folder :string]
   [:trigger :string]
   [:added-at :string]
   [:container-config {:optional true} ContainerConfig]])

(def NewMessage
  [:map
   [:id :string]
   [:chat-jid :string]
   [:sender :string]
   [:sender-name :string]
   [:content :string]
   [:timestamp :string]])

(def ScheduleType [:enum "cron" "interval" "once"])
(def ContextMode [:enum "group" "isolated"])
(def TaskStatus [:enum "active" "paused" "completed"])

(def ScheduledTask
  [:map
   [:id :string]
   [:group-folder :string]
   [:chat-jid :string]
   [:prompt :string]
   [:schedule-type ScheduleType]
   [:schedule-value :string]
   [:context-mode ContextMode]
   [:next-run [:maybe :string]]
   [:last-run [:maybe :string]]
   [:last-result [:maybe :string]]
   [:status TaskStatus]
   [:created-at :string]])

(def TaskRunLog
  [:map
   [:task-id :string]
   [:run-at :string]
   [:duration-ms :int]
   [:status [:enum "success" "error"]]
   [:result [:maybe :string]]
   [:error [:maybe :string]]])
```

### Container I/O Types

```typescript
// container-runner.ts

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
}

interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface VolumeMount {
  hostPath: string;
  containerPath: string;
  readonly?: boolean;
}

interface AvailableGroup {
  jid: string;
  name: string;
  lastActivity: string;
  isRegistered: boolean;
}
```

```clojure
;; Clojure equivalents
(def ContainerInput
  [:map
   [:prompt :string]
   [:session-id {:optional true} :string]
   [:group-folder :string]
   [:chat-jid :string]
   [:is-main :boolean]
   [:is-scheduled-task {:optional true} :boolean]])

(def ContainerOutput
  [:map
   [:status [:enum "success" "error"]]
   [:result [:maybe :string]]
   [:new-session-id {:optional true} :string]
   [:error {:optional true} :string]])

(def VolumeMount
  [:map
   [:host-path :string]
   [:container-path :string]
   [:readonly {:optional true} :boolean]])

(def AvailableGroup
  [:map
   [:jid :string]
   [:name :string]
   [:last-activity :string]
   [:is-registered :boolean]])
```

### Database Schema

```sql
-- SQLite Tables

CREATE TABLE chats (
  jid TEXT PRIMARY KEY,
  name TEXT,
  last_message_time TEXT
);

CREATE TABLE messages (
  id TEXT,
  chat_jid TEXT,
  sender TEXT,
  sender_name TEXT,
  content TEXT,
  timestamp TEXT,
  is_from_me INTEGER,
  PRIMARY KEY (id, chat_jid),
  FOREIGN KEY (chat_jid) REFERENCES chats(jid)
);

CREATE TABLE scheduled_tasks (
  id TEXT PRIMARY KEY,
  group_folder TEXT NOT NULL,
  chat_jid TEXT NOT NULL,
  prompt TEXT NOT NULL,
  schedule_type TEXT NOT NULL,
  schedule_value TEXT NOT NULL,
  context_mode TEXT DEFAULT 'isolated',
  next_run TEXT,
  last_run TEXT,
  last_result TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE task_run_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  run_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  result TEXT,
  error TEXT,
  FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
);
```

---

## Function Signatures

### Host Application (src/)

#### config.ts
```typescript
// Constants (no functions)
const ASSISTANT_NAME: string
const POLL_INTERVAL: number         // 2000ms
const SCHEDULER_POLL_INTERVAL: number  // 60000ms
const MOUNT_ALLOWLIST_PATH: string
const STORE_DIR: string
const GROUPS_DIR: string
const DATA_DIR: string
const MAIN_GROUP_FOLDER: string     // "main"
const CONTAINER_IMAGE: string
const CONTAINER_TIMEOUT: number     // 300000ms
const CONTAINER_MAX_OUTPUT_SIZE: number  // 10MB
const IPC_POLL_INTERVAL: number     // 1000ms
const TRIGGER_PATTERN: RegExp
const TIMEZONE: string
```

#### utils.ts
```typescript
function loadJson<T>(filePath: string, defaultValue: T): T
function saveJson(filePath: string, data: unknown): void
```

#### db.ts
```typescript
// Initialization
function initDatabase(): void

// Chat operations
function storeChatMetadata(chatJid: string, timestamp: string, name?: string): void
function updateChatName(chatJid: string, name: string): void
function getAllChats(): ChatInfo[]
function getLastGroupSync(): string | null
function setLastGroupSync(): void

// Message operations
function storeMessage(msg: proto.IWebMessageInfo, chatJid: string, isFromMe: boolean, pushName?: string): void
function getNewMessages(jids: string[], lastTimestamp: string, botPrefix: string): { messages: NewMessage[]; newTimestamp: string }
function getMessagesSince(chatJid: string, sinceTimestamp: string, botPrefix: string): NewMessage[]

// Task operations
function createTask(task: Omit<ScheduledTask, 'last_run' | 'last_result'>): void
function getTaskById(id: string): ScheduledTask | undefined
function getTasksForGroup(groupFolder: string): ScheduledTask[]
function getAllTasks(): ScheduledTask[]
function updateTask(id: string, updates: Partial<Pick<ScheduledTask, ...>>): void
function deleteTask(id: string): void
function getDueTasks(): ScheduledTask[]
function updateTaskAfterRun(id: string, nextRun: string | null, lastResult: string): void
function logTaskRun(log: TaskRunLog): void
function getTaskRunLogs(taskId: string, limit?: number): TaskRunLog[]
```

#### mount-security.ts
```typescript
function loadMountAllowlist(): MountAllowlist | null
function validateMount(mount: AdditionalMount, isMain: boolean): MountValidationResult
function validateAdditionalMounts(mounts: AdditionalMount[], groupName: string, isMain: boolean): ValidatedMount[]
function generateAllowlistTemplate(): string
```

#### container-runner.ts
```typescript
function runContainerAgent(group: RegisteredGroup, input: ContainerInput): Promise<ContainerOutput>
function writeTasksSnapshot(groupFolder: string, isMain: boolean, tasks: TaskSnapshot[]): void
function writeGroupsSnapshot(groupFolder: string, isMain: boolean, groups: AvailableGroup[], registeredJids: Set<string>): void
```

#### task-scheduler.ts
```typescript
interface SchedulerDependencies {
  sendMessage: (jid: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
}

function startSchedulerLoop(deps: SchedulerDependencies): void
```

#### index.ts (Main Application)
```typescript
// Internal functions
async function setTyping(jid: string, isTyping: boolean): Promise<void>
function loadState(): void
function saveState(): void
function registerGroup(jid: string, group: RegisteredGroup): void
async function syncGroupMetadata(force?: boolean): Promise<void>
function getAvailableGroups(): AvailableGroup[]
async function processMessage(msg: NewMessage): Promise<void>
async function runAgent(group: RegisteredGroup, prompt: string, chatJid: string): Promise<string | null>
async function sendMessage(jid: string, text: string): Promise<void>
function startIpcWatcher(): void
async function processTaskIpc(data: IpcTaskData, sourceGroup: string, isMain: boolean): Promise<void>
async function connectWhatsApp(): Promise<void>
async function startMessageLoop(): Promise<void>
function ensureContainerSystemRunning(): void
async function main(): Promise<void>
```

### Container Application (container/agent-runner/)

#### index.ts
```typescript
async function readStdin(): Promise<string>
function writeOutput(output: ContainerOutput): void
function log(message: string): void
function getSessionSummary(sessionId: string, transcriptPath: string): string | null
function createPreCompactHook(): HookCallback
function sanitizeFilename(summary: string): string
function generateFallbackName(): string
function parseTranscript(content: string): ParsedMessage[]
function formatTranscriptMarkdown(messages: ParsedMessage[], title?: string | null): string
async function main(): Promise<void>
```

#### ipc-mcp.ts
```typescript
interface IpcMcpContext {
  chatJid: string;
  groupFolder: string;
  isMain: boolean;
}

function writeIpcFile(dir: string, data: object): string
function createIpcMcp(ctx: IpcMcpContext): McpServer

// MCP Tools:
// - send_message(text: string)
// - schedule_task(prompt, schedule_type, schedule_value, context_mode?, target_group?)
// - list_tasks()
// - pause_task(task_id)
// - resume_task(task_id)
// - cancel_task(task_id)
// - register_group(jid, name, folder, trigger)
```

---

## Library Mapping

### Direct Replacements (Available in Babashka)

| TypeScript | Babashka | Notes |
|------------|----------|-------|
| `better-sqlite3` | `pod-babashka-go-sqlite3` | Babashka pod, synchronous API |
| `zod` | `malli` | Built-in to bb, more powerful |
| `pino` | `taoensso.timbre` | Built-in logging |
| `fs` | `babashka.fs` | Built-in, cross-platform |
| `path` | `babashka.fs` | Path operations included |
| `child_process` | `babashka.process` | Built-in, excellent API |
| JSON parsing | `cheshire.core` | Built-in |

### Requires Additional Work

| TypeScript | Babashka Approach | Complexity |
|------------|-------------------|------------|
| `@whiskeysockets/baileys` | nbb + Baileys OR Node subprocess | High |
| `cron-parser` | Manual impl OR `at-at` for scheduling | Medium |
| `@anthropic-ai/claude-agent-sdk` | Keep as subprocess (Node.js) | Medium |
| MCP Server creation | `modex`, `mcp-clj`, or manual impl | Medium |

### Library Details

#### SQLite: pod-babashka-go-sqlite3

```clojure
(require '[babashka.pods :as pods])
(pods/load-pod 'org.babashka/go-sqlite3 "0.3.13")
(require '[pod.babashka.go-sqlite3 :as sqlite])

;; Execute DDL
(sqlite/execute! db-path ["CREATE TABLE IF NOT EXISTS chats ..."])

;; Query
(sqlite/query db-path ["SELECT * FROM messages WHERE chat_jid = ?" jid])

;; Insert
(sqlite/execute! db-path ["INSERT INTO messages VALUES (?, ?, ?)" id jid content])
```

#### Process Management: babashka.process

```clojure
(require '[babashka.process :refer [process shell]]
         '[clojure.java.io :as io])

;; Spawn container with stdin/stdout pipes
(def container
  (process ["container" "run" "-i" "--rm" "-v" mount image]
           {:in :pipe :out :pipe :err :inherit}))

;; Write JSON to stdin
(let [stdin (io/writer (:in container))]
  (.write stdin (cheshire/generate-string input))
  (.close stdin))

;; Read JSON from stdout
(with-open [rdr (io/reader (:out container))]
  (-> (slurp rdr)
      (extract-json-between-markers)
      (cheshire/parse-string true)))

;; Wait with timeout
(deref container timeout-ms :timeout)
```

#### File System Watching: pod-babashka-fswatcher

```clojure
(require '[babashka.pods :as pods])
(pods/load-pod 'org.babashka/fswatcher "0.0.5")
(require '[pod.babashka.fswatcher :as fw])

(fw/watch ipc-dir
  (fn [{:keys [type path]}]
    (when (and (= type :create) (str/ends-with? path ".json"))
      (process-ipc-file path)))
  {:recursive true})
```

#### Validation: Malli

```clojure
(require '[malli.core :as m]
         '[malli.error :as me])

(def Message
  [:map
   [:id :string]
   [:content :string]
   [:timestamp :string]])

(m/validate Message data)  ; => true/false
(me/humanize (m/explain Message bad-data))  ; => error messages
```

#### Scheduling: at-at + manual cron

```clojure
(require '[overtone.at-at :as at])

(def scheduler-pool (at/mk-pool))

;; Run every 60 seconds
(at/every 60000 check-due-tasks scheduler-pool)

;; Run once at specific time
(at/at (-> target-time .toInstant .toEpochMilli)
       run-task
       scheduler-pool)
```

For cron parsing, a simple implementation:

```clojure
(defn parse-cron [expr]
  ;; "0 9 * * 1" -> {:minute 0 :hour 9 :day-of-week 1}
  (let [[min hour dom month dow] (str/split expr #"\s+")]
    {:minute (parse-field min)
     :hour (parse-field hour)
     :day-of-month (parse-field dom)
     :month (parse-field month)
     :day-of-week (parse-field dow)}))

(defn next-cron-time [cron-map from-time]
  ;; Calculate next execution time using java.time
  ...)
```

---

## Migration Strategy

### Recommended Approach: Hybrid Architecture

Given the WhatsApp connectivity challenge, a hybrid approach is most practical:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        HOST (macOS)                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │           BABASHKA CORE (bb nanoclaw.clj)                     │  │
│  │                                                                │  │
│  │  • SQLite database operations                                  │  │
│  │  • Task scheduling logic                                       │  │
│  │  • Container spawning/management                               │  │
│  │  • IPC file watching                                          │  │
│  │  • Mount security validation                                   │  │
│  │  • State management                                           │  │
│  └────────────────────────┬──────────────────────────────────────┘  │
│                           │                                          │
│                    JSON over stdio                                   │
│                           │                                          │
│  ┌────────────────────────┴──────────────────────────────────────┐  │
│  │         nbb WhatsApp Bridge (whatsapp-bridge.cljs)            │  │
│  │                                                                │  │
│  │  • Baileys connection                                          │  │
│  │  • Message send/receive                                        │  │
│  │  • QR code authentication                                      │  │
│  │  • Presence updates (typing indicators)                        │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Migration Phases

#### Phase 1: Core Infrastructure (Week 1-2)

**Goal**: Set up Babashka project structure and migrate stateless components.

1. **Project Setup**
   ```
   bb/
   ├── bb.edn                 # Babashka config, pods, deps
   ├── src/
   │   ├── nanoclaw/
   │   │   ├── core.clj       # Main entry point
   │   │   ├── config.clj     # Configuration
   │   │   ├── schemas.clj    # Malli schemas
   │   │   ├── db.clj         # SQLite operations
   │   │   ├── utils.clj      # JSON, file utils
   │   │   └── ...
   │   └── ...
   └── test/
   ```

2. **Migrate**:
   - `config.ts` → `config.clj`
   - `types.ts` → `schemas.clj` (Malli)
   - `utils.ts` → `utils.clj`
   - `db.ts` → `db.clj` (pod-babashka-go-sqlite3)
   - `mount-security.ts` → `mount-security.clj`

**Deliverable**: Database operations working, all schemas defined.

#### Phase 2: Container Management (Week 3)

**Goal**: Migrate container spawning and IPC.

1. **Migrate**:
   - `container-runner.ts` → `container.clj`
   - IPC watcher → `ipc.clj` (using fswatcher pod)

2. **Test**: Spawn containers, handle stdin/stdout, parse output.

**Deliverable**: Can run agent containers from Babashka.

#### Phase 3: WhatsApp Bridge (Week 4-5)

**Goal**: Create nbb-based WhatsApp bridge.

1. **Create** `whatsapp-bridge.cljs`:
   ```clojure
   (ns whatsapp-bridge
     (:require ["@whiskeysockets/baileys" :as baileys]
               ["fs" :as fs]))

   ;; Connect to WhatsApp
   ;; Read commands from stdin (JSON)
   ;; Write events to stdout (JSON)
   ;; Commands: send-message, set-typing
   ;; Events: message-received, connection-update
   ```

2. **Integration**: Babashka spawns nbb bridge as subprocess.

**Deliverable**: Can send/receive WhatsApp messages via bridge.

#### Phase 4: Scheduler & Main Loop (Week 6)

**Goal**: Complete the migration.

1. **Migrate**:
   - `task-scheduler.ts` → `scheduler.clj`
   - `index.ts` main loop → `core.clj`

2. **Integration testing**: End-to-end message flow.

**Deliverable**: Fully functional Babashka-based NanoClaw.

#### Phase 5: Container Agent (Week 7-8, Optional)

**Goal**: Migrate container-side code.

**Note**: This is optional. The container agent can remain in TypeScript since it runs in isolation and the Claude Agent SDK is Node.js-based.

If migrating:
1. Use nbb inside container for ClojureScript
2. Implement MCP server using `modex` or `mcp-clj`

---

## Detailed Component Analysis

### Component: WhatsApp Client (CRITICAL PATH)

**Current**: `@whiskeysockets/baileys` - Pure JavaScript WebSocket implementation.

**Challenge**: No native Clojure WhatsApp library exists.

**Options**:

| Option | Pros | Cons |
|--------|------|------|
| **nbb + Baileys** | Full ClojureScript, npm interop | Requires nbb runtime, two runtimes |
| **Node subprocess** | Minimal change to WhatsApp code | IPC complexity, process management |
| **Pure Clojure websocket** | Single runtime | Would need to reimplement Baileys protocol (~10k lines) |

**Recommendation**: **nbb + Baileys** for cleanest Clojure integration.

```clojure
;; nbb bridge example
(ns whatsapp-bridge
  (:require ["@whiskeysockets/baileys" :refer [makeWASocket useMultiFileAuthState]]
            ["readline" :as readline]))

(defn start-bridge []
  (let [{:keys [state saveCreds]} (js/await (useMultiFileAuthState "auth"))
        sock (makeWASocket #js {:auth state :printQRInTerminal true})]

    ;; Handle incoming messages
    (.on (.-ev sock) "messages.upsert"
         (fn [event]
           (println (js/JSON.stringify #js {:type "messages" :data event}))))

    ;; Read commands from stdin
    (let [rl (.createInterface readline #js {:input js/process.stdin})]
      (.on rl "line"
           (fn [line]
             (let [cmd (js/JSON.parse line)]
               (case (.-type cmd)
                 "send" (.sendMessage sock (.-jid cmd) #js {:text (.-text cmd)})
                 "typing" (.sendPresenceUpdate sock (if (.-typing cmd) "composing" "paused") (.-jid cmd)))))))))
```

### Component: Database (LOW RISK)

**Current**: `better-sqlite3` - Synchronous SQLite bindings.

**Migration**: `pod-babashka-go-sqlite3` - Direct replacement.

```clojure
;; db.clj
(ns nanoclaw.db
  (:require [babashka.pods :as pods]
            [pod.babashka.go-sqlite3 :as sqlite]
            [nanoclaw.config :as config]))

(defn init-database []
  (sqlite/execute! config/db-path
    ["CREATE TABLE IF NOT EXISTS chats (
       jid TEXT PRIMARY KEY,
       name TEXT,
       last_message_time TEXT
     )"]))

(defn store-message [{:keys [id chat-jid sender content timestamp is-from-me]}]
  (sqlite/execute! config/db-path
    ["INSERT OR REPLACE INTO messages VALUES (?, ?, ?, ?, ?, ?)"
     id chat-jid sender content timestamp (if is-from-me 1 0)]))

(defn get-new-messages [jids last-timestamp bot-prefix]
  (when (seq jids)
    (let [placeholders (str/join "," (repeat (count jids) "?"))
          sql (str "SELECT * FROM messages WHERE timestamp > ? "
                   "AND chat_jid IN (" placeholders ") "
                   "AND content NOT LIKE ? ORDER BY timestamp")]
      (sqlite/query config/db-path
        (into [sql last-timestamp] (conj (vec jids) (str bot-prefix ":%")))))))
```

### Component: Container Runner (MEDIUM RISK)

**Current**: `child_process.spawn` with stdin/stdout pipes.

**Migration**: `babashka.process` - Excellent API, well-documented.

```clojure
;; container.clj
(ns nanoclaw.container
  (:require [babashka.process :as p]
            [cheshire.core :as json]
            [clojure.java.io :as io]
            [nanoclaw.config :as config]))

(def output-start-marker "---NANOCLAW_OUTPUT_START---")
(def output-end-marker "---NANOCLAW_OUTPUT_END---")

(defn build-container-args [mounts]
  (into ["container" "run" "-i" "--rm"]
        (mapcat (fn [{:keys [host-path container-path readonly]}]
                  (if readonly
                    ["--mount" (format "type=bind,source=%s,target=%s,readonly"
                                       host-path container-path)]
                    ["-v" (format "%s:%s" host-path container-path)]))
                mounts)))

(defn run-container-agent [group input]
  (let [mounts (build-volume-mounts group (:is-main input))
        args (conj (build-container-args mounts) config/container-image)
        proc (p/process args {:in :pipe :out :pipe :err :inherit})
        start-time (System/currentTimeMillis)]

    ;; Write input to stdin
    (with-open [w (io/writer (:in proc))]
      (.write w (json/generate-string input))
      (.flush w))

    ;; Wait with timeout
    (let [result (deref proc (:timeout config/container-config config/default-timeout) :timeout)]
      (if (= result :timeout)
        {:status "error" :error "Container timed out"}
        (let [stdout (slurp (:out proc))
              json-str (extract-between-markers stdout output-start-marker output-end-marker)]
          (json/parse-string json-str true))))))

(defn extract-between-markers [s start end]
  (let [start-idx (str/index-of s start)
        end-idx (str/index-of s end)]
    (when (and start-idx end-idx (< start-idx end-idx))
      (subs s (+ start-idx (count start)) end-idx))))
```

### Component: Task Scheduler (LOW-MEDIUM RISK)

**Current**: `setTimeout` loop with `cron-parser`.

**Migration**: `at-at` for scheduling, manual cron parsing.

```clojure
;; scheduler.clj
(ns nanoclaw.scheduler
  (:require [overtone.at-at :as at]
            [nanoclaw.db :as db]
            [nanoclaw.container :as container]
            [taoensso.timbre :as log])
  (:import [java.time LocalDateTime ZonedDateTime ZoneId]
           [java.time.format DateTimeFormatter]))

(def pool (at/mk-pool))

(defn parse-cron-field [field]
  (cond
    (= field "*") :any
    (str/starts-with? field "*/") {:every (parse-long (subs field 2))}
    :else (parse-long field)))

(defn parse-cron [expr]
  (let [[min hour dom month dow] (str/split expr #"\s+")]
    {:minute (parse-cron-field min)
     :hour (parse-cron-field hour)
     :day-of-month (parse-cron-field dom)
     :month (parse-cron-field month)
     :day-of-week (parse-cron-field dow)}))

(defn next-cron-time [cron-map from]
  ;; Implementation using java.time
  ...)

(defn run-task [task deps]
  (log/info "Running task" {:id (:id task)})
  (let [start (System/currentTimeMillis)
        group (get ((:registered-groups deps)) (:chat-jid task))
        result (container/run-container-agent group
                 {:prompt (:prompt task)
                  :group-folder (:group-folder task)
                  :chat-jid (:chat-jid task)
                  :is-main (= (:group-folder task) "main")
                  :is-scheduled-task true})]
    (db/log-task-run
      {:task-id (:id task)
       :run-at (java.time.Instant/now)
       :duration-ms (- (System/currentTimeMillis) start)
       :status (if (= (:status result) "success") "success" "error")
       :result (:result result)
       :error (:error result)})))

(defn check-due-tasks [deps]
  (doseq [task (db/get-due-tasks)]
    (run-task task deps)))

(defn start-scheduler-loop [deps]
  (log/info "Starting scheduler")
  (at/every 60000 #(check-due-tasks deps) pool))
```

### Component: IPC Watcher (LOW RISK)

**Current**: `fs.readdirSync` polling loop.

**Migration**: `pod-babashka-fswatcher` for event-based watching.

```clojure
;; ipc.clj
(ns nanoclaw.ipc
  (:require [babashka.pods :as pods]
            [pod.babashka.fswatcher :as fw]
            [babashka.fs :as fs]
            [cheshire.core :as json]
            [taoensso.timbre :as log]))

(defn process-ipc-file [path source-group is-main handlers]
  (try
    (let [data (json/parse-string (slurp path) true)]
      (case (:type data)
        "message" ((:on-message handlers) data source-group is-main)
        "schedule_task" ((:on-schedule handlers) data source-group is-main)
        "pause_task" ((:on-pause handlers) data source-group is-main)
        "resume_task" ((:on-resume handlers) data source-group is-main)
        "cancel_task" ((:on-cancel handlers) data source-group is-main)
        "register_group" ((:on-register handlers) data source-group is-main)
        (log/warn "Unknown IPC type" {:type (:type data)}))
      (fs/delete path))
    (catch Exception e
      (log/error "IPC processing error" {:path path :error (.getMessage e)})
      (fs/move path (fs/path (fs/parent path) ".." "errors" (fs/file-name path))))))

(defn start-ipc-watcher [ipc-base-dir handlers]
  (fw/watch ipc-base-dir
    (fn [{:keys [type path]}]
      (when (and (= type :create)
                 (str/ends-with? (str path) ".json"))
        (let [parts (str/split (str path) #"/")
              source-group (nth parts (- (count parts) 3))
              is-main (= source-group "main")]
          (process-ipc-file path source-group is-main handlers))))
    {:recursive true})
  (log/info "IPC watcher started"))
```

---

## Risk Assessment

### High Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| WhatsApp library compatibility | System won't connect | Use nbb bridge; keep Node fallback |
| Claude Agent SDK changes | Container agent breaks | Keep container in TypeScript |
| Performance degradation | Slower message handling | Profile, optimize hot paths |

### Medium Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| Cron parsing edge cases | Missed scheduled tasks | Port comprehensive tests |
| Process management complexity | Orphaned processes | Proper cleanup, process groups |
| State serialization differences | Data corruption | Version state files, migration |

### Low Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| SQLite API differences | Query failures | pod has similar API |
| JSON parsing differences | Parse errors | cheshire handles edge cases |
| Logging format changes | Log analysis breaks | Use structured logging |

---

## Recommendations

### Short-Term (Immediate)

1. **Keep container agent in TypeScript**: The Claude Agent SDK is Node.js-native. Migrating the container code provides minimal benefit.

2. **Start with hybrid architecture**: Use nbb for WhatsApp, Babashka for everything else. This is the path of least resistance.

3. **Maintain compatibility**: Keep the same data formats (JSON files, SQLite schema) to allow rollback.

### Medium-Term (Post-Migration)

1. **Consider pure-Babashka WhatsApp**: If nbb proves unstable, evaluate writing a minimal WhatsApp Web protocol implementation.

2. **Explore MCP in Clojure**: Once stable, consider migrating container MCP server to `modex` or `mcp-clj`.

3. **Add property-based testing**: Use `test.check` for schema validation and state transitions.

### Long-Term

1. **Evaluate GraalVM native-image**: Could compile Babashka scripts to native binaries for faster startup.

2. **Consider sci-based plugins**: Allow users to extend NanoClaw with Clojure scripts evaluated at runtime.

---

## Appendix A: Complete bb.edn Configuration

```clojure
{:paths ["src"]
 :deps {org.clojure/clojure {:mvn/version "1.11.1"}
        metosin/malli {:mvn/version "0.13.0"}
        cheshire/cheshire {:mvn/version "5.12.0"}
        com.taoensso/timbre {:mvn/version "6.3.1"}
        overtone/at-at {:mvn/version "1.2.0"}}
 :pods {org.babashka/go-sqlite3 {:version "0.3.13"}
        org.babashka/fswatcher {:version "0.0.5"}}
 :tasks
 {dev {:doc "Run in development mode"
       :task (shell "bb src/nanoclaw/core.clj")}

  test {:doc "Run tests"
        :task (shell "bb test/runner.clj")}

  whatsapp {:doc "Start WhatsApp bridge"
            :task (shell "npx nbb src/whatsapp_bridge.cljs")}}}
```

## Appendix B: File Structure After Migration

```
nanoclaw/
├── bb.edn                          # Babashka configuration
├── package.json                    # For nbb dependencies
├── src/
│   ├── nanoclaw/                   # Babashka (Clojure)
│   │   ├── core.clj                # Main entry point
│   │   ├── config.clj              # Configuration
│   │   ├── schemas.clj             # Malli schemas
│   │   ├── db.clj                  # SQLite operations
│   │   ├── container.clj           # Container runner
│   │   ├── scheduler.clj           # Task scheduler
│   │   ├── ipc.clj                 # IPC watcher
│   │   ├── mount_security.clj      # Mount validation
│   │   └── utils.clj               # Utilities
│   └── whatsapp_bridge.cljs        # nbb WhatsApp bridge
├── container/                      # Unchanged (TypeScript)
│   └── agent-runner/
├── groups/                         # Unchanged
├── store/                          # Unchanged
├── data/                           # Unchanged
└── docs/
    └── plans/
        └── 2026-02-02-babashka-migration-plan.md
```

---

## Appendix C: Estimated Effort

| Phase | Duration | FTEs | Deliverables |
|-------|----------|------|--------------|
| Phase 1: Core | 2 weeks | 1 | Schemas, DB, config |
| Phase 2: Container | 1 week | 1 | Container runner, IPC |
| Phase 3: WhatsApp | 2 weeks | 1 | nbb bridge, integration |
| Phase 4: Main Loop | 1 week | 1 | Scheduler, full integration |
| Phase 5: Container (Optional) | 2 weeks | 1 | MCP server in Clojure |

**Total**: 6-8 weeks for full migration (excluding optional Phase 5)

---

*End of Migration Plan*
