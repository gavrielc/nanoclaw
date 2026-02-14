---
name: add-trello
description: Add Trello integration to NanoClaw. Create and manage cards via WhatsApp. ADHS-optimized with board structure (Heute, Diese Woche, Bald, Warten auf..., Erledigt). Triggers on "trello", "add trello", "setup trello", "trello karte".
---

# Trello Integration für NanoClaw

WhatsApp-gesteuerte Trello-Integration mit ADHS-optimierter Board-Struktur.

> **Compatibility:** NanoClaw v1.0.0. Directory structure may change in future versions.

## Features

| Aktion | Tool | Beschreibung |
|--------|------|-------------|
| Karte erstellen | `trello_add_card` | Neue Karte in Liste erstellen |
| Karten anzeigen | `trello_list_cards` | Karten einer Liste oder des ganzen Boards |
| Karte verschieben | `trello_move_card` | Karte zwischen Listen verschieben |
| Karte erledigen | `trello_complete_card` | Karte nach "Erledigt" verschieben |

## Board-Struktur (ADHS-optimiert)

```
📋 Dein Trello Board
├── 📅 Heute (max 3-5 Karten) ⚠️
├── 📆 Diese Woche
├── 🔜 Bald
├── ⏸️ Warten auf...
└── ✅ Erledigt
```

**ADHS-Optimierungen:**
- "Heute" ist auf 3-5 Karten limitiert (verhindert Überforderung)
- Klare Struktur mit Prioritäten
- Geteiltes Board mit Partner/Freundin für Accountability

## Prerequisites

1. **NanoClaw installiert** - WhatsApp connected, service aktiv
2. **Trello Account** - Kostenloser Account reicht
3. **Node.js Dependencies**:
   ```bash
   npm install node-fetch
   ```

## Quick Start

```bash
# 1. Setup Trello API credentials (interactive)
npx tsx .claude/skills/add-trello/scripts/setup.ts

# 2. Board erstellen und konfigurieren
npx tsx .claude/skills/add-trello/scripts/create-board.ts

# 3. Container rebuilden
./container/build.sh

# 4. Host rebuilden und Service neustarten
npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

## Setup-Schritte

### 1. Trello API Key und Token erhalten

Das Setup-Script führt dich durch den Prozess:

```bash
npx tsx .claude/skills/add-trello/scripts/setup.ts
```

**Manuell:**

1. **API Key holen:**
   - Öffne: https://trello.com/power-ups/admin
   - Klicke "New" um ein Power-Up zu erstellen (oder nutze ein existierendes)
   - Kopiere den **API Key**

2. **Token generieren:**
   - Öffne: `https://trello.com/1/authorize?expiration=never&name=NanoClaw&scope=read,write&response_type=token&key=DEIN_API_KEY`
   - Ersetze `DEIN_API_KEY` mit deinem API Key
   - Authorisiere die App
   - Kopiere das **Token**

3. **In .env eintragen:**
   ```bash
   TRELLO_API_KEY=dein_api_key_hier
   TRELLO_TOKEN=dein_token_hier
   ```

### 2. Board erstellen

Das Setup-Script erstellt automatisch ein Board mit der richtigen Struktur:

```bash
npx tsx .claude/skills/add-trello/scripts/create-board.ts
```

**Das Script:**
- Erstellt neues Board "NanoClaw Tasks" (oder nutzt existierendes)
- Legt die 5 Listen an (Heute, Diese Woche, Bald, Warten auf..., Erledigt)
- Speichert Board-ID und Listen-IDs in `data/trello-config.json`
- Gibt dir einen Link zum Board (zum Teilen mit Freundin)

**Manuell:**

Wenn du ein existierendes Board nutzen willst:

1. Gehe zu deinem Trello Board
2. Board-ID aus URL kopieren: `https://trello.com/b/BOARD_ID/board-name`
3. Listen manuell erstellen: Heute, Diese Woche, Bald, Warten auf..., Erledigt
4. `data/trello-config.json` erstellen:
   ```json
   {
     "boardId": "DEINE_BOARD_ID",
     "lists": {
       "heute": "LISTE_ID_HEUTE",
       "woche": "LISTE_ID_DIESE_WOCHE",
       "bald": "LISTE_ID_BALD",
       "warten": "LISTE_ID_WARTEN",
       "erledigt": "LISTE_ID_ERLEDIGT"
     }
   }
   ```

