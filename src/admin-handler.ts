/**
 * admin-handler.ts — Admin group notification and command handling.
 *
 * Listens on the event bus for complaint lifecycle events and posts
 * formatted notifications to the WhatsApp admin group. Also parses
 * # commands from admin group messages.
 */
import type Database from 'better-sqlite3';

import { executeAdminCommand, isKaryakartaCommand } from './admin-commands.js';
import {
  executeInstruction,
  HELP_MESSAGE as INSTRUCTION_HELP,
  interpretInstruction,
} from './admin-instruction.js';
import { extractComplaintId, interpretReply } from './admin-reply.js';
import {
  addComplaintNote,
  transitionComplaintStatus,
} from './complaint-utils.js';
import { eventBus } from './event-bus.js';
import type { ComplaintEvent, StatusChangeEvent } from './event-bus.js';
import { logger } from './logger.js';
import { escalateToMla } from './mla-escalation.js';
import { getUserRole, setUserRole } from './roles.js';
import type { UserRole } from './types.js';
import { VALID_COMPLAINT_STATUSES } from './types.js';
import { formatStatus, normalizePhone } from './utils.js';

export interface AdminServiceDeps {
  db: Database.Database;
  sendMessage: (jid: string, text: string) => Promise<void>;
  adminGroupJid: string;
  adminPhones: string[];
  mlaPhone: string;
}

const VALID_STATUSES = VALID_COMPLAINT_STATUSES as readonly string[];

/** Localized reply messages for admin/karyakarta reply handlers. */
function replyMsg(
  lang: string,
  key: 'status_updated' | 'note_added' | 'forwarded' | 'unrecognized' | 'approved' | 'rejected',
  ...args: string[]
): string {
  const templates: Record<string, Record<string, string>> = {
    status_updated: {
      mr: `तक्रार ${args[0]} स्थिती अद्ययावत: ${args[1]}.`,
      hi: `शिकायत ${args[0]} स्थिति अपडेट: ${args[1]}.`,
      en: `Complaint ${args[0]} updated to ${args[1]}.`,
    },
    note_added: {
      mr: `तक्रार ${args[0]} वर टीप जोडली.`,
      hi: `शिकायत ${args[0]} पर नोट जोड़ी गई.`,
      en: `Note added to ${args[0]}.`,
    },
    forwarded: {
      mr: `तक्रार ${args[0]} अधिकाऱ्याकडे पाठवली (स्थिती: कार्यरत).`,
      hi: `शिकायत ${args[0]} अधिकारी को भेजी गई (स्थिति: कार्यरत).`,
      en: `Complaint ${args[0]} forwarded to officer (status: in_progress).`,
    },
    approved: {
      mr: `तक्रार ${args[0]} मंजूर आणि प्रशासन गटाकडे पाठवली.`,
      hi: `शिकायत ${args[0]} स्वीकृत और प्रशासन समूह को भेजी गई.`,
      en: `Complaint ${args[0]} approved and forwarded to admin group.`,
    },
    rejected: {
      mr: `तक्रार ${args[0]} नाकारली (${args[1]}).`,
      hi: `शिकायत ${args[0]} अस्वीकृत (${args[1]}).`,
      en: `Complaint ${args[0]} rejected (${args[1]}).`,
    },
    unrecognized: {
      mr: 'तुमचा प्रतिसाद समजला नाही. कृपया #commands वापरा किंवा स्पष्ट कृती सांगा.',
      hi: 'आपका जवाब समझ नहीं आया. कृपया #commands इस्तेमाल करें या स्पष्ट कार्रवाई बताएं.',
      en: 'Could not understand your reply. Use #commands or reply with a clear action.',
    },
  };
  const t = templates[key];
  return t?.[lang] ?? t?.en ?? `Complaint ${args[0] ?? ''}: ${key}`;
}

const VALID_ROLES = ['user', 'karyakarta', 'admin', 'superadmin'];

const USAGE_TEXT = `Usage:
#update <ID> <status>: <note>
#resolve <ID>: <note>
#escalate <ID>: <note>
#hold <ID>: <note>
#status <ID>
#unblock <phone>
#block <phone>: <reason>
#role <phone> <role>
#add-karyakarta <phone> <area-slug>
#remove-karyakarta <phone>
#assign-area <phone> <area-slug>
#unassign-area <phone> <area-slug>
#add-area <Name> | <मराठी> | <हिंदी>
#rename-area <old-slug> <New Name>
#remove-area <area-slug>
#list-karyakartas
#list-areas
#override-reject <ID>: <reason>
#escalate-to-mla <ID>: <reason>`;

