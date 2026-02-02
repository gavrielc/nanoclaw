# Tura: TypeScript to Clojure Migration Plan

*Named after Futamura projections - self-application of interpreters*

**Date**: 2026-02-02
**Updated**: 2026-02-02 (Telegram, JVM Clojure, containerized architecture)
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

This document outlines a plan to migrate NanoClaw from TypeScript/Node.js to **JVM Clojure** (renamed **Tura**), replacing WhatsApp with Telegram as the messaging platform.

**Key Decisions**:
1. **Telegram** replaces WhatsApp - Simple HTTP API, no complex WebSocket protocols
2. **JVM Clojure** instead of Babashka - Enables **nREPL for self-modification** and full library access
3. **Containerized Tura** - The Clojure process runs in a container for sandboxing, with a thin host launcher

### Why "Tura"?

Named after Yoshihiko Futamura, whose Futamura projections describe self-application of partial evaluators. Tura is a self-modifying system where agents can evolve their own code via nREPL - a form of computational self-application.

### Why JVM Clojure over Babashka?

| Aspect | Babashka | JVM Clojure |
|--------|----------|-------------|
| Startup time | ~10ms | ~3-5s (irrelevant for long-running service) |
| **nREPL** | Limited | **Full support - agent can modify running system** |
| **clojure-mcp** | Incompatible | **Native support - agent can add tools to itself** |
| Library access | Pods only | Full Maven/Clojars ecosystem |
| SQLite | Pod | Standard JDBC (next.jdbc) |
| core.async | No | Yes |
| Self-modification | No | **Yes - bot can evolve its own code** |

### Key Findings

| Component | Migration Path | Difficulty |
|-----------|---------------|------------|
| Telegram Client | clj-http or hato | **Low** |
| SQLite Database | next.jdbc + SQLite JDBC | Low |
| Container Runner | IPC to host launcher | Low |
| Task Scheduler | chime or quartzite | Low |
| IPC Watcher | hawk or directory-watcher | Low |
| JSON Handling | cheshire | Low |
| Schema Validation | malli | Low |
| **MCP Server** | **clojure-mcp** | **Low** |
| **nREPL** | **nrepl + cider-nrepl** | **Low** |

### Architecture: Containerized Self-Modifying System

```
┌─────────────────────────────────────────────────────────────────────┐
│  HOST (macOS) - Thin Launcher Only                                   │
│  • Watches IPC directory for container spawn requests               │
│  • Spawns containers via `container run`                            │
│  • Runs socat relay for container-to-container nREPL                │
│  • NO business logic, NO nREPL exposure on host                     │
├─────────────────────────────────────────────────────────────────────┤
│                      vmnet (192.168.64.0/24)                        │
│                               │                                      │
│          ┌────────────────────┴────────────────────┐                │
│          │                                          │                │
│  ┌───────┴───────┐                        ┌────────┴────────┐       │
│  │ TURA CONTAINER│                        │ AGENT CONTAINER │       │
│  │ (long-running)│                        │ (ephemeral)     │       │
│  │               │                        │                 │       │
│  │ • Telegram    │   ◀──────────────────  │ • Claude Agent  │       │
│  │ • SQLite      │   (via host relay)     │   SDK           │       │
│  │ • Scheduler   │                        │ • Connects to   │       │
│  │ • nREPL :7888 │                        │   192.168.64.1: │       │
│  │ • clojure-mcp │                        │   7888          │       │
│  │               │   Writes IPC files ──▶ │                 │       │
│  │               │   to shared volume     │                 │       │
│  └───────────────┘                        └─────────────────┘       │
└─────────────────────────────────────────────────────────────────────┘
```

**Container-to-container communication**: macOS 15 blocks direct container networking. Agent connects to `192.168.64.1:7888` (host), which relays via socat to Tura's nREPL.

**The agent can modify Tura's code via nREPL - but Tura is sandboxed in a container.**

---

## Current Architecture Overview

### Current (TypeScript + WhatsApp)

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

### Target (Tura: Containerized JVM Clojure)

