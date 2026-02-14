import fs from 'fs';
import path from 'path';

export interface TrelloConfig {
  boardId: string;
  boardName: string;
  boardUrl: string;
  lists: {
    heute: string;
    woche: string;
    bald: string;
    warten: string;
    erledigt: string;
  };
  limits: {
    heuteMax: number;
  };
}

export interface TrelloCredentials {
  apiKey: string;
  token: string;
}

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'data', 'trello-config.json');

export function loadConfig(configPath: string = DEFAULT_CONFIG_PATH): TrelloConfig | null {
  try {
    if (!fs.existsSync(configPath)) {
      return null;
    }
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`Failed to load Trello config from ${configPath}:`, err);
    return null;
  }
}

export function saveConfig(config: TrelloConfig, configPath: string = DEFAULT_CONFIG_PATH): void {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export function loadCredentials(): TrelloCredentials | null {
  const apiKey = process.env.TRELLO_API_KEY;
  const token = process.env.TRELLO_TOKEN;

  if (!apiKey || !token) {
    return null;
  }

  return { apiKey, token };
}

export const LIST_NAMES = {
  heute: '📅 Heute',
  woche: '📆 Diese Woche',
  bald: '🔜 Bald',
  warten: '⏸️ Warten auf...',
  erledigt: '✅ Erledigt',
} as const;

export type ListKey = keyof typeof LIST_NAMES;

export function getListKey(nameOrKey: string): ListKey | null {
  const normalized = nameOrKey.toLowerCase().trim();

  // Direct match
  if (normalized in LIST_NAMES) {
    return normalized as ListKey;
  }

  // Partial matches
  if (normalized.includes('heut')) return 'heute';
  if (normalized.includes('woche') || normalized.includes('week')) return 'woche';
  if (normalized.includes('bald') || normalized.includes('soon')) return 'bald';
  if (normalized.includes('wart') || normalized.includes('wait')) return 'warten';
  if (normalized.includes('erledig') || normalized.includes('done') || normalized.includes('complete')) return 'erledigt';

  return null;
}