export class AdminService {
  constructor(private deps: AdminServiceDeps) {}

  /** Subscribe to event bus events. */
  init(): void {
    eventBus.on('complaint:created', (event) => {
      this.notifyNewComplaint(event).catch((err) =>
        logger.error({ err }, 'Failed to send new-complaint notification'),
      );
    });

    eventBus.on('complaint:status-changed', (event) => {
      this.notifyStatusChange(event).catch((err) =>
        logger.error({ err }, 'Failed to send status-change notification'),
      );
    });
  }

  /** Notify admin group of a new complaint. */
  async notifyNewComplaint(event: ComplaintEvent): Promise<void> {
    if (!this.deps.adminGroupJid) return;
    const lines = [
      '\u{1F195} New Complaint',
      `ID: ${event.complaintId}`,
      `From: ${event.phone}`,
    ];

    if (event.category) {
      lines.push(`Category: ${event.category}`);
    }
    if (event.location) {
      lines.push(`Location: ${event.location}`);
    }

    lines.push(`Description: ${event.description}`);
    lines.push(`Status: ${formatStatus(event.status)}`);
    lines.push('');
    lines.push('Reply to this message to take action.');

    await this.deps.sendMessage(this.deps.adminGroupJid, lines.join('\n'));
  }

  /** Notify admin group of a status change. */
  async notifyStatusChange(event: StatusChangeEvent): Promise<void> {
    if (!this.deps.adminGroupJid) return;
    const lines = [
      '\u{1F4CB} Status Updated',
      `ID: ${event.complaintId}`,
      `Status: ${formatStatus(event.oldStatus)} \u{2192} ${formatStatus(event.newStatus)}`,
      `By: ${event.updatedBy}`,
    ];

    if (event.note) {
      lines.push(`Note: ${event.note}`);
    }
    lines.push('');
    lines.push('Reply to this message to take action.');

    await this.deps.sendMessage(this.deps.adminGroupJid, lines.join('\n'));
  }

