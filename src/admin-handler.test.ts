import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

import { AdminService } from './admin-handler.js';
import { eventBus } from './event-bus.js';
import type { ComplaintEvent, StatusChangeEvent } from './event-bus.js';
import { createComplaint } from './complaint-mcp-server.js';

let db: Database.Database;
let sendMessage: ReturnType<
  typeof vi.fn<(jid: string, text: string) => Promise<void>>
>;
const ADMIN_GROUP_JID = '120363000000000000@g.us';
const ADMIN_PHONES = ['918600822444', '919999999999'];

function setupSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS tenant_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
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
    CREATE TABLE IF NOT EXISTS complaints (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      category TEXT,
      subcategory TEXT,
      description TEXT NOT NULL,
      location TEXT,
      language TEXT NOT NULL,
      status TEXT DEFAULT 'registered',
      status_reason TEXT,
      priority TEXT DEFAULT 'normal',
      source TEXT DEFAULT 'text',
      voice_message_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT,
      days_open INTEGER DEFAULT 0,
      area_id TEXT,
      FOREIGN KEY (phone) REFERENCES users(phone)
    );
    CREATE TABLE IF NOT EXISTS complaint_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_id TEXT NOT NULL,
      old_status TEXT,
      new_status TEXT,
      note TEXT,
      updated_by TEXT DEFAULT 'system',
      created_at TEXT NOT NULL,
      FOREIGN KEY (complaint_id) REFERENCES complaints(id)
    );
    CREATE TABLE IF NOT EXISTS categories (
      name TEXT PRIMARY KEY,
      display_name_en TEXT,
      display_name_mr TEXT,
      display_name_hi TEXT,
      complaint_count INTEGER DEFAULT 0,
      first_seen TEXT NOT NULL,
      is_active INTEGER DEFAULT 1
    );
  `);

  database
    .prepare(
      "INSERT INTO tenant_config (key, value) VALUES ('complaint_id_prefix', 'RK')",
    )
    .run();
}

function createTestService(): AdminService {
  return new AdminService({
    db,
    sendMessage,
    adminGroupJid: ADMIN_GROUP_JID,
    adminPhones: ADMIN_PHONES,
    mlaPhone: '918600822444',
  });
}

beforeEach(() => {
  db = new Database(':memory:');
  setupSchema(db);
  sendMessage = vi.fn().mockResolvedValue(undefined);
  // Clear all event bus listeners from previous tests
  eventBus.removeAllListeners();
});

// ============================================================
// Notification: new complaint
// ============================================================

describe('notifyNewComplaint', () => {
  it('sends notification to admin group with correct format', async () => {
    const service = createTestService();

    const event: ComplaintEvent = {
      complaintId: 'RK-20260211-0042',
      phone: '919876543210',
      category: 'Water Supply',
      description: 'No water supply for 3 days',
      location: 'Ward 7, Shivaji Nagar',
      language: 'mr',
      status: 'registered',
    };

    await service.notifyNewComplaint(event);

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith(
      ADMIN_GROUP_JID,
      expect.any(String),
    );

    const msg = sendMessage.mock.calls[0][1] as string;
    expect(msg).toContain('New Complaint');
    expect(msg).toContain('RK-20260211-0042');
    expect(msg).toContain('919876543210');
    expect(msg).toContain('Water Supply');
    expect(msg).toContain('Ward 7, Shivaji Nagar');
    expect(msg).toContain('No water supply for 3 days');
    expect(msg).toContain('Registered');
  });

  it('notification contains all fields', async () => {
    const service = createTestService();

    const event: ComplaintEvent = {
      complaintId: 'RK-20260211-0001',
      phone: '918765432100',
      category: 'Roads',
      description: 'Large pothole on main road',
      location: 'Near bus stop, Ward 3',
      language: 'hi',
      status: 'registered',
    };

    await service.notifyNewComplaint(event);

    const msg = sendMessage.mock.calls[0][1] as string;
    expect(msg).toContain('ID:');
    expect(msg).toContain('From:');
    expect(msg).toContain('Category:');
    expect(msg).toContain('Location:');
    expect(msg).toContain('Description:');
    expect(msg).toContain('Status:');
  });

  it('handles missing optional fields gracefully', async () => {
    const service = createTestService();

    const event: ComplaintEvent = {
      complaintId: 'RK-20260211-0010',
      phone: '919876543210',
      description: 'General issue',
      language: 'en',
      status: 'registered',
    };

    await service.notifyNewComplaint(event);

    expect(sendMessage).toHaveBeenCalledOnce();
    const msg = sendMessage.mock.calls[0][1] as string;
    expect(msg).toContain('RK-20260211-0010');
  });
});

// ============================================================
// Notification: status change
// ============================================================

describe('notifyStatusChange', () => {
  it('sends status change notification with correct format', async () => {
    const service = createTestService();

    const event: StatusChangeEvent = {
      complaintId: 'RK-20260211-0042',
      phone: '919876543210',
      oldStatus: 'registered',
      newStatus: 'in_progress',
      note: 'Contacted water department',
      updatedBy: '918600822444',
    };

    await service.notifyStatusChange(event);

    expect(sendMessage).toHaveBeenCalledOnce();
    const msg = sendMessage.mock.calls[0][1] as string;
    expect(msg).toContain('Status Updated');
    expect(msg).toContain('RK-20260211-0042');
    expect(msg).toContain('Registered');
    expect(msg).toContain('In Progress');
    expect(msg).toContain('918600822444');
    expect(msg).toContain('Contacted water department');
  });
});

// ============================================================
// Event bus integration
// ============================================================

describe('init', () => {
  it('subscribes to complaint:created and sends notification', async () => {
    const service = createTestService();
    service.init();

    const event: ComplaintEvent = {
      complaintId: 'RK-20260211-0005',
      phone: '919876543210',
      description: 'Test complaint',
      language: 'mr',
      status: 'registered',
    };

    eventBus.emit('complaint:created', event);

    // Event handlers are synchronous but sendMessage is async — wait a tick
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sendMessage).toHaveBeenCalledOnce();
    const msg = sendMessage.mock.calls[0][1] as string;
    expect(msg).toContain('RK-20260211-0005');
  });

  it('subscribes to complaint:status-changed and sends notification', async () => {
    const service = createTestService();
    service.init();

    const event: StatusChangeEvent = {
      complaintId: 'RK-20260211-0005',
      phone: '919876543210',
      oldStatus: 'registered',
      newStatus: 'resolved',
      updatedBy: 'admin',
    };

    eventBus.emit('complaint:status-changed', event);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sendMessage).toHaveBeenCalledOnce();
    const msg = sendMessage.mock.calls[0][1] as string;
    expect(msg).toContain('Status Updated');
  });
});

// ============================================================
// Command parsing: #update
// ============================================================

describe('handleCommand — #update', () => {
  let complaintId: string;

  beforeEach(() => {
    complaintId = createComplaint(db, {
      phone: '919876543210',
      category: 'water_supply',
      description: 'No water for 3 days',
      location: 'Ward 7',
      language: 'mr',
    });
  });

  it('parses #update and changes status with note', async () => {
    const service = createTestService();
    const result = await service.handleCommand(
      ADMIN_PHONES[0],
      `#update ${complaintId} in_progress: Contacted water department`,
    );

    expect(result).toContain('updated');
    expect(result).toContain('in_progress');

    const complaint = db
      .prepare('SELECT status FROM complaints WHERE id = ?')
      .get(complaintId) as { status: string };
    expect(complaint.status).toBe('in_progress');
  });

  it('creates record in complaint_updates table', async () => {
    const service = createTestService();
    await service.handleCommand(
      ADMIN_PHONES[0],
      `#update ${complaintId} in_progress: Working on it`,
    );

    const updates = db
      .prepare('SELECT * FROM complaint_updates WHERE complaint_id = ?')
      .all(complaintId) as {
      old_status: string;
      new_status: string;
      note: string;
      updated_by: string;
    }[];
    expect(updates).toHaveLength(1);
    expect(updates[0].old_status).toBe('registered');
    expect(updates[0].new_status).toBe('in_progress');
    expect(updates[0].note).toBe('Working on it');
    expect(updates[0].updated_by).toBe(ADMIN_PHONES[0]);
  });
});