```
┌─────────────────────────────────────────────────────────────────────┐
│  HOST (macOS) - THIN LAUNCHER ONLY (~100 lines)                     │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  launcher.clj (or shell script)                                 │ │
│  │  • Watches data/ipc/spawn/ for container spawn requests        │ │
│  │  • Spawns containers via `container run`                       │ │
│  │  • Runs socat: TCP-LISTEN:7888,bind=192.168.64.1 →            │ │
│  │               TCP:${TURA_IP}:7888                              │ │
│  │  • NO nREPL, NO business logic, NO Telegram                    │ │
│  └────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│                      vmnet (192.168.64.0/24)                        │
├─────────────────────────────────────────────────────────────────────┤
│  TURA CONTAINER (192.168.64.2) - Long-running JVM Clojure          │
│                                                                      │
│  ┌──────────────┐    ┌────────────────────┐    ┌───────────────┐   │
│  │  Telegram    │    │   SQLite Database  │    │  Registered   │   │
│  │  (clj-http)  │───▶│   (next.jdbc)      │    │  Groups EDN   │   │
│  └──────────────┘    └─────────┬──────────┘    └───────────────┘   │
│                                │                                    │
│  ┌──────────────────┐  ┌───────┴───────┐  ┌───────────────────┐   │
│  │  Long Polling    │  │  Scheduler    │  │  IPC Watcher      │   │
│  │  (30s timeout)   │  │  (chime)      │  │  (hawk)           │   │
│  └────────┬─────────┘  └───────┬───────┘  └─────────┬─────────┘   │
│           │                    │                    │              │
│  ┌────────┴────────────────────┴────────────────────┴────────┐     │
│  │  nREPL Server (:7888)  +  clojure-mcp                     │     │
│  │  • Live code modification (sandboxed in container)        │     │
│  │  • Agent can add/modify tools                             │     │
│  │  • Self-evolving system                                   │     │
│  └───────────────────────────────────────────────────────────┘     │
│                                │                                    │
│            Writes to data/ipc/spawn/ to request agent containers   │
├─────────────────────────────────────────────────────────────────────┤
│  AGENT CONTAINER (192.168.64.3+) - Ephemeral                       │
│                                                                      │
│  • Claude Agent SDK                                                 │
│  • Connects to 192.168.64.1:7888 (host relay → Tura nREPL)         │
│  • Can modify Tura via nREPL eval                                  │
│  • Communicates results via IPC files                              │
└─────────────────────────────────────────────────────────────────────┘
```

**Why containerize Tura?**
- nREPL is powerful - agent can eval arbitrary code
- Container sandboxes file system access
- Agent modifications can't escape to host system
- Apple Container provides VM-level isolation

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

// Registered chat/group (WhatsApp → Telegram)
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

### Direct Replacements (JVM Clojure)

| TypeScript | Clojure | Notes |
|------------|---------|-------|
| `better-sqlite3` | `next.jdbc` + SQLite JDBC | Standard JDBC, mature ecosystem |
| `zod` | `malli` | Data-driven schemas, excellent |
| `pino` | `taoensso.timbre` | Structured logging |
| `fs` | `clojure.java.io` + `me.raynes/fs` | Full filesystem access |
| `path` | `clojure.java.io` | Path operations |
| `child_process` | `clojure.java.shell` / `ProcessBuilder` | Full control |
| JSON parsing | `cheshire` | Fast, battle-tested |
| `cron-parser` | `chime` or `quartzite` | Full cron support |

### New Capabilities (JVM Clojure Only)

| Capability | Library | Notes |
|------------|---------|-------|
| **nREPL Server** | `nrepl` + `cider-nrepl` | **Agent can modify running system** |
| **MCP Server** | `clojure-mcp` | **Agent can add tools to itself** |
| Async channels | `core.async` | CSP-style concurrency |
| File watching | `hawk` or `nextjournal/beholder` | Native filesystem events |
| HTTP client | `clj-http` or `hato` | Full-featured HTTP |
| HTTP server | `ring` + `http-kit` | For webhooks if needed later |

### Telegram Bot API (clj-http)

```clojure
(ns nanoclaw.telegram
  (:require [clj-http.client :as http]
            [cheshire.core :as json]))

(def token (System/getenv "TELEGRAM_BOT_TOKEN"))
(def base-url (str "https://api.telegram.org/bot" token))

;; Send a message
(defn send-message [chat-id text]
  (-> (http/post (str base-url "/sendMessage")
        {:content-type :json
         :body (json/generate-string {:chat_id chat-id :text text})
         :as :json})
      :body))

;; Long polling for updates (30 second timeout)
(defn get-updates [offset]
  (-> (http/get (str base-url "/getUpdates")
        {:query-params (cond-> {:timeout 30}
                         offset (assoc :offset offset))
         :socket-timeout 35000
         :as :json})
      :body))

;; Typing indicator
(defn send-typing [chat-id]
  (http/post (str base-url "/sendChatAction")
    {:content-type :json
     :body (json/generate-string {:chat_id chat-id :action "typing"})}))

;; Message reactions (Bot API 7.0+)
(defn set-reaction [chat-id message-id emoji]
  (http/post (str base-url "/setMessageReaction")
    {:content-type :json
     :body (json/generate-string
             {:chat_id chat-id
              :message_id message-id
              :reaction [{:type "emoji" :emoji emoji}]})}))
```

### nREPL + Self-Modification (KEY FEATURE)

The agent can modify the running system via nREPL:

```clojure
(ns nanoclaw.repl
  (:require [nrepl.server :as nrepl]
            [cider.nrepl :refer [cider-nrepl-handler]]))

(defonce nrepl-server (atom nil))

(defn start-nrepl!
  "Start nREPL server. Agent can connect and modify running system."
  [port]
  (reset! nrepl-server
    (nrepl/start-server
      :port port
      :handler cider-nrepl-handler))
  (println "nREPL server started on port" port))

;; Agent can now:
;; 1. Connect to nREPL from container
;; 2. Evaluate (defn new-handler ...) to add new message handlers
;; 3. Evaluate (alter-var-root #'config ...) to change config
;; 4. Hot-reload any namespace with (require ... :reload)
```

### clojure-mcp Integration (SELF-EXTENDING)

The agent can add new tools to itself at runtime:

```clojure
(ns nanoclaw.mcp
  (:require [clojure-mcp.core :as mcp]))

(defonce mcp-server (atom nil))

(defn register-tool!
  "Agent can call this via nREPL to add new tools."
  [tool-name handler schema]
  (mcp/register-tool! @mcp-server
    {:name tool-name
     :handler handler
     :input-schema schema}))

;; Example: Agent adds a new tool to itself
;; (register-tool! "search_codebase"
;;   (fn [{:keys [query]}]
;;     (grep-codebase query))
;;   {:type "object"
;;    :properties {:query {:type "string"}}})
```

**Features supported**:
- ✅ Send/receive messages
- ✅ Group chat support
- ✅ Typing indicators
- ✅ Message reactions
- ✅ Long polling
- ✅ **nREPL self-modification**
- ✅ **Runtime tool registration**

### Library Details

#### SQLite: next.jdbc + SQLite JDBC

```clojure
(ns nanoclaw.db
  (:require [next.jdbc :as jdbc]
            [next.jdbc.sql :as sql]
            [next.jdbc.result-set :as rs]))

(def db-spec {:dbtype "sqlite" :dbname "data/nanoclaw.db"})
(def ds (jdbc/get-datasource db-spec))

;; Execute DDL
(jdbc/execute! ds ["CREATE TABLE IF NOT EXISTS chats (
                     jid TEXT PRIMARY KEY,
                     name TEXT,
                     last_message_time TEXT)"])

;; Query
(jdbc/execute! ds ["SELECT * FROM messages WHERE chat_jid = ?" jid]
  {:builder-fn rs/as-unqualified-kebab-maps})

;; Insert
(sql/insert! ds :messages {:id id :chat-jid jid :content content})

;; Transaction
(jdbc/with-transaction [tx ds]
  (sql/insert! tx :messages msg1)
  (sql/insert! tx :messages msg2))
```

#### Process Management: ProcessBuilder

```clojure
(ns nanoclaw.container
  (:require [clojure.java.io :as io]
            [cheshire.core :as json]
            [taoensso.timbre :as log])
  (:import [java.util.concurrent TimeUnit]))

(defn run-container
  "Spawn container with stdin/stdout pipes."
  [args input timeout-ms]
  (let [pb (ProcessBuilder. (into-array String args))
        _ (.redirectErrorStream pb false)
        process (.start pb)]

    ;; Write JSON to stdin
    (with-open [w (io/writer (.getOutputStream process))]
      (.write w (json/generate-string input))
      (.flush w))
    (.close (.getOutputStream process))

    ;; Wait with timeout
    (let [completed? (.waitFor process timeout-ms TimeUnit/MILLISECONDS)]
      (if completed?
        (let [stdout (slurp (.getInputStream process))
              exit-code (.exitValue process)]
          {:status (if (zero? exit-code) "success" "error")
           :stdout stdout
           :exit-code exit-code})
        (do
          (.destroyForcibly process)
          {:status "error" :error "Container timed out"})))))
```

#### File System Watching: hawk

```clojure
(ns nanoclaw.ipc
  (:require [hawk.core :as hawk]
            [clojure.string :as str]
            [taoensso.timbre :as log]))

(defonce watcher (atom nil))

(defn start-watching! [ipc-dir handler]
  (reset! watcher
    (hawk/watch! [{:paths [ipc-dir]
                   :filter hawk/file?
                   :handler (fn [ctx {:keys [kind file]}]
                              (when (and (= kind :create)
                                         (str/ends-with? (.getName file) ".json"))
                                (handler file))
                              ctx)}]))
  (log/info "IPC watcher started on" ipc-dir))

(defn stop-watching! []
  (when @watcher
    (hawk/stop! @watcher)
    (reset! watcher nil)))
```

#### Validation: Malli

```clojure
(ns nanoclaw.schemas
  (:require [malli.core :as m]
            [malli.error :as me]
            [malli.transform :as mt]))

(def Message
  [:map
   [:id :string]
   [:chat-id :int]
   [:from-name :string]
   [:text :string]
   [:timestamp :int]])

(m/validate Message data)  ; => true/false
(me/humanize (m/explain Message bad-data))  ; => error messages

;; Coercion for API responses
(def coerce-message
  (m/coercer Message mt/json-transformer))

(coerce-message {"id" "123" "chat-id" "456"})
;; => {:id "123" :chat-id 456}
```

#### Scheduling: chime (Full cron support)

```clojure
(ns nanoclaw.scheduler
  (:require [chime.core :as chime]
            [chime.core-async :refer [chime-ch]]
            [clojure.core.async :as a]
            [tick.core :as t])
  (:import [java.time Instant Duration]))

;; Run every 60 seconds
(def scheduler
  (chime/chime-at
    (chime/periodic-seq (Instant/now) (Duration/ofSeconds 60))
    (fn [time]
      (check-due-tasks time))))

;; Cron-style scheduling with tick
(defn next-cron-time
  "Parse cron and get next execution time."
  [cron-expr]
  ;; Use tick for date-time arithmetic
  (let [[min hour dom month dow] (str/split cron-expr #"\s+")]
    ;; ... implementation using tick
    ))

;; One-time scheduled task
(chime/chime-at
  [(-> (Instant/now) (.plusSeconds 3600))]  ; 1 hour from now
  (fn [_] (run-task task-id)))

;; Stop scheduler
(.close scheduler)
```

