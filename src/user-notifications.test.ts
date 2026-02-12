import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';

import {
  formatStatusNotification,
  initUserNotifications,
} from './user-notifications.js';
import { eventBus } from './event-bus.js';
import type { StatusChangeEvent } from './event-bus.js';

let db: Database.Database;
let sendMessage: ReturnType<
  typeof vi.fn<(jid: string, text: string) => Promise<void>>
>;

function setupSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      phone TEXT PRIMARY KEY,
      name TEXT,
      language TEXT DEFAULT 'mr',
      role TEXT DEFAULT 'user',
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      total_complaints INTEGER DEFAULT 0,
      is_blocked INTEGER DEFAULT 0,
      date_of_birth TEXT,
      block_reason TEXT,
      blocked_until TEXT
    );
  `);
}

beforeEach(() => {
  db = new Database(':memory:');
  setupSchema(db);
  sendMessage = vi.fn().mockResolvedValue(undefined);
  eventBus.removeAllListeners();
});

afterEach(() => {
  eventBus.removeAllListeners();
});

// ============================================================
// formatStatusNotification — Marathi
// ============================================================

describe('formatStatusNotification — Marathi', () => {
  it('returns Marathi format for language mr', () => {
    const msg = formatStatusNotification(
      'RK-20260211-0042',
      'in_progress',
      'महानगरपालिका पाणीपुरवठा विभागाशी संपर्क साधला आहे.',
      'mr',
    );

    expect(msg).toContain('तक्रार अपडेट');
    expect(msg).toContain('RK-20260211-0042');
    expect(msg).toContain('कार्यवाही सुरू');
    expect(msg).toContain('महानगरपालिका पाणीपुरवठा विभागाशी संपर्क साधला आहे.');
  });

  it('includes localized status names in Marathi', () => {
    const msg = formatStatusNotification('RK-1', 'registered', undefined, 'mr');
    expect(msg).toContain('नोंदणी');

    const msg2 = formatStatusNotification('RK-2', 'resolved', undefined, 'mr');
    expect(msg2).toContain('निराकरण');

    const msg3 = formatStatusNotification('RK-3', 'escalated', undefined, 'mr');
    expect(msg3).toContain('वरिष्ठांकडे पाठवले');
  });
});

// ============================================================
// formatStatusNotification — Hindi
// ============================================================

describe('formatStatusNotification — Hindi', () => {
  it('returns Hindi format for language hi', () => {
    const msg = formatStatusNotification(
      'RK-20260211-0042',
      'in_progress',
      'नगरपालिका जल आपूर्ति विभाग से संपर्क किया गया है।',
      'hi',
    );

    expect(msg).toContain('शिकायत अपडेट');
    expect(msg).toContain('RK-20260211-0042');
    expect(msg).toContain('कार्यवाही जारी');
    expect(msg).toContain('नगरपालिका जल आपूर्ति विभाग से संपर्क किया गया है।');
  });

  it('includes localized status names in Hindi', () => {
    const msg = formatStatusNotification('RK-1', 'registered', undefined, 'hi');
    expect(msg).toContain('पंजीकृत');

    const msg2 = formatStatusNotification('RK-2', 'resolved', undefined, 'hi');
    expect(msg2).toContain('समाधान');
  });
});

// ============================================================
// formatStatusNotification — English
// ============================================================

describe('formatStatusNotification — English', () => {
  it('returns English format for language en', () => {
    const msg = formatStatusNotification(
      'RK-20260211-0042',
      'in_progress',
      'Contacted municipal water supply department.',
      'en',
    );

    expect(msg).toContain('Complaint Update');
    expect(msg).toContain('RK-20260211-0042');
    expect(msg).toContain('In Progress');
    expect(msg).toContain('Contacted municipal water supply department.');
  });

  it('includes localized status names in English', () => {
    const msg = formatStatusNotification('RK-1', 'registered', undefined, 'en');
    expect(msg).toContain('Registered');

    const msg2 = formatStatusNotification('RK-2', 'on_hold', undefined, 'en');
    expect(msg2).toContain('On Hold');
  });
});

// ============================================================
// formatStatusNotification — content structure
// ============================================================

describe('formatStatusNotification — structure', () => {
  it('includes complaint ID in the message', () => {
    const msg = formatStatusNotification(
      'RK-20260211-9999',
      'acknowledged',
      undefined,
      'en',
    );
    expect(msg).toContain('RK-20260211-9999');
  });

  it('includes note when provided', () => {
    const msg = formatStatusNotification(
      'RK-1',
      'in_progress',
      'Working on it',
      'en',
    );
    expect(msg).toContain('Working on it');
  });

  it('omits note line when note is not provided', () => {
    const msg = formatStatusNotification(
      'RK-1',
      'in_progress',
      undefined,
      'en',
    );
    expect(msg).not.toContain('Note:');
  });

  it('omits note line when note is undefined for Marathi', () => {
    const msg = formatStatusNotification(
      'RK-1',
      'in_progress',
      undefined,
      'mr',
    );
    expect(msg).not.toContain('टीप:');
  });

  it('omits note line when note is undefined for Hindi', () => {
    const msg = formatStatusNotification(
      'RK-1',
      'in_progress',
      undefined,
      'hi',
    );
    expect(msg).not.toContain('टिप्पणी:');
  });

  it('defaults to English for unknown language', () => {
    const msg = formatStatusNotification(
      'RK-1',
      'in_progress',
      undefined,
      'xx',
    );
    expect(msg).toContain('Complaint Update');
    expect(msg).toContain('In Progress');
  });
});

// ============================================================
// initUserNotifications — event bus integration
// ============================================================

describe('initUserNotifications', () => {
  it('sends DM to user phone JID on status change', async () => {
    db.prepare(
      `INSERT INTO users (phone, language, first_seen, last_seen) VALUES ('919876543210', 'en', datetime('now'), datetime('now'))`,
    ).run();

    initUserNotifications({ db, sendMessage });

    const event: StatusChangeEvent = {
      complaintId: 'RK-20260211-0042',
      phone: '919876543210',
      oldStatus: 'registered',
      newStatus: 'in_progress',
      note: 'Contacted water department',
      updatedBy: '918600822444',
    };

    eventBus.emit('complaint:status-changed', event);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith(
      '919876543210@s.whatsapp.net',
      expect.any(String),
    );

    const msg = sendMessage.mock.calls[0][1] as string;
    expect(msg).toContain('RK-20260211-0042');
    expect(msg).toContain('In Progress');
    expect(msg).toContain('Contacted water department');
  });

  it('sends DM in user stored language', async () => {
    db.prepare(
      `INSERT INTO users (phone, language, first_seen, last_seen) VALUES ('919876543210', 'hi', datetime('now'), datetime('now'))`,
    ).run();

    initUserNotifications({ db, sendMessage });

    const event: StatusChangeEvent = {
      complaintId: 'RK-20260211-0001',
      phone: '919876543210',
      oldStatus: 'registered',
      newStatus: 'acknowledged',
      updatedBy: 'admin',
    };

    eventBus.emit('complaint:status-changed', event);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sendMessage).toHaveBeenCalledOnce();
    const msg = sendMessage.mock.calls[0][1] as string;
    expect(msg).toContain('शिकायत अपडेट');
    expect(msg).toContain('स्वीकृत');
  });

  it('defaults to Marathi when language is not set', async () => {
    // User exists but without explicit language (defaults to 'mr' from schema)
    db.prepare(
      `INSERT INTO users (phone, first_seen, last_seen) VALUES ('919876543210', datetime('now'), datetime('now'))`,
    ).run();

    initUserNotifications({ db, sendMessage });

    const event: StatusChangeEvent = {
      complaintId: 'RK-20260211-0001',
      phone: '919876543210',
      oldStatus: 'registered',
      newStatus: 'in_progress',
      updatedBy: 'admin',
    };

    eventBus.emit('complaint:status-changed', event);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sendMessage).toHaveBeenCalledOnce();
    const msg = sendMessage.mock.calls[0][1] as string;
    expect(msg).toContain('तक्रार अपडेट');
    expect(msg).toContain('कार्यवाही सुरू');
  });

  it('defaults to Marathi when user is not in DB', async () => {
    initUserNotifications({ db, sendMessage });

    const event: StatusChangeEvent = {
      complaintId: 'RK-20260211-0001',
      phone: '919999999999',
      oldStatus: 'registered',
      newStatus: 'in_progress',
      updatedBy: 'admin',
    };

    eventBus.emit('complaint:status-changed', event);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sendMessage).toHaveBeenCalledOnce();
    const msg = sendMessage.mock.calls[0][1] as string;
    expect(msg).toContain('तक्रार अपडेट');
  });

  it('catches sendMessage errors without crashing', async () => {
    db.prepare(
      `INSERT INTO users (phone, language, first_seen, last_seen) VALUES ('919876543210', 'en', datetime('now'), datetime('now'))`,
    ).run();

    sendMessage.mockRejectedValueOnce(new Error('WhatsApp send failed'));

    initUserNotifications({ db, sendMessage });

    const event: StatusChangeEvent = {
      complaintId: 'RK-20260211-0001',
      phone: '919876543210',
      oldStatus: 'registered',
      newStatus: 'resolved',
      updatedBy: 'admin',
    };

    // Should not throw
    eventBus.emit('complaint:status-changed', event);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sendMessage).toHaveBeenCalledOnce();
    // No assertion on result — just verifying it doesn't crash
  });
});