  /**
   * Handle an admin command from a group message.
   * Returns a response string, or null if the message is not a command.
   */
  async handleCommand(
    senderPhone: string,
    text: string,
  ): Promise<string | null> {
    const trimmed = text.trim();

    // Not a command
    if (!trimmed.startsWith('#')) return null;

    // Parse: #command rest
    const match = trimmed.match(/^#([\w-]+)\s*(.*)$/s);
    if (!match) return USAGE_TEXT;

    const command = match[1].toLowerCase();
    const rest = match[2].trim();

    // Auth: messages only reach here from the admin group JID (enforced by
    // onMessage routing in index.ts), so group membership IS the authorization.

    switch (command) {
      case 'update':
        return this.handleUpdate(senderPhone, rest);
      case 'resolve':
        return this.handleStatusShorthand(senderPhone, rest, 'resolved');
      case 'escalate':
        return this.handleStatusShorthand(senderPhone, rest, 'escalated');
      case 'hold':
        return this.handleStatusShorthand(senderPhone, rest, 'on_hold');
      case 'status':
        return this.handleStatus(rest);
      case 'unblock':
        return this.handleUnblock(rest);
      case 'block':
        return this.handleBlock(rest);
      case 'role':
        return this.handleRole(senderPhone, rest);
      case 'escalate-to-mla':
        return this.handleEscalateToMla(senderPhone, rest);
      default:
        if (isKaryakartaCommand(command)) {
          return executeAdminCommand(this.deps.db, command, rest, senderPhone)
            .response;
        }
        return `Unknown command: #${command}\n\n${USAGE_TEXT}`;
    }
  }

  /**
   * Handle a natural language reply to a complaint notification.
   * Extracts complaint ID from the quoted message, classifies intent via AI,
   * and executes the appropriate action.
   */
  async handleReply(
    senderPhone: string,
    replyText: string,
    quotedText: string,
  ): Promise<string> {
    const complaintId = extractComplaintId(quotedText);
    if (!complaintId) {
      return 'Could not find complaint ID in the quoted message.';
    }

    const complaint = this.deps.db
      .prepare(
        'SELECT id, phone, category, description, status, language FROM complaints WHERE id = ?',
      )
      .get(complaintId) as
      | { id: string; phone: string; category: string | null; description: string; status: string; language: string }
      | undefined;

    if (!complaint) {
      return `Complaint '${complaintId}' not found.`;
    }

    const result = await interpretReply(
      replyText,
      complaint,
      'admin',
      VALID_STATUSES as string[],
    );

    const lang = complaint.language || 'mr';

    switch (result.action) {
      case 'status_change': {
        if (!result.newStatus || !VALID_STATUSES.includes(result.newStatus)) {
          return `Invalid status '${result.newStatus}'. Valid: ${VALID_STATUSES.join(', ')}`;
        }
        const oldStatus = transitionComplaintStatus(
          this.deps.db,
          complaintId,
          result.newStatus,
          result.note,
          senderPhone,
        );
        if (oldStatus === null) return `Complaint '${complaintId}' not found.`;
        return replyMsg(lang, 'status_updated', complaintId, formatStatus(result.newStatus));
      }

      case 'add_note': {
        addComplaintNote(
          this.deps.db,
          complaintId,
          result.note ?? replyText,
          senderPhone,
        );
        return replyMsg(lang, 'note_added', complaintId);
      }

      case 'escalate_to_mla': {
        return escalateToMla(
          {
            db: this.deps.db,
            sendMessage: this.deps.sendMessage,
            adminGroupJid: this.deps.adminGroupJid,
            mlaPhone: this.deps.mlaPhone,
          },
          complaintId,
          result.note ?? 'Escalated via reply',
          senderPhone,
        );
      }

      case 'forward_to_officer': {
        const note = result.note ?? 'Forwarded to concerned officer';
        transitionComplaintStatus(
          this.deps.db,
          complaintId,
          'in_progress',
          note,
          senderPhone,
        );
        return replyMsg(lang, 'forwarded', complaintId);
      }

      default:
        return replyMsg(lang, 'unrecognized');
    }
  }

  /**
   * Handle a natural language admin instruction (via @ComplaintBot tag or voice).
   * Strips the @tag prefix, interprets intent via AI, and executes the action.
   */
  async handleInstruction(
    senderPhone: string,
    text: string,
  ): Promise<string> {
    // Strip @ComplaintBot prefix (case-insensitive)
    const stripped = text.replace(/^@\S+\s*/i, '').trim();

    if (!stripped) {
      return INSTRUCTION_HELP;
    }

    const result = await interpretInstruction(stripped);

    if (result.action === 'unrecognized') {
      return INSTRUCTION_HELP;
    }

    return executeInstruction(this.deps.db, result, senderPhone);
  }

  // --- Command handlers ---

  private handleUpdate(senderPhone: string, rest: string): string {
    // Format: <ID> <status>: <note>  OR  <ID> <status>
    const match = rest.match(/^(\S+)\s+(\S+)(?:\s*:\s*(.+))?$/s);
    if (!match) return `Invalid format.\nUsage: #update <ID> <status>: <note>`;

    const [, id, status, note] = match;
    return this.updateComplaintStatus(senderPhone, id, status, note?.trim());
  }

  private handleStatusShorthand(
    senderPhone: string,
    rest: string,
    targetStatus: string,
  ): string {
    // Format: <ID>: <note>  OR  <ID>
    const match = rest.match(/^(\S+)(?:\s*:\s*(.+))?$/s);
    if (!match)
      return `Invalid format.\nUsage: #${targetStatus === 'resolved' ? 'resolve' : targetStatus === 'escalated' ? 'escalate' : 'hold'} <ID>: <note>`;

    const [, id, note] = match;
    return this.updateComplaintStatus(
      senderPhone,
      id,
      targetStatus,
      note?.trim(),
    );
  }

  private updateComplaintStatus(
    updatedBy: string,
    id: string,
    status: string,
    note?: string,
  ): string {
    // S-4: Validate complaint ID format
    if (!/^[A-Z]{1,5}-\d{8}-\d{4}$/.test(id)) {
      return `Invalid complaint ID format '${id}'.`;
    }

    if (!VALID_STATUSES.includes(status)) {
      return `Invalid status '${status}'. Valid: ${VALID_STATUSES.join(', ')}`;
    }

    const oldStatus = transitionComplaintStatus(
      this.deps.db,
      id,
      status,
      note,
      updatedBy,
    );

    if (oldStatus === null) {
      return `Complaint '${id}' not found.`;
    }

    return `Complaint ${id} updated to ${status}.`;
  }

  private handleStatus(rest: string): string {
    const id = rest.trim();
    if (!id) return 'Usage: #status <ID>';

    // S-4: Validate complaint ID format
    if (!/^[A-Z]{1,5}-\d{8}-\d{4}$/.test(id)) {
      return `Invalid complaint ID format '${id}'.`;
    }

    const complaint = this.deps.db
      .prepare('SELECT * FROM complaints WHERE id = ?')
      .get(id) as
      | {
          id: string;
          phone: string;
          category: string | null;
          description: string;
          location: string | null;
          status: string;
          priority: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!complaint) {
      return `Complaint '${id}' not found.`;
    }

    const lines = [
      `Complaint ${complaint.id}`,
      `Phone: ${complaint.phone}`,
      `Category: ${complaint.category ?? 'N/A'}`,
      `Description: ${complaint.description}`,
      `Location: ${complaint.location ?? 'N/A'}`,
      `Status: ${complaint.status}`,
      `Priority: ${complaint.priority}`,
      `Created: ${complaint.created_at}`,
      `Updated: ${complaint.updated_at}`,
    ];

    return lines.join('\n');
  }

  private handleUnblock(rest: string): string {
    let phone: string;
    try {
      phone = normalizePhone(rest.trim());
    } catch {
      return 'Usage: #unblock <phone>';
    }

    const user = this.deps.db
      .prepare('SELECT phone FROM users WHERE phone = ?')
      .get(phone) as { phone: string } | undefined;

    if (!user) {
      return `User ${phone} not found.`;
    }

    this.deps.db
      .prepare(
        'UPDATE users SET is_blocked = 0, blocked_until = NULL, block_reason = NULL WHERE phone = ?',
      )
      .run(phone);

    logger.info({ admin: rest.trim(), target: phone, action: 'unblock' }, 'Admin action');

    return `User ${phone} unblocked.`;
  }

  private handleBlock(rest: string): string {
    // Format: <phone>: <reason>  OR  <phone>
    const match = rest.match(/^(\S+)(?:\s*:\s*(.+))?$/s);
    if (!match) return 'Usage: #block <phone>: <reason>';

    let phone: string;
    try {
      phone = normalizePhone(match[1]);
    } catch {
      return 'Usage: #block <phone>: <reason>';
    }
    const reason = match[2]?.trim() ?? 'Blocked by admin';

    const user = this.deps.db
      .prepare('SELECT phone FROM users WHERE phone = ?')
      .get(phone) as { phone: string } | undefined;

    if (!user) {
      return `User ${phone} not found.`;
    }

    // Use block_duration_hours from tenant config for admin blocks too
    const configRow = this.deps.db
      .prepare(
        "SELECT value FROM tenant_config WHERE key = 'block_duration_hours'",
      )
      .get() as { value: string } | undefined;
    const hours = configRow ? Number(configRow.value) : 24;
    const blockedUntil = new Date(Date.now() + hours * 60 * 60 * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z');

    this.deps.db
      .prepare(
        'UPDATE users SET is_blocked = 1, block_reason = ?, blocked_until = ? WHERE phone = ?',
      )
      .run(reason, blockedUntil, phone);

    logger.info({ admin: match[1], target: phone, action: 'block' }, 'Admin action');

    return `User ${phone} blocked for ${hours}h. Reason: ${reason}`;
  }

  private handleRole(senderPhone: string, rest: string): string {
    // Format: <phone> <role>
    const match = rest.match(/^(\S+)\s+(\S+)$/);
    if (!match) return 'Usage: #role <phone> <role>';

    let phone: string;
    try {
      phone = normalizePhone(match[1]);
    } catch {
      return 'Usage: #role <phone> <role>';
    }
    const role = match[2].toLowerCase();

    if (!VALID_ROLES.includes(role)) {
      return `Invalid role '${role}'. Valid: ${VALID_ROLES.join(', ')}`;
    }

    const user = this.deps.db
      .prepare('SELECT phone FROM users WHERE phone = ?')
      .get(phone) as { phone: string } | undefined;

    if (!user) {
      return `User ${phone} not found.`;
    }

    const callerRole = getUserRole(this.deps.db, senderPhone);
    const result = setUserRole(
      this.deps.db,
      phone,
      role as UserRole,
      callerRole,
    );

    if (result !== 'OK') {
      return result;
    }

    logger.info({ admin: senderPhone, target: phone, action: 'role', role }, 'Admin action');

    return `User ${phone} role set to ${role}.`;
  }

  private async handleEscalateToMla(
    senderPhone: string,
    rest: string,
  ): Promise<string> {
    const match = rest.match(/^(\S+)(?:\s*:\s*(.+))?$/s);
    if (!match)
      return 'Invalid format.\nUsage: #escalate-to-mla <ID>: <reason>';

    const [, id, reason] = match;
    return escalateToMla(
      {
        db: this.deps.db,
        sendMessage: this.deps.sendMessage,
        adminGroupJid: this.deps.adminGroupJid,
        mlaPhone: this.deps.mlaPhone,
      },
      id,
      reason?.trim() ?? 'Escalated by admin',
      senderPhone,
    );
  }
}
