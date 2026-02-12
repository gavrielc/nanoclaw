/**
 * user-notifications.ts — Localized status notifications for complaint users.
 *
 * Listens on the event bus for status changes and sends WhatsApp DMs
 * to constituents in their preferred language (mr/hi/en).
 */
import type Database from 'better-sqlite3';

import { eventBus, type StatusChangeEvent } from './event-bus.js';
import { logger } from './logger.js';

export interface UserNotificationDeps {
  db: Database.Database;
  sendMessage: (jid: string, text: string) => Promise<void>;
}

const statusDisplayNames: Record<string, Record<string, string>> = {
  registered: { mr: 'नोंदणी', hi: 'पंजीकृत', en: 'Registered' },
  acknowledged: { mr: 'स्वीकृत', hi: 'स्वीकृत', en: 'Acknowledged' },
  in_progress: {
    mr: 'कार्यवाही सुरू',
    hi: 'कार्यवाही जारी',
    en: 'In Progress',
  },
  action_taken: {
    mr: 'कार्यवाही केली',
    hi: 'कार्यवाही की गई',
    en: 'Action Taken',
  },
  resolved: { mr: 'निराकरण', hi: 'समाधान', en: 'Resolved' },
  on_hold: { mr: 'प्रतीक्षेत', hi: 'रोक पर', en: 'On Hold' },
  escalated: { mr: 'वरिष्ठांकडे पाठवले', hi: 'अग्रेषित', en: 'Escalated' },
};

interface Labels {
  title: string;
  idLabel: string;
  statusLabel: string;
  noteLabel: string;
}

const labels: Record<string, Labels> = {
  mr: {
    title: 'तक्रार अपडेट 📢',
    idLabel: 'तक्रार क्र.',
    statusLabel: 'स्थिती',
    noteLabel: 'टीप',
  },
  hi: {
    title: 'शिकायत अपडेट 📢',
    idLabel: 'शिकायत संख्या',
    statusLabel: 'स्थिति',
    noteLabel: 'टिप्पणी',
  },
  en: {
    title: 'Complaint Update 📢',
    idLabel: 'Complaint ID',
    statusLabel: 'Status',
    noteLabel: 'Note',
  },
};

function getStatusEmoji(status: string): string {
  switch (status) {
    case 'registered':
      return '📋';
    case 'acknowledged':
      return '👍';
    case 'in_progress':
      return '✅';
    case 'action_taken':
      return '⚡';
    case 'resolved':
      return '✅';
    case 'on_hold':
      return '⏸️';
    case 'escalated':
      return '🔺';
    default:
      return '';
  }
}

function resolveLanguage(lang: string): string {
  return lang in labels ? lang : 'en';
}

function getStatusDisplayName(status: string, language: string): string {
  const lang = resolveLanguage(language);
  return statusDisplayNames[status]?.[lang] ?? status;
}

export function formatStatusNotification(
  complaintId: string,
  newStatus: string,
  note: string | undefined,
  language: string,
): string {
  const lang = resolveLanguage(language);
  const l = labels[lang];
  const statusName = getStatusDisplayName(newStatus, lang);
  const emoji = getStatusEmoji(newStatus);

  const lines = [
    l.title,
    `${l.idLabel}: ${complaintId}`,
    `${l.statusLabel}: ${statusName} ${emoji}`.trim(),
  ];

  if (note) {
    lines.push(`${l.noteLabel}: ${note}`);
  }

  return lines.join('\n');
}

export function initUserNotifications(deps: UserNotificationDeps): void {
  const { db, sendMessage } = deps;

  eventBus.on('complaint:status-changed', (event: StatusChangeEvent) => {
    const user = db
      .prepare('SELECT language FROM users WHERE phone = ?')
      .get(event.phone) as { language: string } | undefined;
    const language = user?.language || 'mr';

    const message = formatStatusNotification(
      event.complaintId,
      event.newStatus,
      event.note,
      language,
    );

    const jid = `${event.phone}@s.whatsapp.net`;

    sendMessage(jid, message).catch((err) => {
      logger.error(
        { phone: event.phone, complaintId: event.complaintId, err },
        'Failed to send user notification',
      );
    });
  });
}
