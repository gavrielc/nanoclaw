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

# Build the host/orchestrator (dist/index.js)
build:
    bun run build

# Build host + container (use after code changes to either)
build-all:
    just build
    just build-container

# Tail NanoClaw logs (follow mode)
tail:
    tail -f logs/nanoclaw.log

# Build the agent container image. Usage: just build-container [tag]  (default tag: latest)
build-container tag="latest":
    ./container/build.sh {{tag}}

# Stop NanoClaw (unload launchd service)
stop:
    launchctl bootout gui/$(id -u)/com.nanoclaw
    echo "NanoClaw stopped"


# Disable project access (unmount /workspace/project) for a group.
# Usage: just disable-project-access [group_folder]  (default: main)
disable-project-access group="main":
    #!/usr/bin/env bash
    set -e
    DB="store/messages.db"
    if [ ! -f "$DB" ]; then
        echo "Database not found at $DB"
        exit 1
    fi
    # Escape single quotes for SQL safety
    ESCAPED_GROUP=$(echo "{{group}}" | sed "s/'/''/g")
    ROWS=$(sqlite3 "$DB" "
    UPDATE registered_groups
    SET container_config = json_remove(COALESCE(container_config, '{}'), '$.projectAccess')
    WHERE folder = '$ESCAPED_GROUP';
    SELECT changes();
    ")
    if [ "$ROWS" -gt 0 ]; then
        echo "Project access disabled for {{group}}. Restart NanoClaw: just restart"
    else
        echo "Group '{{group}}' not found in registered_groups."
        exit 1
    fi

# Unmount additional workspaces (additionalMounts) for a group.
# Removes host paths like ~/code/PROJECT from container_config so agents
# no longer see them at /workspace/extra/*. Agents can clone their own repos instead.
# Usage: just unmount-workspaces [group_folder]  (default: main)
unmount-workspaces group="main":
    #!/usr/bin/env bash
    set -e
    DB="store/messages.db"
    if [ ! -f "$DB" ]; then
        echo "Database not found at $DB"
        exit 1
    fi
    # Escape single quotes for SQL safety
    ESCAPED_GROUP=$(echo "{{group}}" | sed "s/'/''/g")
    ROWS=$(sqlite3 "$DB" "
    UPDATE registered_groups
    SET container_config = json_remove(COALESCE(container_config, '{}'), '$.additionalMounts')
    WHERE folder = '$ESCAPED_GROUP';
    SELECT changes();
    ")
    if [ "$ROWS" -gt 0 ]; then
        echo "Additional mounts removed for {{group}}. Restart NanoClaw: just restart"
    else
        echo "Group '{{group}}' not found in registered_groups."
        exit 1
    fi

# Enable project access (mount /workspace/project) for a group.
# Usage: just enable-project-access [group_folder]  (default: main)
enable-project-access group="main":
    #!/usr/bin/env bash
    set -e
    DB="store/messages.db"
    if [ ! -f "$DB" ]; then
        echo "Database not found at $DB"
        exit 1
    fi
    # Escape single quotes for SQL safety
    ESCAPED_GROUP=$(echo "{{group}}" | sed "s/'/''/g")
    ROWS=$(sqlite3 "$DB" "
    UPDATE registered_groups
    SET container_config = json_set(
        COALESCE(container_config, '{}'),
        '$.projectAccess', 1
    )
    WHERE folder = '$ESCAPED_GROUP';
    SELECT changes();
    ")
    if [ "$ROWS" -gt 0 ]; then
        echo "Project access enabled for {{group}}. Restart NanoClaw: just restart"
    else
        echo "Group '{{group}}' not found in registered_groups."
        exit 1
    fi

# Enable Ditto MCP for a group. Requires DITTO_MCP_TOKEN in .env or environment.
# Usage: just enable-ditto-mcp [group_folder]  (default: main)
enable-ditto-mcp group="main":
    #!/usr/bin/env bash
    set -e
    DB="store/messages.db"
    if [ ! -f "$DB" ]; then
        echo "Database not found at $DB"
        exit 1
    fi
    # Escape single quotes for SQL safety
    ESCAPED_GROUP=$(echo "{{group}}" | sed "s/'/''/g")
    sqlite3 "$DB" "
    UPDATE registered_groups
    SET container_config = json_set(
        COALESCE(container_config, '{}'),
        '$.dittoMcpEnabled', 1
    )
    WHERE folder = '$ESCAPED_GROUP';
    "
    ROWS=$(sqlite3 "$DB" "SELECT changes();")
    if [ "$ROWS" -gt 0 ]; then
        echo "Ditto MCP enabled for {{group}}. Set DITTO_MCP_TOKEN in .env and restart NanoClaw."
    else
        echo "Group '{{group}}' not found in registered_groups."
        exit 1
    fi
