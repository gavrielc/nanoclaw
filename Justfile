# NanoClaw commands
# See CLAUDE.md for setup (launchctl plist in ~/Library/LaunchAgents/com.nanoclaw.plist)

# Default: start or restart NanoClaw. Bootstraps service if not yet loaded.
default:
    #!/usr/bin/env bash
    set -e
    PLIST=~/Library/LaunchAgents/com.nanoclaw.plist
    if [ ! -f "$PLIST" ]; then
        echo "Plist not found. Run: just install"
        exit 1
    fi
    if launchctl kickstart -k gui/$(id -u)/com.nanoclaw 2>/dev/null; then
        echo "NanoClaw restarted"
    else
        launchctl bootstrap gui/$(id -u) "$PLIST"
        echo "NanoClaw started"
    fi

# Install launchd plist and start service (run once)
install:
    #!/usr/bin/env bash
    set -e
    BUN_PATH=$(which bun)
    PROJECT_ROOT=$(pwd)
    HOME_PATH=$HOME
    PLIST=~/Library/LaunchAgents/com.nanoclaw.plist
    mkdir -p ~/Library/LaunchAgents
    sed -e "s|{{ "{{" + "NODE_PATH" + "}}" }}|$BUN_PATH|g" -e "s|{{ "{{" + "PROJECT_ROOT" + "}}" }}|$PROJECT_ROOT|g" -e "s|{{ "{{" + "HOME" + "}}" }}|$HOME_PATH|g" launchd/com.nanoclaw.plist > "$PLIST"
    echo "Installed plist (bun: $BUN_PATH, project: $PROJECT_ROOT)"
    bun run build
    mkdir -p logs
    launchctl bootstrap gui/$(id -u) "$PLIST"
    echo "NanoClaw started"

# Restart NanoClaw (stop + start) — use after container rebuild or config changes
restart:
    launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# Build the agent container image. Usage: just build-container [tag]  (default tag: latest)
build-container tag="latest":
    ./container/build.sh {{tag}}

# Stop NanoClaw (unload launchd service)
stop:
    launchctl bootout gui/$(id -u)/com.nanoclaw
    echo "NanoClaw stopped"

# Reset message cursor for a group to retry unprocessed messages.
# Usage: just reset-cursor dm-omar  (or main, omar-discord, etc.)
reset-cursor group="dm-omar":
    #!/usr/bin/env bash
    DB="store/messages.db"
    JID=$(sqlite3 "$DB" "SELECT jid FROM registered_groups WHERE folder = '{{group}}';")
    if [ -z "$JID" ]; then
        echo "Group '{{group}}' not found"
        exit 1
    fi
    # JSON path for keys with colons needs quotes: $."dc:dm:..."
    PATH_ARG='$."'"$JID"'"'
    sqlite3 "$DB" "UPDATE router_state SET value = json_remove(value, '$PATH_ARG') WHERE key = 'last_agent_timestamp';"
    echo "Reset cursor for {{group}} (jid: $JID). Restart NanoClaw to retry: just"

# Enable project access (mount /workspace/project) for Discord groups so they can read omar-knowledge-packet.
# Usage: just enable-project-access [group_folder]  (default: ditto-discord)
enable-project-access group="ditto-discord":
    #!/usr/bin/env bash
    DB="store/messages.db"
    if [ ! -f "$DB" ]; then
        echo "Database not found at $DB"
        exit 1
    fi
    ROWS=$(sqlite3 "$DB" "
    UPDATE registered_groups
    SET container_config = json_set(
        COALESCE(container_config, '{}'),
        '$.projectAccess', 1
    )
    WHERE folder = '{{group}}';
    SELECT changes();
    ")
    if [ "$ROWS" -gt 0 ]; then
        echo "Project access enabled for {{group}}. Restart NanoClaw: just restart"
    else
        echo "Group '{{group}}' not found in registered_groups."
        exit 1
    fi

# Enable project access for all OmarOmni Discord groups (ditto-discord, omar-discord)
enable-project-access-all:
    just enable-project-access ditto-discord
    just enable-project-access omar-discord

# Enable Ditto MCP for a group (default: dm-omar). Requires DITTO_MCP_TOKEN in .env or environment.
# Usage: just enable-ditto-mcp [group_folder]
enable-ditto-mcp group="dm-omar":
    #!/usr/bin/env bash
    DB="store/messages.db"
    if [ ! -f "$DB" ]; then
        echo "Database not found at $DB"
        exit 1
    fi
    sqlite3 "$DB" "
    UPDATE registered_groups
    SET container_config = json_set(
        COALESCE(container_config, '{}'),
        '$.dittoMcpEnabled', 1
    )
    WHERE folder = '{{group}}';
    "
    ROWS=$(sqlite3 "$DB" "SELECT changes();")
    if [ "$ROWS" -gt 0 ]; then
        echo "Ditto MCP enabled for {{group}}. Set DITTO_MCP_TOKEN in .env and restart NanoClaw."
    else
        echo "Group '{{group}}' not found in registered_groups."
        exit 1
    fi
