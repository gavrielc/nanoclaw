<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoClaw" width="400">
</p>

<p align="center">
  Personal Claude assistant running on Telegram with Docker isolation. Lightweight, secure, and customizable.
</p>

## 概述

NanoClaw 是一個基於 Claude Agent SDK 的 Telegram 機器人，讓你可以通過 Telegram 與 Claude AI 對話。每個對話都在獨立的 Docker container 中執行，確保安全隔離。

### 特色

- **Telegram 整合** - 通過 Telegram 與 Claude 對話
- **Container 隔離** - 每次對話都在獨立的 Docker container 中執行
- **群組記憶** - 每個群組有獨立的 `CLAUDE.md` 記憶檔案
- **排程任務** - 支援 cron、間隔、一次性排程
- **Skills 系統** - 可擴展的技能模組
- **VPS 部署** - 支援 Docker Compose 一鍵部署

---

## 架構

```
┌─────────────────────────────────────────────────────────────────┐
│                         VPS / Host                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              NanoClaw Router (Node.js)                    │  │
│  │  ┌─────────┐  ┌──────────┐  ┌────────────┐  ┌──────────┐  │  │
│  │  │Telegram │  │  SQLite  │  │ Task       │  │   IPC    │  │  │
│  │  │  Bot    │  │    DB    │  │ Scheduler  │  │  Watcher │  │  │
│  │  └────┬────┘  └─────┬────┘  └─────┬──────┘  └────┬─────┘  │  │
│  └───────┼─────────────┼─────────────┼──────────────┼────────┘  │
│          │             │             │              │           │
│  ┌───────▼─────────────▼─────────────▼──────────────▼────────┐  │
│  │                 Docker Socket                              │  │
│  └───────┬─────────────┬─────────────┬──────────────┬────────┘  │
│          │             │             │              │           │
│  ┌───────▼───┐  ┌──────▼────┐  ┌─────▼─────┐  ┌────▼──────┐    │
│  │ Agent     │  │ Agent     │  │ Agent     │  │ Agent     │    │
│  │ Container │  │ Container │  │ Container │  │ Container │    │
│  │ (main)    │  │ (group1)  │  │ (group2)  │  │ (task)    │    │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 核心元件

| 元件 | 檔案 | 說明 |
|------|------|------|
| **Router** | `src/index.ts` | Telegram 連線、訊息路由、IPC 處理 |
| **Container Runner** | `src/container-runner.ts` | 管理 Docker container 生命週期 |
| **Task Scheduler** | `src/task-scheduler.ts` | 排程任務執行 |
| **Database** | `src/db.ts` | SQLite 儲存訊息和狀態 |
| **Agent Runner** | `container/agent-runner/` | Container 內執行 Claude Agent SDK |

### 目錄結構

```
nanoclaw/
├── src/                    # Router 主程式
├── container/              # Agent container 相關
│   ├── Dockerfile         # Agent container image
│   ├── agent-runner/      # Container 內執行的程式
│   └── skills/            # 內建 skills
├── groups/                 # 群組資料夾
│   ├── main/              # 主頻道（管理員權限）
│   │   ├── CLAUDE.md      # 群組記憶
│   │   ├── .claude/skills/# 群組專屬 skills
│   │   └── conversations/ # 對話歷史
│   └── {group-folder}/    # 其他群組
├── data/                   # 運行時資料
│   ├── nanoclaw.db        # SQLite 資料庫
│   ├── registered_groups.json
│   ├── sessions/          # Claude sessions
│   └── ipc/               # Container IPC 目錄
└── store/                  # 持久化儲存
```

---

## 運作流程

### 訊息處理流程

```
1. 用戶在 Telegram 發送訊息 "@Andrea 幫我查天氣"
                    ↓
2. Telegraf Bot 收到訊息，存入 SQLite
                    ↓
3. 檢查是否為已註冊群組 + 觸發詞匹配
                    ↓
4. 啟動 Docker container (nanoclaw-agent:latest)
   - 掛載群組目錄 → /workspace/group
   - 掛載 IPC 目錄 → /workspace/ipc
   - 傳入對話歷史作為 prompt
                    ↓
5. Container 內執行 Claude Agent SDK
   - 讀取 CLAUDE.md 作為系統設定
   - 執行 AI 推理
   - 可使用 Bash、Web Search、IPC MCP tools
                    ↓
6. Agent 輸出結果，Container 結束
                    ↓