// ============================================================
// Command parsing: #resolve
// ============================================================

describe('handleCommand — #resolve', () => {
  let complaintId: string;

  beforeEach(() => {
    complaintId = createComplaint(db, {
      phone: '919876543210',
      description: 'Pothole',
      language: 'mr',
    });
  });

  it('parses #resolve and sets status to resolved', async () => {
    const service = createTestService();
    const result = await service.handleCommand(
      ADMIN_PHONES[0],
      `#resolve ${complaintId}: Road repaired`,
    );

    expect(result).toContain('resolved');

    const complaint = db
      .prepare('SELECT status FROM complaints WHERE id = ?')
      .get(complaintId) as { status: string };
    expect(complaint.status).toBe('resolved');
  });
});

// ============================================================
// Command parsing: #escalate
// ============================================================

describe('handleCommand — #escalate', () => {
  let complaintId: string;

  beforeEach(() => {
    complaintId = createComplaint(db, {
      phone: '919876543210',
      description: 'Serious issue',
      language: 'mr',
    });
  });

  it('parses #escalate and sets status to escalated', async () => {
    const service = createTestService();
    const result = await service.handleCommand(
      ADMIN_PHONES[0],
      `#escalate ${complaintId}: Needs MLA attention`,
    );

    expect(result).toContain('escalated');

    const complaint = db
      .prepare('SELECT status FROM complaints WHERE id = ?')
      .get(complaintId) as { status: string };
    expect(complaint.status).toBe('escalated');
  });
});