#### core.async (Concurrency)

```clojure
(ns nanoclaw.core
  (:require [clojure.core.async :as a :refer [<! >! go go-loop chan]]))

;; Message processing pipeline
(def message-chan (chan 100))

(go-loop []
  (when-let [msg (<! message-chan)]
    (process-message msg)
    (recur)))

;; Telegram polling in separate go block
(go
  (telegram/start-polling
    (fn [msg]
      (a/>!! message-chan msg))))
```

---

## Migration Strategy

### Recommended Approach: Containerized Tura with Thin Host Launcher

Tura runs in a container for security (sandboxed nREPL). A thin launcher on the host handles container spawning since Apple Container doesn't support nested containers.

```
┌─────────────────────────────────────────────────────────────────────┐
│  HOST (macOS) - Thin Launcher                                        │
│  • bb launcher.clj OR shell script                                  │
│  • Watches IPC, spawns containers, runs socat relay                 │
│  • ~100 lines, no business logic                                    │
├─────────────────────────────────────────────────────────────────────┤
│                         vmnet bridge                                 │
├─────────────────────────────────────────────────────────────────────┤
│  TURA CONTAINER (JVM Clojure)                                       │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  • Telegram Bot API (clj-http)                                │  │
│  │  • SQLite database (next.jdbc)                                │  │
│  │  • Task scheduling (chime)                                     │  │
│  │  • IPC file watching (hawk)                                   │  │
│  │  • Mount security validation                                   │  │
│  │  • State management (atoms)                                   │  │
│  │                                                                │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │  nREPL (:7888) - Agent can modify running system        │  │  │
│  │  │  clojure-mcp   - Agent can add tools to itself          │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  │                                                                │  │
│  │  Writes spawn requests to data/ipc/spawn/*.json               │  │
│  └───────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────┤
│  AGENT CONTAINER (spawned by host launcher)                         │
│  • Connects to 192.168.64.1:7888 → socat → Tura nREPL              │
└─────────────────────────────────────────────────────────────────────┘
```

### Container-to-Container Communication

macOS 15 (Sequoia) does not allow direct container-to-container networking. Solution:

```bash
# Host runs socat relay (started by launcher)
socat TCP-LISTEN:7888,fork,bind=192.168.64.1 TCP:192.168.64.2:7888
```

Agent connects to `192.168.64.1:7888` (host gateway), which relays to Tura's nREPL.

**macOS 26 (Tahoe)**: Direct container networking supported; socat not needed.

### Thin Host Launcher Implementation

```clojure
#!/usr/bin/env bb
;; launcher.clj - Thin host-side launcher (~100 lines)
;; Only job: watch IPC, spawn containers, relay nREPL

(ns launcher
  (:require [babashka.process :as p]
            [babashka.fs :as fs]
            [cheshire.core :as json]))

(def tura-ip (atom nil))
(def ipc-dir "data/ipc/spawn")

;; Start Tura container
(defn start-tura! []
  (let [proc (p/process
               ["container" "run" "-d"
                "-v" "data:/workspace/data"
                "-v" "groups:/workspace/groups"
                "-p" "7888:7888"
                "tura:latest"])]
    ;; Get Tura's IP
    (reset! tura-ip (get-container-ip "tura"))
    (start-socat-relay! @tura-ip)))

;; Relay nREPL traffic from 192.168.64.1 to Tura
(defn start-socat-relay! [tura-ip]
  (p/process
    ["socat"
     "TCP-LISTEN:7888,fork,bind=192.168.64.1,reuseaddr"
     (str "TCP:" tura-ip ":7888")]
    {:out :inherit :err :inherit}))

;; Watch for spawn requests from Tura
(defn watch-spawn-requests! []
  (fs/create-dirs ipc-dir)
  (loop []
    (doseq [f (fs/list-dir ipc-dir)]
      (when (str/ends-with? (str f) ".json")
        (let [req (json/parse-string (slurp f) true)]
          (spawn-agent-container! req)
          (fs/delete f))))
    (Thread/sleep 1000)
    (recur)))

;; Spawn agent container per Tura's request
(defn spawn-agent-container! [{:keys [image mounts env input]}]
  (let [args (into ["container" "run" "-i" "--rm"]
                   (concat
                     (mapcat (fn [[h c]] ["-v" (str h ":" c)]) mounts)
                     (mapcat (fn [[k v]] ["-e" (str k "=" v)]) env)
                     [image]))]
    (p/process args {:in input :out :pipe :err :inherit})))

(defn -main []
  (start-tura!)
  (watch-spawn-requests!))
```

### Migration Phases

#### Phase 0: Thin Launcher (Week 0.5)

**Goal**: Create minimal host-side launcher that can spawn containers.

1. **Implement** `launcher.clj` (Babashka script, ~100 lines):
   - Watch `data/ipc/spawn/` for JSON requests
   - Spawn Tura container on startup
   - Start socat relay for nREPL
   - Spawn agent containers on request

2. **Test**: Launcher starts Tura, Tura requests agent spawn, agent runs.

**Deliverable**: Host can orchestrate containers without business logic.