### 3. Board mit Freundin teilen

1. Öffne dein Trello Board
2. Klicke auf "Share" (oben rechts)
3. Gib die Email deiner Freundin ein
4. Sie kann jetzt Karten sehen und bearbeiten

## Configuration

### Environment Variables

| Variable | Beschreibung |
|----------|-------------|
| `TRELLO_API_KEY` | Trello API Key (von trello.com/power-ups/admin) |
| `TRELLO_TOKEN` | Trello Token (OAuth) |

In `.env` file:

```bash
# .env
TRELLO_API_KEY=dein_api_key
TRELLO_TOKEN=dein_token
```

### Config File: `data/trello-config.json`

Automatisch erstellt von `create-board.ts`:

```json
{
  "boardId": "abc123def456",
  "boardName": "NanoClaw Tasks",
  "boardUrl": "https://trello.com/b/abc123def456",
  "lists": {
    "heute": "list_id_1",
    "woche": "list_id_2",
    "bald": "list_id_3",
    "warten": "list_id_4",
    "erledigt": "list_id_5"
  },
  "limits": {
    "heuteMax": 5
  }
}
```

### Data Files

| Path | Purpose | Git |
|------|---------|-----|
| `data/trello-config.json` | Board und Listen IDs | Ignored |
| `.env` | API credentials | Ignored |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Container (Linux VM)                                       │
│  └── agent.ts → MCP tools (trello_add_card, etc.)         │
│      └── Writes IPC request to /workspace/ipc/tasks/       │
└──────────────────┬──────────────────────────────────────────┘
                   │ IPC (file system)
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  Host (macOS)                                               │
│  └── src/ipc.ts → processTaskIpc()                         │
│      └── host.ts → handleTrelloIpc()                       │
│          └── lib/trello-api.ts → Trello REST API           │
└─────────────────────────────────────────────────────────────┘
```

### File Structure

```
.claude/skills/add-trello/
├── SKILL.md              # Diese Dokumentation
├── agent.ts              # Container-side MCP tool definitions
└── scripts/
    ├── setup.ts          # Interactive API setup
    └── create-board.ts   # Board creation script

src/integrations/trello/
├── host.ts               # Host-side IPC handler
└── lib/
    ├── trello-api.ts     # Trello REST API wrapper
    └── config.ts         # Configuration utilities
```

## Integration Points

Um diese Skill in NanoClaw zu integrieren:

### 1. Host side: `src/ipc.ts`

Import hinzufügen nach anderen lokalen imports:
```typescript
import { handleTrelloIpc } from './integrations/trello/host.js';
```

In `processTaskIpc` function's switch statement default case:
```typescript
// Find:
default:
logger.warn({ type: data.type }, 'Unknown IPC task type');

// Replace with:
default:
let handled = false;

// Try X integration if available
const xHandled = await handleXIpc?.(data, sourceGroup, isMain, DATA_DIR);
if (xHandled) handled = true;

// Try Trello integration if available
if (!handled) {
    const trelloHandled = await handleTrelloIpc(data, sourceGroup, isMain, DATA_DIR);
    if (trelloHandled) handled = true;
}

if (!handled) {
    logger.warn({ type: data.type }, 'Unknown IPC task type');
}
```

### 2. Container side: `container/agent-runner/src/ipc-mcp-stdio.ts`

Add import at the top (after other imports):
```typescript
import { registerTrelloTools } from './skills/add-trello/agent.js';
```

Before `await server.connect(transport);` am Ende der Datei, füge hinzu:
```typescript
// Register Trello tools
registerTrelloTools(server);
```

### 3. Dockerfile: `container/Dockerfile`

Add this COPY instruction to copy the Trello agent file into the container (add after other COPY commands, before RUN npm install):

```dockerfile
# Trello integration (optional)
COPY .claude/skills/add-trello/agent.ts ./src/skills/add-trello/agent.ts
```

**Note**: If the file doesn't exist, the build will fail. Make sure to create an empty directory or make this conditional:
```dockerfile
# In build.sh, add before docker build:
mkdir -p container/agent-runner/src/skills/add-trello
if [ -f .claude/skills/add-trello/agent.ts ]; then
    cp .claude/skills/add-trello/agent.ts container/agent-runner/src/skills/add-trello/