// ============================================================
// Command parsing: #hold
// ============================================================

describe('handleCommand — #hold', () => {
  let complaintId: string;

  beforeEach(() => {
    complaintId = createComplaint(db, {
      phone: '919876543210',
      description: 'Waiting for parts',
      language: 'mr',
    });
  });

  it('parses #hold and sets status to on_hold', async () => {
    const service = createTestService();
    const result = await service.handleCommand(
      ADMIN_PHONES[0],
      `#hold ${complaintId}: Waiting for budget approval`,
    );

    expect(result).toContain('on_hold');

    const complaint = db
      .prepare('SELECT status FROM complaints WHERE id = ?')
      .get(complaintId) as { status: string };
    expect(complaint.status).toBe('on_hold');
  });
});

// ============================================================
// Command parsing: #status
// ============================================================

describe('handleCommand — #status', () => {
  let complaintId: string;

  beforeEach(() => {
    complaintId = createComplaint(db, {
      phone: '919876543210',
      category: 'water_supply',
      description: 'No water for 3 days',
      location: 'Ward 7',
      language: 'mr',
    });
  });

  it('returns complaint details', async () => {
    const service = createTestService();
    const result = await service.handleCommand(
      ADMIN_PHONES[0],
      `#status ${complaintId}`,
    );

    expect(result).toContain(complaintId);
    expect(result).toContain('919876543210');
    expect(result).toContain('water_supply');
    expect(result).toContain('registered');
  });

  it('returns error for invalid complaint ID', async () => {
    const service = createTestService();
    const result = await service.handleCommand(
      ADMIN_PHONES[0],
      '#status RK-99999999-9999',
    );

    expect(result).toContain('not found');
  });
});

// ============================================================
// Command parsing: #unblock
// ============================================================

describe('handleCommand — #unblock', () => {
  it('unblocks a blocked user', async () => {
    // Block the user first
    db.prepare(
      `INSERT INTO users (phone, is_blocked, block_reason, first_seen, last_seen)
       VALUES ('919876543210', 1, 'Spam', datetime('now'), datetime('now'))`,
    ).run();

    const service = createTestService();
    const result = await service.handleCommand(
      ADMIN_PHONES[0],
      '#unblock +919876543210',
    );

    expect(result).toContain('unblocked');

    const user = db
      .prepare('SELECT is_blocked FROM users WHERE phone = ?')
      .get('919876543210') as { is_blocked: number };
    expect(user.is_blocked).toBe(0);
  });
});