#### Phase 1: Core Infrastructure (Week 1)

**Goal**: Set up Clojure project structure and migrate stateless components.

1. **Project Setup**
   ```
   nanoclaw/
   ├── deps.edn              # Clojure dependencies
   ├── src/
   │   └── nanoclaw/
   │       ├── core.clj       # Main entry point
   │       ├── config.clj     # Configuration
   │       ├── schemas.clj    # Malli schemas
   │       ├── db.clj         # SQLite operations (next.jdbc)
   │       ├── telegram.clj   # Telegram Bot API client
   │       ├── container.clj  # Container runner
   │       ├── scheduler.clj  # Task scheduler (chime)
   │       ├── ipc.clj        # IPC watcher (hawk)
   │       ├── repl.clj       # nREPL server
   │       ├── mcp.clj        # clojure-mcp integration
   │       ├── mount_security.clj
   │       └── utils.clj
   └── test/
   ```

2. **Migrate**:
   - `config.ts` → `config.clj`
   - `types.ts` → `schemas.clj` (Malli)
   - `utils.ts` → `utils.clj`
   - `db.ts` → `db.clj` (next.jdbc + SQLite JDBC)
   - `mount-security.ts` → `mount_security.clj`

**Deliverable**: Database operations working, all schemas defined.

#### Phase 2: Telegram Client + nREPL (Week 2)

**Goal**: Implement Telegram Bot API client and nREPL server.

1. **Create** `telegram.clj`:
   ```clojure
   (ns nanoclaw.telegram
     (:require [clj-http.client :as http]
               [cheshire.core :as json]))

   (defn send-message [chat-id text] ...)
   (defn get-updates [offset] ...)
   (defn send-typing [chat-id] ...)
   (defn start-polling [handler] ...)
   ```

2. **Create** `repl.clj`:
   ```clojure
   (ns nanoclaw.repl
     (:require [nrepl.server :as nrepl]))

   (defn start-nrepl! [port] ...)
   ```

3. **Test**: Send/receive messages, connect via CIDER/Calva.

**Deliverable**: Telegram working, nREPL accessible.

#### Phase 3: Container Management + clojure-mcp (Week 3)

**Goal**: Migrate container spawning and set up clojure-mcp.

1. **Migrate**:
   - `container-runner.ts` → `container.clj` (ProcessBuilder)
   - IPC watcher → `ipc.clj` (hawk)

2. **Add** `mcp.clj`:
   ```clojure
   (ns nanoclaw.mcp
     (:require [clojure-mcp.core :as mcp]))

   (defn start-mcp-server! [] ...)
   (defn register-tool! [name handler schema] ...)
   ```

3. **Test**: Spawn containers, register MCP tools dynamically.

**Deliverable**: Containers running, MCP tools registerable at runtime.

#### Phase 4: Scheduler & Main Loop (Week 4)

**Goal**: Complete the migration.

1. **Migrate**:
   - `task-scheduler.ts` → `scheduler.clj` (chime)
   - `index.ts` main loop → `core.clj`

2. **Integration testing**: End-to-end message flow.

3. **Self-modification test**: Agent modifies its own behavior via nREPL.

**Deliverable**: Fully functional, self-modifying NanoClaw.

#### Phase 5: Agent Self-Evolution (Week 5)

**Goal**: Enable agent to modify host system from container.

1. **Container nREPL client**: Agent connects to host nREPL
2. **Safe eval boundaries**: Define what agent can/cannot modify
3. **Persistence**: Agent-created modifications persist across restarts

**Deliverable**: Agent can evolve NanoClaw's capabilities.

---

## Detailed Component Analysis

### Component: Telegram Client (LOW RISK - Replaces WhatsApp)

**Current**: `@whiskeysockets/baileys` - Pure JavaScript WebSocket implementation for WhatsApp.

**Migration**: Telegram Bot API via `clj-http` - **Direct HTTP calls, mature Clojure library.**

**Why Telegram is easier**:
- HTTP/JSON API (no WebSocket protocol to implement)
- Official, documented, stable API
- Long polling works without webhooks
- No authentication complexity (just a bot token)

```clojure
;; telegram.clj - Full implementation
(ns nanoclaw.telegram
  (:require [clj-http.client :as http]
            [cheshire.core :as json]
            [taoensso.timbre :as log]))

(def token (System/getenv "TELEGRAM_BOT_TOKEN"))
(def base-url (str "https://api.telegram.org/bot" token))

(defn api-call [method params]
  (-> (http/post (str base-url "/" method)
        {:content-type :json
         :body (json/generate-string params)
         :as :json
         :throw-exceptions false})
      :body))

(defn send-message [chat-id text]
  (api-call "sendMessage" {:chat_id chat-id :text text}))

(defn send-typing [chat-id]
  (api-call "sendChatAction" {:chat_id chat-id :action "typing"}))

(defn get-updates
  "Long polling with 30 second timeout"
  [offset]
  (-> (http/get (str base-url "/getUpdates")
        {:query-params (cond-> {:timeout 30}
                         offset (assoc :offset offset))
         :socket-timeout 35000
         :as :json
         :throw-exceptions false})
      :body))

(defn extract-message [update]
  (when-let [msg (:message update)]
    {:update-id (:update_id update)
     :chat-id (get-in msg [:chat :id])
     :chat-type (get-in msg [:chat :type])
     :chat-title (get-in msg [:chat :title])
     :from-id (get-in msg [:from :id])
     :from-name (or (get-in msg [:from :first_name])
                    (get-in msg [:from :username]))
     :text (:text msg)
     :message-id (:message_id msg)
     :timestamp (:date msg)}))

(defn start-polling
  "Start long-polling loop. Calls handler for each message."
  [handler]
  (log/info "Starting Telegram long-polling")
  (loop [offset nil]
    (let [{:keys [ok result]} (get-updates offset)]
      (when ok
        (doseq [update result]
          (when-let [msg (extract-message update)]
            (try
              (handler msg)
              (catch Exception e
                (log/error e "Error handling message")))))
        (recur (when (seq result)
                 (inc (:update_id (last result)))))))))
```

