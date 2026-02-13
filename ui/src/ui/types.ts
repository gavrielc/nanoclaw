export interface OverviewData {
  uptime: number;
  channels: { name: string; connected: boolean }[];
  groups: { total: number; active: number };
  queue: { activeCount: number; maxConcurrent: number; waitingCount: number };
  tasks: { active: number; paused: number; completed: number };
  messages: { total: number };
  containers: { running: number };
}

export interface ChannelData {
  name: string;
  connected: boolean;
  type: 'whatsapp' | 'telegram';
}

export interface GroupData {
  jid: string;
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  requiresTrigger?: boolean;
  containerConfig?: unknown;
  sessionId: string | null;
  containerActive: boolean;
}

export interface MessageData {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean | number;
}

export interface TaskData {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: string;
  schedule_value: string;
  context_mode: string;
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: string;
  created_at: string;
  recentRuns: TaskRunLog[];
}

export interface TaskRunLog {
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: string;
  result: string | null;
  error: string | null;
}

export interface SessionData {
  groupFolder: string;
  sessionId: string;
  groupName?: string;
}

export interface SkillData {
  name: string;
  description: string;
  allowedTools: string[];
  enabled: boolean;
  content: string;
  path: string;
}

export interface ConfigData {
  values: Record<string, { value: string | number | boolean; env: string; description: string }>;
}

export interface DebugData {
  queue: {
    activeCount: number;
    maxConcurrent: number;
    waitingCount: number;
    groups: Array<{
      jid: string;
      active: boolean;
      pendingMessages: boolean;
      pendingTaskCount: number;
      containerName: string | null;
      groupFolder: string | null;
    }>;
  };
  db: Record<string, number>;
  env: Record<string, string | undefined>;
  process: {
    pid: number;
    uptime: number;
    memoryUsage: { rss: number; heapUsed: number; heapTotal: number };
    nodeVersion: string;
  };
}

export interface LogEntry {
  level: number;
  time: number;
  msg: string;
  [key: string]: unknown;
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