// ============================================================
// Command parsing: #block
// ============================================================

describe('handleCommand — #block', () => {
  it('blocks a user with reason', async () => {
    db.prepare(
      `INSERT INTO users (phone, first_seen, last_seen)
       VALUES ('919876543210', datetime('now'), datetime('now'))`,
    ).run();

    const service = createTestService();
    const result = await service.handleCommand(
      ADMIN_PHONES[0],
      '#block +919876543210: Abusive messages',
    );

    expect(result).toContain('blocked');

    const user = db
      .prepare('SELECT is_blocked, block_reason FROM users WHERE phone = ?')
      .get('919876543210') as { is_blocked: number; block_reason: string };
    expect(user.is_blocked).toBe(1);
    expect(user.block_reason).toBe('Abusive messages');
  });
});

// ============================================================
// Command parsing: #role
// ============================================================

describe('handleCommand — #role', () => {
  beforeEach(() => {
    // Create the target user
    db.prepare(
      `INSERT INTO users (phone, role, first_seen, last_seen)
       VALUES ('919876543210', 'user', datetime('now'), datetime('now'))`,
    ).run();
  });

  it('superadmin caller can promote to admin', async () => {
    // Make the caller a superadmin
    db.prepare(
      `INSERT INTO users (phone, role, first_seen, last_seen)
       VALUES ('${ADMIN_PHONES[0]}', 'superadmin', datetime('now'), datetime('now'))`,
    ).run();

    const service = createTestService();
    const result = await service.handleCommand(
      ADMIN_PHONES[0],
      '#role +919876543210 admin',
    );

    expect(result).toContain('admin');

    const user = db
      .prepare('SELECT role FROM users WHERE phone = ?')
      .get('919876543210') as { role: string };
    expect(user.role).toBe('admin');
  });

  it('admin caller can set user/karyakarta role', async () => {
    // Make the caller an admin
    db.prepare(
      `INSERT INTO users (phone, role, first_seen, last_seen)
       VALUES ('${ADMIN_PHONES[0]}', 'admin', datetime('now'), datetime('now'))`,
    ).run();

    const service = createTestService();
    const result = await service.handleCommand(
      ADMIN_PHONES[0],
      '#role +919876543210 karyakarta',
    );

    expect(result).toContain('karyakarta');

    const user = db
      .prepare('SELECT role FROM users WHERE phone = ?')
      .get('919876543210') as { role: string };
    expect(user.role).toBe('karyakarta');
  });

  it('admin caller CANNOT promote to admin (hierarchy bypass)', async () => {
    // Make the caller an admin (not superadmin)
    db.prepare(
      `INSERT INTO users (phone, role, first_seen, last_seen)
       VALUES ('${ADMIN_PHONES[0]}', 'admin', datetime('now'), datetime('now'))`,
    ).run();

    const service = createTestService();
    const result = await service.handleCommand(
      ADMIN_PHONES[0],
      '#role +919876543210 admin',
    );

    expect(result).toContain('Only superadmin');

    // Verify role was NOT changed
    const user = db
      .prepare('SELECT role FROM users WHERE phone = ?')
      .get('919876543210') as { role: string };
    expect(user.role).toBe('user');
  });

  it('admin caller CANNOT promote to superadmin', async () => {
    db.prepare(
      `INSERT INTO users (phone, role, first_seen, last_seen)
       VALUES ('${ADMIN_PHONES[0]}', 'admin', datetime('now'), datetime('now'))`,
    ).run();

    const service = createTestService();
    const result = await service.handleCommand(
      ADMIN_PHONES[0],
      '#role +919876543210 superadmin',
    );

    expect(result).toContain('Only superadmin');

    const user = db
      .prepare('SELECT role FROM users WHERE phone = ?')
      .get('919876543210') as { role: string };
    expect(user.role).toBe('user');
  });

  it('non-admin caller cannot change roles', async () => {
    // Caller has no user record (defaults to 'user' role)
    const service = createTestService();
    const result = await service.handleCommand(
      '910000000000',
      '#role +919876543210 karyakarta',
    );

    expect(result).toContain('Only admin or superadmin');

    const user = db
      .prepare('SELECT role FROM users WHERE phone = ?')
      .get('919876543210') as { role: string };
    expect(user.role).toBe('user');
  });

  it('returns error for non-existent target user', async () => {
    db.prepare(
      `INSERT INTO users (phone, role, first_seen, last_seen)
       VALUES ('${ADMIN_PHONES[0]}', 'superadmin', datetime('now'), datetime('now'))`,
    ).run();

    const service = createTestService();
    const result = await service.handleCommand(
      ADMIN_PHONES[0],
      '#role +910000000000 admin',
    );

    expect(result).toContain('not found');
  });

  it('returns error for invalid role', async () => {
    db.prepare(
      `INSERT INTO users (phone, role, first_seen, last_seen)
       VALUES ('${ADMIN_PHONES[0]}', 'superadmin', datetime('now'), datetime('now'))`,
    ).run();

    const service = createTestService();
    const result = await service.handleCommand(
      ADMIN_PHONES[0],
      '#role +919876543210 moderator',
    );

    expect(result).toContain('Invalid role');
  });
});