**Comparison**:

| Aspect | WhatsApp (baileys) | Telegram Bot API |
|--------|-------------------|------------------|
| Protocol | WebSocket + custom | HTTP/JSON |
| Auth | QR code scan | Bot token (string) |
| Library needed | Yes (baileys) | clj-http (standard) |
| Clojure support | None | Native |
| Complexity | High | Low |

### Component: nREPL + Self-Modification (NEW - KEY FEATURE)

**Purpose**: Allow the agent to modify the running NanoClaw system.

```clojure
;; repl.clj
(ns nanoclaw.repl
  (:require [nrepl.server :as nrepl]
            [cider.nrepl :refer [cider-nrepl-handler]]
            [taoensso.timbre :as log]))

(defonce server (atom nil))

(defn start!
  "Start nREPL server on specified port."
  [port]
  (when-not @server
    (reset! server
      (nrepl/start-server
        :port port
        :handler cider-nrepl-handler))
    (log/info "nREPL server started on port" port)))

(defn stop! []
  (when @server
    (nrepl/stop-server @server)
    (reset! server nil)
    (log/info "nREPL server stopped")))
```

**What the agent can do via nREPL**:
1. **Add new message handlers**: `(defn handle-weather [msg] ...)`
2. **Modify configuration**: `(swap! config assoc :trigger "@NewBot")`
3. **Register new MCP tools**: `(mcp/register-tool! "weather" ...)`
4. **Hot-reload namespaces**: `(require 'nanoclaw.telegram :reload)`
5. **Inspect state**: `@registered-groups`, `@sessions`

### Component: clojure-mcp (NEW - SELF-EXTENDING)

**Purpose**: Agent can add new tools to itself at runtime.