7. Router 將結果發送回 Telegram
```

### IPC 機制

Container 與 Router 透過檔案系統 IPC 通訊：

| IPC 類型 | 目錄 | 說明 |
|----------|------|------|
| 發送訊息 | `ipc/{group}/messages/` | Agent 主動發送 Telegram 訊息 |
| 排程任務 | `ipc/{group}/tasks/` | Agent 建立/管理排程任務 |
| 群組資訊 | `ipc/{group}/available_groups.json` | 可用群組列表 |
| 當前任務 | `ipc/{group}/current_tasks.json` | 該群組的排程任務 |

---

## VPS 部署

### 前置需求

- VPS (Ubuntu 22.04+ 建議)
- Docker 和 Docker Compose
- Telegram Bot Token (從 @BotFather 取得)
- Anthropic API Key (從 console.anthropic.com 取得)

### 部署步驟

```bash
# 1. Clone 專案
git clone https://github.com/your/nanoclaw.git
cd nanoclaw

# 2. 設定環境變數
cp .env.vps.example .env
nano .env
# 填入:
#   TELEGRAM_BOT_TOKEN=your_bot_token
#   ANTHROPIC_API_KEY=your_api_key
#   ASSISTANT_NAME=Andrea

# 3. 啟動服務
docker compose -f docker-compose.vps.yml up -d --build

# 4. 查看 logs
docker compose -f docker-compose.vps.yml logs -f
```

### 常用指令

```bash
# 重啟服務
docker compose -f docker-compose.vps.yml restart

# 停止服務
docker compose -f docker-compose.vps.yml down

# 更新程式碼
git pull
docker compose -f docker-compose.vps.yml up -d --build
```

---

## 多 Bot 部署

NanoClaw 支援同時運行多個 Telegram Bot，它們共用同一套 Skills 但擁有獨立的資料。

### 架構

```
┌─────────────────────────────────────────────────────────────────┐
│                         VPS / Host                              │
│                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  nanoclaw-bot1  │  │  nanoclaw-bot2  │  │  nanoclaw-bot3  │  │
│  │  (Andy)         │  │  (Bob)          │  │  (Charlie)      │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                    │           │
│  ┌────────▼────────┐  ┌────────▼────────┐  ┌────────▼────────┐  │
│  │  data-bot1/     │  │  data-bot2/     │  │  data-bot3/     │  │
│  │  groups-bot1/   │  │  groups-bot2/   │  │  groups-bot3/   │  │
│  │  store-bot1/    │  │  store-bot2/    │  │  store-bot3/    │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              共用: container/skills/ (Agent Image)        │  │
│  │              共用: nanoclaw-agent:latest                  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 共用 vs 獨立

| 項目 | 共用/獨立 | 說明 |
|------|-----------|------|
| Agent Image | ✅ 共用 | 所有 Bot 使用同一個 `nanoclaw-agent:latest` |
| Skills | ✅ 共用 | `container/skills/` 編譯進 image |
| 群組記憶 | ❌ 獨立 | 各 Bot 有自己的 `groups-botX/` |
| 資料庫 | ❌ 獨立 | 各 Bot 有自己的 `data-botX/` |
| Sessions | ❌ 獨立 | 各 Bot 有自己的對話 session |

### 設定步驟

**步驟 1：編輯 `.env` 檔案**

```bash
cp .env.vps.example .env
nano .env
```

填入多個 Bot 的 Token：

```env
# 共用設定
ANTHROPIC_API_KEY=your_api_key_here

# Bot 1
BOT1_TOKEN=123456789:AAHdqTxxxxxxxxxxxxxxxxxxxxxxxxx
BOT1_NAME=Andy

# Bot 2
BOT2_TOKEN=987654321:BBHdqTxxxxxxxxxxxxxxxxxxxxxxxxx
BOT2_NAME=Bob
```

**步驟 2：編輯 `docker-compose.vps.yml`**

取消註解你需要的 Bot 服務：

```yaml
services:
  nanoclaw-bot1:
    # ... (預設已啟用)

  nanoclaw-bot2:
    # 取消這整個區塊的註解
```

**步驟 3：啟動服務**

```bash
docker compose -f docker-compose.vps.yml up -d --build
```

### 管理多個 Bot

```bash
# 查看所有 Bot 狀態
docker compose -f docker-compose.vps.yml ps

# 查看特定 Bot 的 logs
docker compose -f docker-compose.vps.yml logs -f nanoclaw-bot1
docker compose -f docker-compose.vps.yml logs -f nanoclaw-bot2

# 重啟特定 Bot
docker compose -f docker-compose.vps.yml restart nanoclaw-bot1

# 停止特定 Bot
docker compose -f docker-compose.vps.yml stop nanoclaw-bot2
```