fi
```

## Usage Examples

### Via WhatsApp

```
Du: @Andy Neue Karte "Einkaufen gehen" für heute

Agent: ✅ Karte erstellt in "Heute":
• Einkaufen gehen
⚠️ Heute hat jetzt 3 Karten (max 5)
```

```
Du: @Andy Was ist heute zu tun?

Agent: 📅 Heute (3 Karten):
1. Einkaufen gehen
2. Email an Chef
3. Müll rausbringen
```

```
Du: @Andy "Einkaufen gehen" erledigt

Agent: ✅ Karte "Einkaufen gehen" nach Erledigt verschoben
📅 Heute hat jetzt 2 Karten
```

### Direkt (für Testing)

```bash
# Karte hinzufügen
npx tsx .claude/skills/add-trello/scripts/test.ts add "Test Karte" heute

# Karten auflisten
npx tsx .claude/skills/add-trello/scripts/test.ts list heute

# Karte verschieben
npx tsx .claude/skills/add-trello/scripts/test.ts move "CARD_ID" erledigt
```

## ADHS-Features

### 1. "Heute" Limit

Das System warnt automatisch, wenn "Heute" zu voll wird:

```typescript
// In lib/trello-api.ts
if (listKey === 'heute') {
  const cards = await listCards('heute');
  if (cards.length >= config.limits.heuteMax) {
    return {
      success: false,
      error: `⚠️ "Heute" ist voll (${cards.length}/${config.limits.heuteMax}). Verschiebe eine Karte oder wähle "Diese Woche".`
    };
  }
}
```

### 2. Klare Kommunikation

- Emoji-basierte Rückmeldungen (✅, ⚠️, 📅)
- Kurze, klare Bestätigungen
- Immer aktuelle Kartenzahl zeigen

### 3. Einfache Commands

Natural language processing - keine exakte Syntax nötig:
- "Neue Karte X für heute" ✅
- "Füge X zu heute hinzu" ✅
- "X auf heute" ✅
- "X erledigt" ✅

## Troubleshooting

### API credentials nicht gefunden

```bash
# Check .env
cat .env | grep TRELLO

# Should show:
# TRELLO_API_KEY=...
# TRELLO_TOKEN=...
```

### Board config nicht gefunden

```bash
# Check config
cat data/trello-config.json

# If missing, run:
npx tsx .claude/skills/add-trello/scripts/create-board.ts
```

### "Heute" Limit ändern

Edit `data/trello-config.json`:
```json
{
  "limits": {
    "heuteMax": 3  // Ändern auf 3, 4, 5, etc.
  }
}
```

### API Fehler

```bash
# Test API connection
npx tsx .claude/skills/add-trello/scripts/test.ts ping

# Should return board info
```

### Container rebuild

Wenn Agent die Tools nicht findet:

```bash
# Full rebuild
container builder stop && container builder rm && container builder start
./container/build.sh

# Verify
container run -i --rm --entrypoint grep nanoclaw-agent:latest -r "trello_add_card" /app/src/
```

## Removal

```bash
# 1. Remove from ipc.ts
#    Delete: import { handleTrelloIpc } from ...
#    Remove: await handleTrelloIpc(...) call

# 2. Remove from ipc-mcp.ts
#    Delete: import { createTrelloTools } from ...
#    Remove: ...createTrelloTools({ groupFolder, isMain })

# 3. Remove from build.sh
#    Delete: Trello integration section

# 4. Remove files
rm -rf .claude/skills/add-trello
rm data/trello-config.json

# 5. Rebuild
npm run build
./container/build.sh
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

## Advanced: Custom Workflows

### Automatische Archivierung

Karten in "Erledigt" automatisch nach 7 Tagen archivieren:

```typescript
// In scripts/archive-old.ts (create as scheduled task)
const cards = await listCards('erledigt');
const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

for (const card of cards) {
  if (new Date(card.dateLastActivity) < new Date(weekAgo)) {
    await archiveCard(card.id);
  }
}
```

Schedule via cron in CLAUDE.md:
```markdown
# Scheduled Tasks

- **Trello Archivierung**: `0 0 * * 0` - Jeden Sonntag um Mitternacht alte Karten archivieren
```

### Slack/Email Integration

Füge Webhooks hinzu, um bei neuen Karten in "Heute" benachrichtigt zu werden.

## License

Part of NanoClaw - see main project license.
