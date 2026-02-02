---
name: add-mount
description: Add directory mounting capability to NanoClaw. Allows containers to access additional host directories (e.g., ~/projects, ~/repos) with security validation through an external allowlist. Essential for agents that need to work on files outside their group folder.
---

# Add Directory Mounting

This skill adds the ability to mount additional host directories into agent containers. This is useful when you want agents to access files outside their default group folder—for example, working on projects in `~/projects` or reading documents from `~/Documents`.

## Security Model

Directory mounting uses a **tamper-proof allowlist** stored outside the project:
- Location: `~/.config/nanoclaw/mount-allowlist.json`
- Never mounted into containers (agents can't modify it)
- Defines which directories can be mounted
- Controls read-only vs read-write permissions
- Blocks sensitive paths (.ssh, .gnupg, credentials, etc.)

## Initial Questions

Ask the user:

> What directories do you want agents to access?
>
> Common examples:
> - `~/projects` - Development projects (read-write)
> - `~/repos` - Git repositories (read-write)
> - `~/Documents` - Documents (read-only recommended)
>
> Which directories do you need? (You can add more later)

Also ask:

> Should non-main groups be forced to read-only access for all additional mounts?
>
> **Recommended: Yes** - This prevents untrusted groups from modifying your files.

Store their answers for configuration.

---

## Step 1: Add Mount Types

Read `src/types.ts` and find the `ContainerConfig` interface.

Replace the `ContainerConfig` interface and add the mount-related types before it:

```typescript
export interface AdditionalMount {
  hostPath: string;      // Absolute path on host (supports ~ for home)
  containerPath: string; // Path inside container (under /workspace/extra/)
  readonly?: boolean;    // Default: true for safety
}

/**
 * Mount Allowlist - Security configuration for additional mounts
 * This file should be stored at ~/.config/nanoclaw/mount-allowlist.json
 * and is NOT mounted into any container, making it tamper-proof from agents.
 */
export interface MountAllowlist {
  // Directories that can be mounted into containers
  allowedRoots: AllowedRoot[];
  // Glob patterns for paths that should never be mounted (e.g., ".ssh", ".gnupg")
  blockedPatterns: string[];
  // If true, non-main groups can only mount read-only regardless of config
  nonMainReadOnly: boolean;
}

export interface AllowedRoot {
  // Absolute path or ~ for home (e.g., "~/projects", "/var/repos")
  path: string;
  // Whether read-write mounts are allowed under this root
  allowReadWrite: boolean;
  // Optional description for documentation
  description?: string;
}

export interface ContainerConfig {
  additionalMounts?: AdditionalMount[];
  timeout?: number;  // Default: 300000 (5 minutes)
  env?: Record<string, string>;
}
```

---

## Step 2: Add Mount Allowlist Path to Config

Read `src/config.ts` and add after `const PROJECT_ROOT = process.cwd();`:

```typescript
const HOME_DIR = process.env.HOME || '/Users/user';

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(HOME_DIR, '.config', 'nanoclaw', 'mount-allowlist.json');
```

---

## Step 3: Create Mount Security Module

Create the file `src/mount-security.ts` with the content from `.claude/skills/add-mount/mount-security.ts`.

This file provides:
- `loadMountAllowlist()` - Loads and caches the allowlist
- `validateMount()` - Validates a single mount request
- `validateAdditionalMounts()` - Validates all mounts for a group
- `generateAllowlistTemplate()` - Generates a template config

Read the full implementation from `.claude/skills/add-mount/mount-security.ts` and write it to `src/mount-security.ts`.

---

## Step 4: Update Container Runner

Read `src/container-runner.ts` and make these changes:

### 4a. Add Import

Find the imports at the top and add:

```typescript
import { validateAdditionalMounts } from './mount-security.js';
```

### 4b. Add Mount Validation to buildVolumeMounts

Find the `buildVolumeMounts` function and locate the `return mounts;` statement at the end.

Add this block just before `return mounts;`:

```typescript
  // Additional mounts validated against external allowlist (tamper-proof from containers)
  if (group.containerConfig?.additionalMounts) {
    const validatedMounts = validateAdditionalMounts(
      group.containerConfig.additionalMounts,
      group.name,
      isMain
    );
    mounts.push(...validatedMounts);
  }
```

---

## Step 5: Create Mount Allowlist

Create the allowlist directory and file:

```bash
mkdir -p ~/.config/nanoclaw
```

Create `~/.config/nanoclaw/mount-allowlist.json` with the user's requested directories.

**Template structure** (customize based on user's earlier answers):

```json
{
  "allowedRoots": [
    {
      "path": "~/projects",
      "allowReadWrite": true,
      "description": "Development projects"
    },
    {
      "path": "~/repos",
      "allowReadWrite": true,
      "description": "Git repositories"
    },
    {
      "path": "~/Documents",
      "allowReadWrite": false,
      "description": "Documents (read-only)"
    }
  ],
  "blockedPatterns": [
    "password",
    "secret",
    "token"
  ],
  "nonMainReadOnly": true
}
```

Write this file:

```bash
cat > ~/.config/nanoclaw/mount-allowlist.json << 'EOF'
{
  "allowedRoots": [
    ... customize based on user input ...
  ],
  "blockedPatterns": [
    "password",
    "secret",
    "token"
  ],
  "nonMainReadOnly": true
}
EOF
```

**Note:** The default blocked patterns (`.ssh`, `.gnupg`, `.aws`, etc.) are hardcoded in `mount-security.ts` and cannot be bypassed—they're merged with any custom patterns.

---

## Step 6: Configure Group Mounts

To enable mounts for a specific group, you need to update its registration in `data/registered_groups.json`.

Read the current `data/registered_groups.json` file.

For each group that needs additional mounts, add a `containerConfig.additionalMounts` array:

```json
{
  "name": "My Project Group",
  "folder": "my-project",
  "trigger": "@Andy",
  "added_at": "2024-01-01T00:00:00Z",
  "containerConfig": {
    "additionalMounts": [
      {
        "hostPath": "~/projects/my-app",
        "containerPath": "my-app",
        "readonly": false
      }
    ]
  }
}
```

**Important notes:**
- `hostPath`: Absolute path or `~` for home directory
- `containerPath`: Relative path (mounted under `/workspace/extra/`)
- `readonly`: Set to `false` for read-write, `true` or omit for read-only

The mount will appear at `/workspace/extra/my-app` inside the container.

---

## Step 7: Build and Restart

Compile the TypeScript:

```bash
npm run build
```

Wait for compilation to complete and check for errors.

Restart the service:

```bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

Verify it started:

```bash
sleep 2 && launchctl list | grep nanoclaw
```

---

## Step 8: Test Mounts

Tell the user:

> Directory mounting is configured! Test it by sending a message to a group with mounts configured:
>
> `@Andy list files in /workspace/extra/my-app`
>
> Or:
>
> `@Andy what's in my mounted directories?`

Watch the logs for mount messages:

```bash
tail -f logs/nanoclaw.log | grep -i mount
```

---

## Adding More Directories Later

To add more allowed directories:

1. Edit `~/.config/nanoclaw/mount-allowlist.json` and add to `allowedRoots`
2. Update the group's config in `data/registered_groups.json` to include the new mount
3. Restart: `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`

---

## Troubleshooting

### Mount rejected - not under allowed root

The requested path isn't under any directory listed in `allowedRoots`. Edit the allowlist to add the parent directory.

### Mount rejected - matches blocked pattern

The path contains a sensitive pattern (`.ssh`, `credentials`, etc.). These blocks are intentional and cannot be bypassed for security.

### Mount forced to read-only

Either:
- `nonMainReadOnly` is true and this is a non-main group
- The `allowedRoot` has `allowReadWrite: false`

Check your allowlist configuration.

### Container can't see mounted files

1. Verify the host path exists: `ls -la ~/path/to/directory`
2. Check the mount is in the group's config in `registered_groups.json`
3. Check logs for validation messages: `cat groups/*/logs/container-*.log | grep mount`

### Allowlist not loading

Verify the file exists and is valid JSON:

```bash
cat ~/.config/nanoclaw/mount-allowlist.json | python3 -m json.tool
```

---

## Removing Directory Mounting

To remove this feature:

1. Remove from `src/container-runner.ts`:
   - Delete the `validateAdditionalMounts` import
   - Delete the additional mounts block in `buildVolumeMounts`

2. Remove from `src/types.ts`:
   - Delete `AdditionalMount`, `MountAllowlist`, `AllowedRoot` interfaces
   - Remove `additionalMounts` from `ContainerConfig`

3. Delete `src/mount-security.ts`

4. Remove from `src/config.ts`:
   - Delete `HOME_DIR` constant
   - Delete `MOUNT_ALLOWLIST_PATH` export

5. Remove `additionalMounts` from any groups in `data/registered_groups.json`

6. Rebuild:
   ```bash
   npm run build
   launchctl kickstart -k gui/$(id -u)/com.nanoclaw
   ```
