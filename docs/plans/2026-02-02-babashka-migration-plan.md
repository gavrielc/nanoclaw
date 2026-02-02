# braainet: TypeScript to Clojure Migration Plan

*A self-evolving AI agent system with git-based tool evolution*

**Date**: 2026-02-02
**Updated**: 2026-02-02 (braainet architecture, git-based tool evolution)
**Author**: Claude
**Status**: Planning Phase

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Naming & Metaphor](#naming--metaphor)
3. [Architecture Overview](#architecture-overview)
4. [Git-Based Tool Evolution](#git-based-tool-evolution)
5. [Data Structures & Interfaces](#data-structures--interfaces)
6. [Function Signatures](#function-signatures)
7. [Library Mapping](#library-mapping)
8. [Migration Strategy](#migration-strategy)
9. [Risk Assessment](#risk-assessment)
10. [Recommendations](#recommendations)

---

## Executive Summary

This document outlines a plan to migrate NanoClaw from TypeScript/Node.js to **braainet**, a self-evolving JVM Clojure system.

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Messaging | **Telegram** | Simple HTTP API, no WebSocket complexity |
| Runtime | **JVM Clojure** (all components) | nREPL + clojure-mcp for self-modification |
| Tool schema | **Git-based evolution** | Braaiers clone, modify, propose PRs |
| Fast startup | **Pre-warmed JVM pool** | ~100ms claim time vs 3-5s cold start |

### Architecture Summary

```
┌─────────────────────────────────────────────────────────────────────┐
│  macOS HOST                                                          │
│                                                                      │
│  BRAAIMASTER (JVM Clojure, long-running)                            │
│  • Spawns tong master container on startup                          │
│  • Maintains pre-warmed braaier pool (2-3 idle JVMs)               │
│  • socat relay for container networking                             │
│  • Checkpoints tools repo, rollback on failure                      │
├─────────────────────────────────────────────────────────────────────┤
│  TONG MASTER CONTAINER (JVM Clojure + nREPL)                        │
│  • Telegram, SQLite, Scheduler                                      │
│  • Maintains tools repo ("tongs")                                   │
│  • nREPL :7888 + clojure-mcp                                        │
│  • Reviews braaier PRs, decides what to merge                       │
├─────────────────────────────────────────────────────────────────────┤
│  BRAAIER CONTAINERS (JVM Clojure + nREPL, ephemeral)               │
│  • Claim from pre-warmed pool (~100ms)                              │
│  • Clone tools repo on startup                                      │
│  • clojure-mcp with full tool access                                │
│  • Propose new tools via git PR mechanism                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Naming & Metaphor

The system is named **braainet** (a Skynet joke for someone who likes to braai).

### Components

| Component | Name | Role |
|-----------|------|------|
| Project | **braainet** | The entire system |
| Host orchestrator | **braaimaster** | Manages the braai (spawns containers, checkpoints) |
| Main container | **tong master** | Hands out tongs (tools) to braaiers |
| Sub-agents | **braaiers** | Do the actual cooking (execute tasks) |
| Tools | **tongs** | What braaiers use to work |
| Tools repo | **tong rack** | Git repo storing all tools |

### Status Metaphors

| Status | Phrase |
|--------|--------|
| Agent started | "the braai has been started" |
| Agent working | "the food is cooking" |
| In progress | "the coals are almost ready" |
| Task done | "the meat is ready" |

---

## Architecture Overview

### Current (TypeScript + WhatsApp)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        HOST (macOS)                                  │
│                   (Single Node.js Process)                          │
├─────────────────────────────────────────────────────────────────────┤
│  WhatsApp (baileys) → SQLite → Message Loop → Container Runner      │
├─────────────────────────────────────────────────────────────────────┤
│                  APPLE CONTAINER (Linux VM)                         │
│  Agent Runner (Node.js) + Claude Agent SDK + IPC MCP Server        │
└─────────────────────────────────────────────────────────────────────┘
```

### Target (braainet)

```
┌─────────────────────────────────────────────────────────────────────┐
│  macOS HOST                                                          │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  BRAAIMASTER (JVM Clojure, long-running)                       │ │
│  │                                                                 │ │
│  │  ┌───────────────────┐  ┌───────────────────────────────────┐  │ │
│  │  │  Container        │  │  Pre-warmed Braaier Pool          │  │ │
│  │  │  Orchestration    │  │  • 2-3 warm JVMs ready            │  │ │
│  │  │  • Spawn tong     │  │  • Claim time: ~100ms             │  │ │
│  │  │    master         │  │  • Replenish after claim          │  │ │
│  │  │  • Spawn braaiers │  └───────────────────────────────────┘  │ │
│  │  └───────────────────┘                                          │ │
│  │                                                                 │ │
│  │  ┌───────────────────┐  ┌───────────────────────────────────┐  │ │
│  │  │  socat Relay      │  │  Checkpoint Manager               │  │ │
│  │  │  • 192.168.64.1   │  │  • git tag checkpoints            │  │ │
│  │  │    :7888 → tong   │  │  • Rollback on tool failure       │  │ │
│  │  │    master :7888   │  │  • Verify tools work              │  │ │
│  │  └───────────────────┘  └───────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│                      vmnet (192.168.64.0/24)                        │
├─────────────────────────────────────────────────────────────────────┤
│  TONG MASTER CONTAINER (192.168.64.2)                               │
│  JVM Clojure, long-running                                          │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  Telegram    │  │  SQLite      │  │  Scheduler (chime)       │  │
│  │  (clj-http)  │  │  (next.jdbc) │  │                          │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  TONG RACK (tools git repo)                                    │ │
│  │  • /workspace/data/tools.git (bare repo)                       │ │
│  │  • /workspace/tongs/ (working tree)                            │ │
│  │  • Hot-reload tools on merge                                   │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌──────────────────────┐  ┌──────────────────────────────────────┐ │
│  │  nREPL Server        │  │  clojure-mcp                         │ │
│  │  :7888               │  │  • Tools loaded from tong rack       │ │
│  │  • Self-modification │  │  • Add tools at runtime              │ │
│  └──────────────────────┘  └──────────────────────────────────────┘ │
│                                                                      │
│  Writes spawn requests to data/ipc/spawn/*.json                     │
├─────────────────────────────────────────────────────────────────────┤
│  BRAAIER CONTAINERS (192.168.64.3+)                                 │
│  JVM Clojure, ephemeral (claimed from pre-warmed pool)             │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  On claim (task assigned):                                     │ │
│  │  1. git clone /data/tools.git /tmp/tongs                       │ │
│  │  2. Load tools: (load-file "/tmp/tongs/src/tools.clj")        │ │
│  │  3. Start clojure-mcp with loaded tools                        │ │
│  │  4. Start nREPL for iteration                                  │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Work on task (may not be Clojure project)                     │ │
│  │  • Uses tongs (tools) from tong master                         │ │
│  │  • Can create new tools during work                            │ │
│  │  • Commits new tools to branch                                 │ │
│  │  • Proposes PR to tong master                                  │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  Connects to 192.168.64.1:7888 (socat → tong master nREPL)         │
└─────────────────────────────────────────────────────────────────────┘
```

### Why JVM Clojure for Everything?

| Component | Why JVM Clojure |
|-----------|-----------------|
| Braaimaster | Long-running, full library access, manages state |
| Tong master | nREPL + clojure-mcp for self-modification |
| Braaiers | **clojure-mcp requires nREPL**, need full tool execution |

**The startup time problem is solved with pre-warmed pools**, not Babashka.

### Pre-warmed Braaier Pool

```clojure
;; braaimaster/pool.clj
(defonce braaier-pool (atom []))
(def pool-size 3)

(defn spawn-warm-braaier!
  "Start a braaier JVM but don't assign task yet."
  []
  (let [container-id (spawn-container! {:image "braaier:latest"
                                         :state :warming})]
    ;; Wait for JVM to start, load classpath
    (wait-for-ready! container-id)
    (swap! braaier-pool conj {:id container-id
                              :state :warm
                              :created-at (Instant/now)})))

(defn claim-braaier!
  "Claim a warm braaier for a task. Returns in ~100ms."
  [task]
  (if-let [braaier (first (filter #(= :warm (:state %)) @braaier-pool))]
    (do
      (swap! braaier-pool #(remove (fn [b] (= (:id b) (:id braaier))) %))
      (assign-task! (:id braaier) task)
      ;; Replenish pool in background
      (future (spawn-warm-braaier!))
      braaier)
    ;; No warm braaiers, cold start (rare)
    (spawn-and-assign! task)))

(defn maintain-pool!
  "Background loop to keep pool at target size."
  []
  (while true
    (let [warm-count (count (filter #(= :warm (:state %)) @braaier-pool))]
      (dotimes [_ (- pool-size warm-count)]
        (spawn-warm-braaier!)))
    (Thread/sleep 5000)))
```

---

## Git-Based Tool Evolution

Instead of inventing a new tool schema, braaiers use git for tool evolution.

### Tong Rack Structure

```
data/tools.git/                    # Bare repo (shared volume)
├── HEAD
├── refs/
│   ├── heads/
│   │   └── main                   # Current approved tools
│   └── prs/                       # Braaier proposals
│       ├── braaier-001/new-grep-tool
│       └── braaier-002/better-search
├── objects/
└── ...

tongs/                             # Tong master's working tree
├── src/
│   └── braainet/
│       └── tools/
│           ├── core.clj           # Core tools (send_message, etc.)
│           ├── filesystem.clj     # File operations
│           ├── search.clj         # Search tools
│           └── custom/            # Braaier-contributed tools
│               ├── weather.clj
│               └── code_analysis.clj
├── deps.edn
└── README.md
```

### Braaier Tool Workflow

```
┌─────────────────────────────────────────────────────────────────────┐
│  BRAAIER WORKFLOW                                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. CLONE (on task start)                                           │
│     git clone /data/tools.git /tmp/tongs-<braaier-id>              │
│                                                                      │
│  2. LOAD                                                            │
│     (require '[braainet.tools.core :as tools])                     │
│     (require '[braainet.tools.filesystem :as fs-tools])            │
│     ;; Register all tools with clojure-mcp                          │
│                                                                      │
│  3. WORK                                                            │
│     ;; Use existing tools                                           │
│     (tools/send-message chat-id "Working on it...")                │
│     ;; Create new tool if needed                                    │
│     (defn analyze-imports [file-path] ...)                         │
│                                                                      │
│  4. PROPOSE (if created new tool)                                   │
│     ;; Save to custom/ namespace                                    │
│     (spit "src/braainet/tools/custom/import_analyzer.clj" ...)    │
│     git checkout -b pr/braaier-<id>/import-analyzer                │
│     git add . && git commit -m "Add import-analyzer tool"          │
│     git push origin pr/braaier-<id>/import-analyzer                │
│                                                                      │
│  5. REQUEST MERGE                                                   │
│     ;; Write PR proposal to IPC                                     │
│     (ipc/write-pr-proposal!                                         │
│       {:branch "pr/braaier-<id>/import-analyzer"                   │
│        :title "Add import-analyzer tool"                           │
│        :description "Analyzes Python/JS imports..."                │
│        :test-results (run-tool-tests)})                            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Tong Master Review Workflow

```
┌─────────────────────────────────────────────────────────────────────┐
│  TONG MASTER WORKFLOW (reviewing braaier proposals)                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. RECEIVE PR PROPOSAL (via IPC watcher)                          │
│     {:branch "pr/braaier-001/import-analyzer"                      │
│      :title "Add import-analyzer tool"                             │
│      :description "Analyzes Python/JS imports..."                  │
│      :test-results {:passed 5 :failed 0}}                          │
│                                                                      │
│  2. EVALUATE (LLM-assisted)                                         │
│     - Is this tool generally useful?                                │
│     - Does it duplicate existing tools?                             │
│     - Is it safe (no shell injection, etc.)?                       │
│     - Did tests pass?                                               │
│                                                                      │
│  3. DECIDE                                                          │
│     A. MERGE (useful, safe)                                         │
│        git fetch origin pr/braaier-001/import-analyzer             │
│        git merge --no-ff pr/braaier-001/import-analyzer            │
│        ;; Hot-reload tools                                          │
│        (reload-tools!)                                              │
│        ;; Notify braaimaster of update                              │
│        (ipc/notify-tool-update! "import-analyzer")                  │
│                                                                      │
│     B. REJECT (too specific, unsafe, or broken)                     │
│        ;; Don't merge - let next braaier reinvent if needed        │
│        (log/info "Rejected tool proposal" ...)                     │
│                                                                      │
│     C. MODIFY & MERGE (needs tweaks)                                │
│        ;; Tong master can modify before merging                     │
│        (fix-security-issue! branch)                                 │
│        git merge --no-ff ...                                        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Braaimaster Checkpoint Workflow

```
┌─────────────────────────────────────────────────────────────────────┐
│  BRAAIMASTER CHECKPOINT WORKFLOW                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. ON TOOL UPDATE NOTIFICATION                                     │
│     (on-tool-update [tool-name]                                     │
│       ;; Create checkpoint before update takes effect               │
│       (git-tag! (str "checkpoint-" (timestamp)))                   │
│       (swap! checkpoints conj {:tag tag                            │
│                                :tools (list-tools)                 │
│                                :timestamp (Instant/now)}))         │
│                                                                      │
│  2. VERIFY TOOLS WORK (periodic health check)                       │
│     (defn verify-tools! []                                          │
│       (let [results (run-tool-tests!)]                             │
│         (when (some :failed results)                               │
│           (rollback-to-last-good-checkpoint!))))                   │
│                                                                      │
│  3. ROLLBACK ON FAILURE                                             │
│     (defn rollback-to-last-good-checkpoint! []                     │
│       (let [last-good (last-passing-checkpoint)]                   │
│         (log/warn "Tools broken, rolling back to" last-good)       │
│         (git-reset-hard! (:tag last-good))                         │
│         (notify-tong-master! :rollback last-good)                  │
│         ;; Hot-reload reverted tools                                │
│         (reload-tools!)))                                           │
│                                                                      │
│  4. PRUNE OLD CHECKPOINTS                                           │
│     ;; Keep last N checkpoints, delete older ones                   │
│     (prune-checkpoints! 10)                                         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Data Structures & Interfaces

### Core Domain Types (Malli Schemas)

```clojure
(ns braainet.schemas
  (:require [malli.core :as m]))

;; Mount configuration
(def AdditionalMount
  [:map
   [:host-path :string]
   [:container-path :string]
   [:readonly {:optional true :default true} :boolean]])

(def ContainerConfig
  [:map
   [:additional-mounts {:optional true} [:vector AdditionalMount]]
   [:timeout {:optional true} :int]
   [:env {:optional true} [:map-of :string :string]]])

;; Registered chat/group
(def RegisteredGroup
  [:map
   [:name :string]
   [:folder :string]
   [:trigger :string]
   [:added-at :string]
   [:container-config {:optional true} ContainerConfig]])

;; Message from Telegram
(def TelegramMessage
  [:map
   [:update-id :int]
   [:chat-id :int]
   [:chat-type [:enum "private" "group" "supergroup" "channel"]]
   [:chat-title {:optional true} :string]
   [:from-id :int]
   [:from-name :string]
   [:text :string]
   [:message-id :int]
   [:timestamp :int]])

;; Scheduled task
(def ScheduleType [:enum "cron" "interval" "once"])
(def ContextMode [:enum "group" "isolated"])
(def TaskStatus [:enum "active" "paused" "completed"])

(def ScheduledTask
  [:map
   [:id :string]
   [:group-folder :string]
   [:chat-id :int]
   [:prompt :string]
   [:schedule-type ScheduleType]
   [:schedule-value :string]
   [:context-mode ContextMode]
   [:next-run [:maybe :string]]
   [:last-run [:maybe :string]]
   [:last-result [:maybe :string]]
   [:status TaskStatus]
   [:created-at :string]])

;; Braaier state
(def BraaierState [:enum :warming :warm :working :done :failed])

(def Braaier
  [:map
   [:id :string]
   [:container-id :string]
   [:state BraaierState]
   [:task {:optional true} :any]
   [:created-at inst?]
   [:claimed-at {:optional true} inst?]])

;; Tool proposal (PR from braaier)
(def ToolProposal
  [:map
   [:branch :string]
   [:braaier-id :string]
   [:title :string]
   [:description :string]
   [:files [:vector :string]]
   [:test-results {:optional true} [:map
                                     [:passed :int]
                                     [:failed :int]]]])

;; Checkpoint
(def Checkpoint
  [:map
   [:tag :string]
   [:timestamp inst?]
   [:tools [:vector :string]]
   [:verified :boolean]])
```

### Container I/O Types

```clojure
(def ContainerInput
  [:map
   [:prompt :string]
   [:session-id {:optional true} :string]
   [:group-folder :string]
   [:chat-id :int]
   [:is-main :boolean]
   [:is-scheduled-task {:optional true} :boolean]])

(def ContainerOutput
  [:map
   [:status [:enum "success" "error"]]
   [:result [:maybe :string]]
   [:new-session-id {:optional true} :string]
   [:error {:optional true} :string]
   [:tool-proposals {:optional true} [:vector ToolProposal]]])
```

### Database Schema (SQLite)

```sql
-- Same as NanoClaw, with Telegram chat_id instead of WhatsApp jid
CREATE TABLE chats (
  chat_id INTEGER PRIMARY KEY,
  name TEXT,
  chat_type TEXT,
  last_message_time TEXT
);

CREATE TABLE messages (
  id TEXT,
  chat_id INTEGER,
  sender_id INTEGER,
  sender_name TEXT,
  content TEXT,
  timestamp TEXT,
  is_from_me INTEGER,
  PRIMARY KEY (id, chat_id),
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id)
);

CREATE TABLE scheduled_tasks (
  id TEXT PRIMARY KEY,
  group_folder TEXT NOT NULL,
  chat_id INTEGER NOT NULL,
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

-- New: track braaiers
CREATE TABLE braaiers (
  id TEXT PRIMARY KEY,
  container_id TEXT NOT NULL,
  state TEXT NOT NULL,
  task_prompt TEXT,
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  finished_at TEXT,
  result TEXT,
  error TEXT
);

-- New: track tool proposals
CREATE TABLE tool_proposals (
  id TEXT PRIMARY KEY,
  braaier_id TEXT NOT NULL,
  branch TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending',  -- pending, merged, rejected
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  FOREIGN KEY (braaier_id) REFERENCES braaiers(id)
);

-- New: track checkpoints
CREATE TABLE checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag TEXT NOT NULL UNIQUE,
  timestamp TEXT NOT NULL,
  tools_json TEXT NOT NULL,
  verified INTEGER DEFAULT 0,
  is_good INTEGER DEFAULT 1
);
```

---

## Function Signatures

### Braaimaster (Host Orchestrator)

```clojure
(ns braaimaster.core)

;; Lifecycle
(defn start! [] ...)
(defn stop! [] ...)

;; Container management
(defn spawn-tong-master! [] ...)
(defn spawn-braaier! [opts] ...)
(defn kill-container! [container-id] ...)

;; Braaier pool
(defn maintain-pool! [] ...)
(defn claim-braaier! [task] ...)
(defn release-braaier! [braaier-id] ...)

;; socat relay
(defn start-nrepl-relay! [tong-master-ip] ...)
(defn stop-nrepl-relay! [] ...)

;; Checkpointing
(defn create-checkpoint! [] ...)
(defn rollback-to! [checkpoint-tag] ...)
(defn verify-tools! [] ...)
(defn prune-checkpoints! [keep-n] ...)

;; IPC watching
(defn start-spawn-watcher! [] ...)
(defn start-result-watcher! [] ...)
```

### Tong Master (Main Container)

```clojure
(ns tong-master.core)

;; Lifecycle
(defn start! [] ...)
(defn stop! [] ...)

;; Telegram
(defn start-polling! [handler] ...)
(defn send-message [chat-id text] ...)
(defn send-typing [chat-id] ...)

;; Tool management
(defn load-tools! [] ...)
(defn reload-tools! [] ...)
(defn list-tools [] ...)
(defn get-tool [tool-name] ...)

;; PR review
(defn review-proposal! [proposal] ...)
(defn merge-proposal! [proposal] ...)
(defn reject-proposal! [proposal reason] ...)

;; Request braaier
(defn request-braaier! [task] ...)

;; nREPL + MCP
(defn start-nrepl! [port] ...)
(defn start-mcp! [] ...)
(defn register-tool! [name handler schema] ...)
```

### Braaier (Sub-Agent Container)

```clojure
(ns braaier.core)

;; Lifecycle (called when task assigned)
(defn init! [task] ...)
(defn run! [] ...)
(defn cleanup! [] ...)

;; Tool loading
(defn clone-tools! [] ...)
(defn load-tools! [] ...)

;; Tool creation
(defn create-tool! [name handler schema] ...)
(defn propose-tool! [tool-spec] ...)

;; Communication
(defn connect-to-tong-master! [] ...)
(defn send-result! [result] ...)
```

---

## Library Mapping

### JVM Clojure Dependencies

```clojure
;; deps.edn (shared by all components)
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

  ;; MCP
  ;; com.github.bhauman/clojure-mcp {:mvn/version "..."}
  }}
```

### Component-Specific Deps

```clojure
;; braaimaster/deps.edn
{:deps {babashka/process {:mvn/version "0.5.22"}}}  ; container spawning

;; braaier/deps.edn
{:deps {org.eclipse.jgit/org.eclipse.jgit {:mvn/version "6.8.0"}}}  ; git ops
```

---

## Migration Strategy

### Phase 0: Braaimaster (Week 0.5)

**Goal**: Create host orchestrator that can spawn containers.

```clojure
;; braaimaster.clj - Key functions
(defn spawn-tong-master! []
  (let [proc (p/process
               ["container" "run" "-d"
                "-v" "data:/workspace/data"
                "-v" "groups:/workspace/groups"
                "-p" "7888:7888"
                "tong-master:latest"])]
    (reset! tong-master-ip (get-container-ip "tong-master"))
    (start-nrepl-relay! @tong-master-ip)))

(defn maintain-pool! []
  (loop []
    (let [warm (count (filter #(= :warm (:state %)) @braaier-pool))]
      (dotimes [_ (- pool-size warm)]
        (spawn-warm-braaier!)))
    (Thread/sleep 5000)
    (recur)))
```

**Deliverable**: Braaimaster starts tong master, maintains braaier pool.

### Phase 1: Tong Master Core (Week 1)

**Goal**: Telegram + SQLite + basic message handling.

```clojure
;; tong_master/telegram.clj
(defn start-polling! [handler]
  (loop [offset nil]
    (let [{:keys [ok result]} (get-updates offset)]
      (when ok
        (doseq [update result]
          (when-let [msg (extract-message update)]
            (handler msg)))
        (recur (when (seq result)
                 (inc (:update_id (last result)))))))))

;; tong_master/db.clj
(defn store-message [{:keys [id chat-id sender-name content timestamp]}]
  (sql/insert! ds :messages
    {:id id :chat_id chat-id :sender_name sender-name
     :content content :timestamp timestamp}))
```

**Deliverable**: Tong master receives Telegram messages, stores in SQLite.

### Phase 2: nREPL + clojure-mcp (Week 2)

**Goal**: Self-modification infrastructure.

```clojure
;; tong_master/repl.clj
(defn start-nrepl! [port]
  (reset! nrepl-server
    (nrepl/start-server
      :port port
      :handler cider-nrepl-handler))
  (log/info "nREPL started on port" port))

;; tong_master/mcp.clj
(defn register-tool! [name description handler input-schema]
  (swap! tools assoc name
    {:name name
     :description description
     :handler handler
     :inputSchema input-schema})
  (log/info "Registered tool:" name))
```

**Deliverable**: Tong master has nREPL + clojure-mcp running.

### Phase 3: Braaier Implementation (Week 3)

**Goal**: Sub-agents that clone tools and execute tasks.

```clojure
;; braaier/core.clj
(defn init! [task]
  (clone-tools!)
  (load-tools!)
  (start-nrepl! 7889)
  (start-mcp!)
  (connect-to-tong-master!))

(defn clone-tools! []
  (let [repo (Git/cloneRepository)
        _ (-> repo
              (.setURI "file:///data/tools.git")
              (.setDirectory (io/file "/tmp/tongs"))
              (.call))]
    (log/info "Cloned tools repo")))

(defn propose-tool! [{:keys [name handler schema description]}]
  (let [branch (str "pr/braaier-" (braaier-id) "/" name)]
    (save-tool-file! name handler schema)
    (git-checkout-branch! branch)
    (git-add-commit! (str "Add " name " tool"))
    (git-push! branch)
    (ipc/write-pr-proposal!
      {:branch branch
       :title (str "Add " name " tool")
       :description description})))
```

**Deliverable**: Braaiers can clone tools, work, propose new tools.

### Phase 4: Git Tool Evolution (Week 4)

**Goal**: Full PR workflow for tool evolution.

```clojure
;; tong_master/pr_review.clj
(defn review-proposal! [{:keys [branch title files] :as proposal}]
  (let [diff (git-diff! "main" branch)
        decision (llm-evaluate-pr diff title)]
    (case decision
      :merge (do
               (merge-proposal! proposal)
               (reload-tools!)
               (notify-braaimaster! :tool-update))
      :reject (reject-proposal! proposal (:reason decision))
      :modify (do
                (apply-fixes! proposal (:fixes decision))
                (merge-proposal! proposal)))))
```

**Deliverable**: Tong master reviews, merges/rejects tool proposals.

### Phase 5: Checkpoint & Rollback (Week 5)

**Goal**: Braaimaster can recover from bad tool merges.

```clojure
;; braaimaster/checkpoint.clj
(defn on-tool-update! [tool-name]
  (let [tag (str "checkpoint-" (System/currentTimeMillis))]
    (git-tag! tag)
    (sql/insert! ds :checkpoints
      {:tag tag
       :timestamp (Instant/now)
       :tools_json (json/generate-string (list-tools))
       :verified false})))

(defn verify-tools! []
  (let [results (run-tool-smoke-tests!)]
    (if (every? :passed results)
      (mark-checkpoint-verified! (latest-checkpoint))
      (rollback-to-last-good!))))
```

**Deliverable**: Full checkpoint/rollback system working.

---

## Risk Assessment

### High Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| Tool PR introduces security hole | System compromise | LLM review + sandboxed execution |
| Runaway tool evolution | System instability | Checkpoint/rollback, rate limiting |

### Medium Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| Pre-warmed pool memory usage | ~2GB per JVM | Limit pool size, tune heap |
| Git repo grows large | Slow clones | Periodic gc, shallow clones |
| Tong master single point of failure | System down | Braaimaster monitors, restarts |

### Low Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| JVM cold start needed | 3-5s delay (rare) | Pool usually has warm braaiers |
| Tool merge conflicts | Manual resolution | Auto-reject on conflict |

---

## Recommendations

### Immediate

1. **Start with braaimaster + tong master** - Get the basic flow working first.

2. **Simple tool format** - Start with plain Clojure files, not complex schema.

3. **Shallow git clones** - Braaiers only need latest tools, not history.

### Medium-Term

1. **Tool namespacing** - `braainet.tools.{core,custom}` to separate built-in from evolved.

2. **Tool testing framework** - Require tests for tool proposals.

3. **LLM-assisted PR review** - Use Claude to evaluate tool proposals.

### Long-Term (GraalVM Consideration)

The user mentioned GraalVM for faster tool execution. Options:

| Approach | Startup | Dynamic? | Complexity |
|----------|---------|----------|------------|
| JVM Clojure | 3-5s (pool: ~100ms) | Full | Low |
| GraalVM native-image | ~10ms | Limited | High |

**Recommendation**: Stay with JVM + pre-warmed pool. GraalVM's closed-world assumption conflicts with self-modifying tools. Only consider if pool memory becomes a problem.

---

## File Structure

```
braainet/
├── braaimaster/                   # Host orchestrator (JVM Clojure)
│   ├── deps.edn
│   └── src/
│       └── braaimaster/
│           ├── core.clj           # Entry point
│           ├── pool.clj           # Braaier pool management
│           ├── checkpoint.clj     # Git checkpoint/rollback
│           ├── relay.clj          # socat nREPL relay
│           └── ipc.clj            # IPC watchers
│
├── tong-master/                   # Main container (JVM Clojure)
│   ├── deps.edn
│   ├── Dockerfile
│   └── src/
│       └── tong_master/
│           ├── core.clj           # Entry point
│           ├── telegram.clj       # Telegram Bot API
│           ├── db.clj             # SQLite (next.jdbc)
│           ├── scheduler.clj      # Task scheduler (chime)
│           ├── repl.clj           # nREPL server
│           ├── mcp.clj            # clojure-mcp
│           ├── tools.clj          # Tool loading/management
│           └── pr_review.clj      # PR review workflow
│
├── braaier/                       # Sub-agent container (JVM Clojure)
│   ├── deps.edn
│   ├── Dockerfile
│   └── src/
│       └── braaier/
│           ├── core.clj           # Entry point
│           ├── tools.clj          # Clone & load tools
│           ├── propose.clj        # Tool proposal (git)
│           └── nrepl_client.clj   # Connect to tong master
│
├── tongs/                         # Tools git repo working tree
│   ├── deps.edn
│   └── src/
│       └── braainet/
│           └── tools/
│               ├── core.clj       # Built-in tools
│               └── custom/        # Braaier-contributed
│
├── data/
│   ├── braainet.db               # SQLite database
│   ├── tools.git/                # Bare git repo (shared volume)
│   ├── sessions/                 # Claude sessions
│   └── ipc/
│       ├── spawn/                # Braaier spawn requests
│       ├── results/              # Braaier results
│       └── prs/                  # Tool PR proposals
│
├── groups/                       # Per-group memory
│
└── docs/
    └── plans/
        └── 2026-02-02-babashka-migration-plan.md
```

---

## Estimated Effort

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| Phase 0: Braaimaster | 0.5 weeks | Container orchestration, pool |
| Phase 1: Tong Master Core | 1 week | Telegram, SQLite, routing |
| Phase 2: nREPL + MCP | 1 week | Self-modification infrastructure |
| Phase 3: Braaiers | 1 week | Sub-agents with tool loading |
| Phase 4: Tool Evolution | 1 week | Git PR workflow |
| Phase 5: Checkpoint | 0.5 weeks | Rollback system |

**Total**: 5 weeks

---

*End of Migration Plan*
