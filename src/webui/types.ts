import type { RegisteredGroup, ScheduledTask, TaskRunLog, NewMessage } from '../types.js';

export interface OverviewResponse {
  uptime: number;
  channels: { name: string; connected: boolean }[];
  groups: { total: number; active: number };
  queue: {
    activeCount: number;
    maxConcurrent: number;
    waitingCount: number;
  };
  tasks: { active: number; paused: number; completed: number };
  messages: { total: number };
  containers: { running: number };
}

export interface ChannelStatus {
  name: string;
  connected: boolean;
  type: 'whatsapp' | 'telegram';
}

export interface GroupDetail {
  jid: string;
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  requiresTrigger?: boolean;
  containerConfig?: unknown;
  sessionId?: string;
  containerActive: boolean;
}

export interface MessagePage {
  messages: NewMessage[];
  hasMore: boolean;
}

export interface TaskWithLogs extends ScheduledTask {
  recentRuns: TaskRunLog[];
}

export interface SessionInfo {
  groupFolder: string;
  sessionId: string;
  groupName?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  allowedTools: string[];
  enabled: boolean;
  content: string;
  path: string;
}

export interface ConfigResponse {
  values: Record<string, { value: string | number | boolean; env: string; description: string }>;
}

export interface DebugResponse {
  queue: ReturnType<import('../group-queue.js').GroupQueue['getState']>;
  db: Record<string, number>;
  env: Record<string, string | undefined>;
  process: {
    pid: number;
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
    nodeVersion: string;
  };
}

export interface WsEvent {
  type: string;
  [key: string]: unknown;
}