### 注意事項

1. **首次啟動**：第一個啟動的 Bot 會自動 build `nanoclaw-agent:latest` image
2. **資料隔離**：各 Bot 的資料完全獨立，不會互相干擾
3. **API 額度**：所有 Bot 共用同一個 `ANTHROPIC_API_KEY`，注意 API 用量
4. **更新 Skills**：修改 `container/skills/` 後需要重新 build agent image：
   ```bash
   cd container && ./build.sh && cd ..
   docker compose -f docker-compose.vps.yml restart
   ```

## 設定

### Claude 認證方式

NanoClaw 支援兩種認證方式：

**方式一：使用 Claude 訂閱額度（推薦）**

如果你有 Claude Pro/Max 訂閱，可以使用 OAuth Token：

```bash
# 1. 在本機執行 claude（如果還沒登入）
claude

# 2. 查看你的 OAuth Token
cat ~/.claude/credentials.json
# 複製 "oauthToken" 的值

# 3. 在 VPS 的 .env 中設定
CLAUDE_CODE_OAUTH_TOKEN=your_oauth_token_here
```

> ⚠️ 注意：OAuth Token 可能會過期，需要定期更新

**方式二：使用 Anthropic API Key**

從 [console.anthropic.com](https://console.anthropic.com) 取得 API Key：

```bash
ANTHROPIC_API_KEY=your_api_key_here
```

這種方式按量計費，不會過期。

### 環境變數

| 變數 | 必填 | 說明 |
|------|------|------|
| `BOT1_TOKEN` | ✅ | Telegram Bot Token (Bot 1) |
| `CLAUDE_CODE_OAUTH_TOKEN` | ⚡ | Claude OAuth Token (二選一) |
| `ANTHROPIC_API_KEY` | ⚡ | Anthropic API Key (二選一) |
| `BOT1_NAME` | ❌ | Bot 1 助手名稱，預設 `Andy` |
| `CONTAINER_IMAGE` | ❌ | Agent image，預設 `nanoclaw-agent:latest` |
| `CONTAINER_TIMEOUT` | ❌ | Container 超時 (ms)，預設 `300000` |
| `LOG_LEVEL` | ❌ | 日誌等級：`trace`, `debug`, `info`, `warn`, `error` |
| `TZ` | ❌ | 時區，預設使用系統時區 |

### 註冊群組

在 Telegram 主頻道中發送訊息給 Bot，它會自動將該聊天設為 main。其他群組需要透過 main 來註冊：

```
@Andrea 把 "Family Chat" 群組加入
```

Bot 會自動：
1. 尋找該群組的 chat_id
2. 建立群組資料夾和 CLAUDE.md
3. 更新 `registered_groups.json`

### 自訂群組記憶

每個群組的 `CLAUDE.md` 定義了該群組的：
- 助手身份和回應風格
- 可存取的目錄和權限
- 群組專屬的指令和功能

---

## Skills 系統

Skills 是可擴展的功能模組，存放於：

| 位置 | 說明 |
|------|------|
| `container/skills/` | 全域 skills（編譯進 image） |
| `groups/{folder}/.claude/skills/` | 群組專屬 skills（持久化） |

Agent 運行時建立的 skills 會自動儲存到群組目錄，不會因 container 重啟而消失。

---

## 排程任務

支援三種排程類型：

| 類型 | 格式 | 範例 |
|------|------|------|
| `cron` | Cron 表達式 | `0 9 * * 1-5` (週一到週五早上 9 點) |
| `interval` | 毫秒數 | `3600000` (每小時) |
| `once` | ISO 時間戳 | `2026-02-07T09:00:00+08:00` |

透過 Telegram 對話建立排程：

```
@Andrea 每天早上 9 點提醒我喝水
```

---

## 開發

### 本機開發

```bash
# 安裝依賴
npm install

# 編譯
npm run build

# Build agent container
cd container && ./build.sh && cd ..

# 啟動
npm start
```

### 檔案說明

| 檔案 | 說明 |
|------|------|
| `src/index.ts` | 主程式進入點，Telegram 連線和訊息路由 |
| `src/container-runner.ts` | Docker container 生命週期管理 |
| `src/task-scheduler.ts` | 排程任務執行邏輯 |
| `src/db.ts` | SQLite 資料庫操作 |
| `src/config.ts` | 設定檔讀取 |
| `container/agent-runner/src/index.ts` | Container 內執行的 Agent 主程式 |
| `container/agent-runner/src/ipc-mcp.ts` | IPC MCP Server 實作 |

---

## 授權

MIT