// ============================================================
// Error handling
// ============================================================

describe('handleCommand — errors', () => {
  it('returns null for non-command messages', async () => {
    const service = createTestService();
    const result = await service.handleCommand(
      ADMIN_PHONES[0],
      'hello everyone',
    );
    expect(result).toBeNull();
  });

  it('returns usage help for malformed command', async () => {
    const service = createTestService();
    const result = await service.handleCommand(ADMIN_PHONES[0], '#');
    expect(result).toContain('Usage');
  });

  it('returns usage help for unknown command', async () => {
    const service = createTestService();
    const result = await service.handleCommand(
      ADMIN_PHONES[0],
      '#unknown foo bar',
    );
    expect(result).toContain('Unknown command');
  });

  // Auth is now based on group membership — only messages from the admin
  // group JID reach handleCommand (enforced in index.ts onMessage routing).
});

// ============================================================
// handleReply — natural language replies
// ============================================================

// Mock admin-reply module
vi.mock('./admin-reply.js', () => ({
  extractComplaintId: vi.fn(),
  interpretReply: vi.fn(),
}));

// Mock admin-instruction module
vi.mock('./admin-instruction.js', () => ({
  interpretInstruction: vi.fn(),
  executeInstruction: vi.fn(),
  HELP_MESSAGE: 'Supported instructions:\n• Add area: ...',
}));

// Mock admin-query-agent module
vi.mock('./admin-query-agent.js', () => ({
  handleAdminQuery: vi.fn(),
}));

import { handleAdminQuery } from './admin-query-agent.js';
const mockedHandleAdminQuery = vi.mocked(handleAdminQuery);

import { extractComplaintId, interpretReply } from './admin-reply.js';
import type { ReplyResult } from './admin-reply.js';

const mockedExtractId = vi.mocked(extractComplaintId);
const mockedInterpret = vi.mocked(interpretReply);