```clojure
;; mcp.clj
(ns nanoclaw.mcp
  (:require [clojure-mcp.core :as mcp]
            [taoensso.timbre :as log]))

(defonce server (atom nil))
(defonce tools (atom {}))

(defn register-tool!
  "Register a new MCP tool. Can be called by agent via nREPL."
  [tool-name description handler input-schema]
  (swap! tools assoc tool-name
    {:name tool-name
     :description description
     :handler handler
     :inputSchema input-schema})
  (log/info "Registered MCP tool:" tool-name))

(defn start! []
  ;; Initialize with base tools
  (register-tool! "send_message"
    "Send a Telegram message"
    (fn [{:keys [chat_id text]}]
      (telegram/send-message chat_id text))
    {:type "object"
     :properties {:chat_id {:type "integer"}
                  :text {:type "string"}}
     :required ["chat_id" "text"]})

  ;; Start MCP server
  (reset! server (mcp/start-server {:tools @tools}))
  (log/info "MCP server started"))

;; Example: Agent adds a new tool to itself via nREPL
;; (mcp/register-tool! "search_codebase"
;;   "Search the codebase for a pattern"
;;   (fn [{:keys [pattern]}]
;;     (shell/sh "grep" "-r" pattern "src/"))
;;   {:type "object"
;;    :properties {:pattern {:type "string"}}
;;    :required ["pattern"]})
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
| Agent self-modification abuse | System instability | Sandboxed eval, audit logging |

### Medium Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| nREPL security exposure | Unauthorized access | Bind to localhost only, auth tokens |
| JVM memory usage | Higher than Node.js | Tune JVM heap, monitor usage |
| Telegram API rate limits | Messages blocked | Implement backoff, queue messages |
| Process management complexity | Orphaned processes | Proper cleanup, process groups |

### Low Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| Telegram API connectivity | HTTP calls fail | clj-http retry, error handling |
| SQLite API differences | Query failures | next.jdbc is mature, well-tested |
| JSON parsing differences | Parse errors | cheshire handles edge cases |
| JVM startup time | Slow restarts | Irrelevant for long-running service |

### New Risks (Self-Modification)

| Risk | Impact | Mitigation |
|------|--------|------------|
| Unintended code changes | System breaks | Persist changes to files, rollback |
| Runaway modifications | Resource exhaustion | Rate limit nREPL evals |
| Breaking changes persist | Can't restart | Separate "core" from "extensions" |

### Mitigation: Safe Self-Modification

```clojure
;; Only allow modifications to specific namespaces
(def modifiable-namespaces
  #{'nanoclaw.extensions
    'nanoclaw.custom-handlers
    'nanoclaw.custom-tools})

(defn safe-eval [form]
  (let [ns-sym (first form)]
    (when (and (= 'in-ns (first form))
               (not (modifiable-namespaces (second form))))
      (throw (ex-info "Cannot modify protected namespace"
               {:namespace (second form)})))))
```

### Eliminated Risks (WhatsApp → Telegram, Babashka → JVM Clojure)

| Eliminated Risk | Why |
|-----------------|-----|
| WhatsApp library compatibility | Telegram uses simple HTTP API |
| Hybrid architecture complexity | Pure JVM Clojure, single runtime |
| nbb runtime stability | Not needed |
| WebSocket protocol issues | HTTP only |
| QR code authentication | Bot token (string) |
| Babashka pod limitations | Full JVM library access |

---

## Recommendations

### Short-Term (Immediate)

1. **Use JVM Clojure**: Full library access, nREPL for self-modification, mature ecosystem.

2. **Start nREPL on startup**: Always run with nREPL server for development and agent self-modification.

3. **Telegram Bot API**: Create a BotFather bot, get token, start building.

4. **Maintain compatibility**: Keep the same SQLite schema to allow rollback.

### Medium-Term (Post-Migration)

1. **Implement clojure-mcp**: Allow agent to register new tools at runtime.

2. **Add property-based testing**: Use `test.check` for schema validation and state transitions.

3. **Implement message queuing**: Handle Telegram rate limits gracefully with core.async channels.

4. **Agent persistence**: Save agent-created modifications to files for restart persistence.

### Long-Term

1. **Self-evolving system**: Agent learns from usage patterns and optimizes its own handlers.

2. **Multi-platform support**: Add Discord, Slack via similar HTTP clients (agent could add these itself).

3. **Distributed agents**: Multiple containers can connect to same nREPL for coordinated evolution.

4. **GraalVM native-image**: Consider for faster startup if needed (loses some dynamic capabilities).

### Development Workflow

```bash
# Terminal 1: Start the launcher (spawns Tura + socat)
bb launcher.clj

# Terminal 2: Connect CIDER/Calva to Tura's nREPL
# From host: connect to 192.168.64.1:7888 (via socat)
# Or: container exec into Tura and connect locally

# Hot reload during development (from nREPL)
(require 'tura.telegram :reload)

# Agent connects from its container
(nrepl/connect :host "192.168.64.1" :port 7888)
```

### Container Communication Flow

```
1. User sends Telegram message
2. Tura (container) receives via long-polling
3. Tura writes spawn request to data/ipc/spawn/req-123.json
4. Launcher (host) sees file, spawns Agent container
5. Agent runs, connects to 192.168.64.1:7888 (socat relay)
6. Agent modifies Tura via nREPL if needed
7. Agent writes result to data/ipc/messages/resp-123.json
8. Tura reads response, sends to Telegram
```

---

## Appendix A: Complete deps.edn Configuration

```clojure
{:paths ["src" "resources"]

 :deps
 {org.clojure/clojure          {:mvn/version "1.12.0"}
  org.clojure/core.async       {:mvn/version "1.6.681"}

  ;; HTTP
  clj-http/clj-http            {:mvn/version "3.12.3"}
  cheshire/cheshire            {:mvn/version "5.13.0"}

  ;; Database
  com.github.seancorfield/next.jdbc {:mvn/version "1.3.909"}
  org.xerial/sqlite-jdbc       {:mvn/version "3.45.1.0"}

  ;; Validation
  metosin/malli                {:mvn/version "0.14.0"}

  ;; Logging
  com.taoensso/timbre          {:mvn/version "6.5.0"}

  ;; Scheduling
  jarohen/chime                {:mvn/version "0.3.3"}
  tick/tick                    {:mvn/version "0.7.5"}

  ;; File watching
  hawk/hawk                    {:mvn/version "0.2.11"}

  ;; nREPL
  nrepl/nrepl                  {:mvn/version "1.1.1"}
  cider/cider-nrepl            {:mvn/version "0.47.1"}

  ;; MCP (check for latest clojure-mcp version)
  ;; com.github.bhauman/clojure-mcp {:mvn/version "0.1.0"}
  }

 :aliases
 {:dev
  {:extra-paths ["dev"]
   :extra-deps {djblue/portal {:mvn/version "0.55.1"}}}

  :test
  {:extra-paths ["test"]
   :extra-deps {lambdaisland/kaocha {:mvn/version "1.88.1376"}}}

  :build
  {:deps {io.github.clojure/tools.build {:mvn/version "0.9.6"}}
   :ns-default build}

  :uberjar
  {:main-opts ["-m" "build" "uber"]}}}
```

**Run commands**:
```bash
clj -M -m nanoclaw.core              # Run app
clj -M:dev -m nanoclaw.core          # Run with dev tools
clj -M:test -m kaocha.runner         # Run tests
clj -T:build uber                     # Build uberjar
```

## Appendix B: File Structure After Migration

```
tura/
├── launcher.clj                    # Babashka thin launcher (HOST ONLY)
├── deps.edn                        # Clojure dependencies (for Tura container)
├── Dockerfile.tura                 # Tura container image
├── Dockerfile.agent                # Agent container image
│
├── src/
│   └── tura/
│       ├── core.clj                # Main entry point + main loop
│       ├── config.clj              # Configuration (env vars, defaults)
│       ├── schemas.clj             # Malli schemas
│       ├── db.clj                  # SQLite operations (next.jdbc)
│       ├── telegram.clj            # Telegram Bot API client
│       ├── spawn.clj               # Request agent spawns via IPC
│       ├── scheduler.clj           # Task scheduler (chime)
│       ├── ipc.clj                 # IPC watcher (hawk)
│       ├── repl.clj                # nREPL server
│       ├── mcp.clj                 # clojure-mcp integration
│       ├── mount_security.clj      # Mount validation
│       └── utils.clj               # Utilities
├── dev/
│   └── user.clj                    # REPL helpers, dev utilities
├── test/
│   └── tura/
│       ├── telegram_test.clj
│       ├── db_test.clj
│       └── ...
├── resources/
│   └── logback.xml                 # Logging config (optional)
│
├── container/                      # Agent runner (can stay TypeScript)
│   └── agent-runner/
│       └── src/
│           ├── index.ts            # Agent entry point
│           └── nrepl-client.ts     # Connect to Tura's nREPL
│
├── groups/                         # Per-group memory (mounted to containers)
├── data/
│   ├── tura.db                     # SQLite database
│   ├── sessions/                   # Claude sessions
│   ├── ipc/
│   │   ├── spawn/                  # Agent spawn requests (Tura → Launcher)
│   │   ├── messages/               # Message IPC (Agent → Tura)
│   │   └── tasks/                  # Task IPC (Agent → Tura)
│   └── env/                        # Environment files
│
├── launchd/
│   └── com.tura.launcher.plist     # launchd config for launcher
│
└── docs/
    └── plans/
        └── 2026-02-02-tura-migration-plan.md
```

**Architecture**:
- `launcher.clj` - Runs on HOST (Babashka), spawns containers
- `src/tura/` - Runs in TURA CONTAINER (JVM Clojure)
- `container/agent-runner/` - Runs in AGENT CONTAINERS (Node.js or Clojure)

**Key features**:
- `spawn.clj` - Writes to `data/ipc/spawn/` to request agent containers
- `repl.clj` - nREPL server (sandboxed in container)
- `nrepl-client.ts` - Agent connects to Tura via `192.168.64.1:7888`

---

## Appendix C: Estimated Effort

| Phase | Duration | FTEs | Deliverables |
|-------|----------|------|--------------|
| Phase 1: Core Infrastructure | 1 week | 1 | Schemas, DB, config, utils |
| Phase 2: Telegram + nREPL | 1 week | 1 | HTTP client, long polling, nREPL server |
| Phase 3: Container + MCP | 1 week | 1 | Container runner, IPC watcher, clojure-mcp |
| Phase 4: Main Loop | 1 week | 1 | Scheduler, full integration |
| Phase 5: Self-Evolution | 1 week | 1 | Agent can modify host via nREPL |

**Total**: 5 weeks for full migration (including self-modification capabilities)

### Comparison: Migration Approaches

| Approach | Estimated Time | Complexity | Self-Modification |
|----------|---------------|------------|-------------------|
| WhatsApp + Babashka | 6-8 weeks | High (hybrid) | No |
| Telegram + Babashka | 4 weeks | Low | No |
| **Telegram + JVM Clojure** | **5 weeks** | **Low** | **Yes (nREPL)** |

**Added value**: +1 week for nREPL/MCP gives self-modifying capabilities.

## Appendix D: Self-Modification Examples

### Example 1: Agent adds a new command handler

```clojure
;; Agent evaluates this via nREPL connection:
(in-ns 'nanoclaw.core)

(defmethod handle-command :weather
  [{:keys [chat-id args]}]
  (let [location (first args)
        weather (fetch-weather location)]
    (telegram/send-message chat-id
      (format "Weather in %s: %s" location weather))))

(log/info "Added /weather command handler")
```

### Example 2: Agent modifies its trigger pattern

```clojure
;; Agent evaluates via nREPL:
(swap! nanoclaw.config/config
  assoc :trigger-pattern #"(?i)^@?(claude|assistant)\b")

(log/info "Updated trigger pattern")
```

### Example 3: Agent adds a new MCP tool

```clojure
;; Agent evaluates via nREPL:
(nanoclaw.mcp/register-tool!
  "search_messages"
  "Search past messages in the database"
  (fn [{:keys [query limit]}]
    (nanoclaw.db/search-messages query (or limit 10)))
  {:type "object"
   :properties {:query {:type "string"}
                :limit {:type "integer"}}
   :required ["query"]})
```

### Example 4: Agent persists its modifications

```clojure
;; Agent saves its modifications to a file for persistence:
(spit "src/nanoclaw/extensions.clj"
  (pr-str
    {:handlers @custom-handlers
     :tools @custom-tools
     :config-overrides @config-overrides}))

;; On startup, load persisted extensions:
(when (.exists (io/file "src/nanoclaw/extensions.clj"))
  (load-extensions! (read-string (slurp "src/nanoclaw/extensions.clj"))))
```

---

*End of Migration Plan*
