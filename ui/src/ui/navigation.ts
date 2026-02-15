import { html, type TemplateResult } from 'lit';
import { icons } from './icons.ts';

export type TabId =
  | 'chat'
  | 'overview'
  | 'channels'
  | 'groups'
  | 'messages'
  | 'tasks'
  | 'sessions'
  | 'skills'
  | 'config'
  | 'logs'
  | 'debug';

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export interface NavItem {
  id: TabId;
  label: string;
  icon: TemplateResult;
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Chat',
    items: [
      { id: 'chat', label: 'Chat', icon: icons.messageSquare },
    ],
  },
  {
    label: 'Dashboard',
    items: [
      { id: 'overview', label: 'Overview', icon: icons.barChart },
      { id: 'channels', label: 'Channels', icon: icons.radio },
    ],
  },
  {
    label: 'Operations',
    items: [
      { id: 'groups', label: 'Groups', icon: icons.folder },
      { id: 'messages', label: 'Messages', icon: icons.fileText },
      { id: 'tasks', label: 'Tasks', icon: icons.zap },
      { id: 'sessions', label: 'Sessions', icon: icons.monitor },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'skills', label: 'Skills', icon: icons.puzzle },
      { id: 'config', label: 'Config', icon: icons.settings },
      { id: 'logs', label: 'Logs', icon: icons.scrollText },
      { id: 'debug', label: 'Debug', icon: icons.bug },
    ],
  },
];

export function tabDescription(tab: TabId): string {
  switch (tab) {
    case 'chat': return 'Agent chat session.';
    case 'overview': return 'System status and health.';
    case 'channels': return 'WhatsApp and Telegram status.';
    case 'groups': return 'Registered groups and their configuration.';
    case 'messages': return 'Message history by group.';
    case 'tasks': return 'Scheduled tasks and run logs.';
    case 'sessions': return 'Active sessions per group.';
    case 'skills': return 'Container skills management.';
    case 'config': return 'System configuration and CLAUDE.md editor.';
    case 'logs': return 'Live log viewer.';
    case 'debug': return 'Queue state, DB stats, and diagnostics.';
    default: return '';
  }
}