describe('handleReply', () => {
  let complaintId: string;

  beforeEach(() => {
    complaintId = createComplaint(db, {
      phone: '919876543210',
      category: 'water_supply',
      description: 'No water for 3 days',
      location: 'Ward 7',
      language: 'mr',
    });
    vi.clearAllMocks();
  });

  it('extracts complaint ID from quoted text and executes status_change', async () => {
    mockedExtractId.mockReturnValue(complaintId);
    mockedInterpret.mockResolvedValue({
      action: 'status_change',
      newStatus: 'in_progress',
      note: 'Assigned to team',
      confidence: 0.95,
    });

    const service = createTestService();
    const result = await service.handleReply(
      ADMIN_PHONES[0],
      'Mark this as in progress, assigned to team',
      `🆕 New Complaint\nID: ${complaintId}\nFrom: 919876543210`,
    );

    expect(result).toContain(complaintId);

    const complaint = db
      .prepare('SELECT status FROM complaints WHERE id = ?')
      .get(complaintId) as { status: string };
    expect(complaint.status).toBe('in_progress');
  });

  it('returns error when no complaint ID found in quoted text', async () => {
    mockedExtractId.mockReturnValue(null);

    const service = createTestService();
    const result = await service.handleReply(
      ADMIN_PHONES[0],
      'Do something',
      'Hello everyone',
    );

    expect(result).toContain('Could not find complaint ID');
  });

  it('returns error when complaint not found in DB', async () => {
    mockedExtractId.mockReturnValue('RK-99999999-9999');

    const service = createTestService();
    const result = await service.handleReply(
      ADMIN_PHONES[0],
      'Resolve this',
      'ID: RK-99999999-9999',
    );

    expect(result).toContain('not found');
  });

  it('handles add_note action without status change', async () => {
    mockedExtractId.mockReturnValue(complaintId);
    mockedInterpret.mockResolvedValue({
      action: 'add_note',
      note: 'Spoke with water dept',
      confidence: 0.9,
    });

    const service = createTestService();
    const result = await service.handleReply(
      ADMIN_PHONES[0],
      'Note: spoke with water dept',
      `ID: ${complaintId}`,
    );

    expect(result).toContain(complaintId);

    // Verify note was added
    const updates = db
      .prepare('SELECT * FROM complaint_updates WHERE complaint_id = ?')
      .all(complaintId) as { old_status: string; new_status: string; note: string }[];
    expect(updates).toHaveLength(1);
    expect(updates[0].note).toBe('Spoke with water dept');
    expect(updates[0].old_status).toBe(updates[0].new_status); // No status change
  });

  it('handles escalate_to_mla action', async () => {
    mockedExtractId.mockReturnValue(complaintId);
    mockedInterpret.mockResolvedValue({
      action: 'escalate_to_mla',
      note: 'Urgent issue',
      confidence: 0.9,
    });

    const service = createTestService();
    const result = await service.handleReply(
      ADMIN_PHONES[0],
      'Escalate this to MLA',
      `ID: ${complaintId}`,
    );

    expect(result).toContain('escalated');

    const complaint = db
      .prepare('SELECT status FROM complaints WHERE id = ?')
      .get(complaintId) as { status: string };
    expect(complaint.status).toBe('escalated');
  });

  it('handles forward_to_officer action (sets in_progress)', async () => {
    mockedExtractId.mockReturnValue(complaintId);
    mockedInterpret.mockResolvedValue({
      action: 'forward_to_officer',
      note: 'Forwarded to officer',
      confidence: 0.85,
    });

    const service = createTestService();
    const result = await service.handleReply(
      ADMIN_PHONES[0],
      'Send to officer',
      `ID: ${complaintId}`,
    );

    expect(result).toContain(complaintId);

    const complaint = db
      .prepare('SELECT status FROM complaints WHERE id = ?')
      .get(complaintId) as { status: string };
    expect(complaint.status).toBe('in_progress');
  });

  it('returns message for unrecognized intent', async () => {
    mockedExtractId.mockReturnValue(complaintId);
    mockedInterpret.mockResolvedValue({
      action: 'unrecognized',
      confidence: 0,
    });

    const service = createTestService();
    const result = await service.handleReply(
      ADMIN_PHONES[0],
      'Good morning',
      `ID: ${complaintId}`,
    );

    expect(result).toContain('#commands');
  });
});

// ============================================================
// Notification hints
// ============================================================

