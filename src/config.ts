/**
 * NanoClaw Configuration
 *
 * Central configuration with environment variable support.
 * All paths are absolute to work correctly with container mounts.
 */
import path from 'path';

export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'Andy';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR =
  process.env.HOME || process.env.USERPROFILE || '/home/user';

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanoclaw',
  'mount-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';

// Container runtime configuration
export const CONTAINER_RUNTIME =
  process.env.CONTAINER_RUNTIME || 'docker';
export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'nanoclaw-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '300000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const IPC_POLL_INTERVAL = 1000;
export const MAX_CONCURRENT_CONTAINERS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_CONTAINERS || '5', 10) || 5,
);

// Channel configuration
export const WHATSAPP_ENABLED =
  process.env.WHATSAPP_ENABLED !== 'false'; // Default: true
export const TELEGRAM_ENABLED =
  process.env.TELEGRAM_ENABLED === 'true';
export const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || '';
export const TELEGRAM_ALLOWED_USERS = (
  process.env.TELEGRAM_ALLOWED_USERS || ''
)
  .split(',')
  .filter(Boolean);
export const DISCORD_ENABLED =
  process.env.DISCORD_ENABLED === 'true';
export const DISCORD_BOT_TOKEN =
  process.env.DISCORD_BOT_TOKEN || '';
export const DISCORD_ALLOWED_USERS = (
  process.env.DISCORD_ALLOWED_USERS || ''
)
  .split(',')
  .filter(Boolean);

// Gateway port for future HTTP/webhook integrations
export const GATEWAY_PORT = parseInt(
  process.env.GATEWAY_PORT || '18790',
  10,
);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i',
);

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