describe('notification reply hints', () => {
  it('new complaint notification includes reply hint', async () => {
    const service = createTestService();
    await service.notifyNewComplaint({
      complaintId: 'RK-20260212-0050',
      phone: '919876543210',
      description: 'Test',
      language: 'mr',
      status: 'registered',
    });

    const msg = sendMessage.mock.calls[0][1] as string;
    expect(msg).toContain('Reply to this message');
  });

  it('status change notification includes reply hint', async () => {
    const service = createTestService();
    await service.notifyStatusChange({
      complaintId: 'RK-20260212-0050',
      phone: '919876543210',
      oldStatus: 'registered',
      newStatus: 'in_progress',
      updatedBy: 'admin',
    });

    const msg = sendMessage.mock.calls[0][1] as string;
    expect(msg).toContain('Reply to this message');
  });
});

// ============================================================
// handleInstruction — natural language admin instructions
// ============================================================

import {
  interpretInstruction,
  executeInstruction,
  HELP_MESSAGE as INSTRUCTION_HELP,
} from './admin-instruction.js';
import type { InstructionResult } from './admin-instruction.js';

const mockedInterpretInstruction = vi.mocked(interpretInstruction);
const mockedExecuteInstruction = vi.mocked(executeInstruction);

describe('handleInstruction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('strips @ComplaintBot prefix and interprets text', async () => {
    mockedInterpretInstruction.mockResolvedValue({
      action: 'add_area',
      areaName: 'Shivaji Nagar',
      confidence: 0.95,
    });
    mockedExecuteInstruction.mockReturnValue("Area 'Shivaji Nagar' created with slug 'shivaji-nagar'.");

    const service = createTestService();
    const result = await service.handleInstruction(
      ADMIN_PHONES[0],
      '@ComplaintBot add Shivaji Nagar area',
    );

    expect(mockedInterpretInstruction).toHaveBeenCalledWith('add Shivaji Nagar area');
    expect(mockedExecuteInstruction).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ action: 'add_area' }),
      ADMIN_PHONES[0],
    );
    expect(result).toContain('Shivaji Nagar');
  });

  it('returns help when text is empty after stripping prefix', async () => {
    const service = createTestService();
    const result = await service.handleInstruction(
      ADMIN_PHONES[0],
      '@ComplaintBot',
    );

    expect(result).toBe(INSTRUCTION_HELP);
    expect(mockedInterpretInstruction).not.toHaveBeenCalled();
  });

  it('routes unrecognized instruction to query agent', async () => {
    mockedInterpretInstruction.mockResolvedValue({
      action: 'unrecognized',
      confidence: 0.95,
    });
    mockedHandleAdminQuery.mockResolvedValue('There are 3 complaints today.');

    const service = createTestService();
    const result = await service.handleInstruction(
      ADMIN_PHONES[0],
      '@ComplaintBot how many complaints today?',
    );

    expect(mockedHandleAdminQuery).toHaveBeenCalledWith(
      db,
      'how many complaints today?',
    );
    expect(result).toBe('There are 3 complaints today.');
    expect(mockedExecuteInstruction).not.toHaveBeenCalled();
  });

  it('handles text without @prefix (for voice transcripts)', async () => {
    mockedInterpretInstruction.mockResolvedValue({
      action: 'list_areas',
      confidence: 0.95,
    });
    mockedExecuteInstruction.mockReturnValue('No active areas found.');

    const service = createTestService();
    const result = await service.handleInstruction(
      ADMIN_PHONES[0],
      'show all areas',
    );

    expect(mockedInterpretInstruction).toHaveBeenCalledWith('show all areas');
    expect(result).toContain('No active areas');
  });

  it('strips case-insensitive @complaintbot prefix', async () => {
    mockedInterpretInstruction.mockResolvedValue({
      action: 'list_karyakartas',
      confidence: 0.95,
    });
    mockedExecuteInstruction.mockReturnValue('No active karyakartas found.');

    const service = createTestService();
    await service.handleInstruction(
      ADMIN_PHONES[0],
      '@complaintbot list karyakartas',
    );

    expect(mockedInterpretInstruction).toHaveBeenCalledWith('list karyakartas');
  });
});
