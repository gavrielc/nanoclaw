/**
 * admin-instruction.ts — AI-powered natural language instruction interpreter.
 *
 * Classifies admin management instructions (add area, add karyakarta, assign, etc.)
 * from @ComplaintBot-tagged text or voice transcripts in the admin group.
 * Uses Claude Sonnet via the Agent SDK query() with maxTurns: 1 (single inference).
 */
import type Database from 'better-sqlite3';
import { query } from '@anthropic-ai/claude-agent-sdk';

import { executeAdminCommand } from './admin-commands.js';
import { addKaryakarta, createArea, getArea, slugify } from './area-db.js';
import { matchArea } from './area-matcher.js';
import { REPLY_INTERPRETER_MODEL } from './config.js';
import { logger } from './logger.js';
import { normalizePhone } from './utils.js';

export type InstructionAction =
  | 'add_area'
  | 'add_karyakarta'
  | 'assign_area'
  | 'unassign_area'
  | 'remove_karyakarta'
  | 'remove_area'
  | 'rename_area'
  | 'list_karyakartas'
  | 'list_areas'
  | 'unrecognized';

export interface InstructionResult {
  action: InstructionAction;
  phone?: string;
  areaName?: string;
  newAreaName?: string;
  confidence: number;
}

export const HELP_MESSAGE = `Supported instructions:
• Add area: "add Shivaji Nagar area"
• Add karyakarta: "make 9876543210 karyakarta for Shivaji Nagar"
• Assign area: "assign 9876543210 to Shivaji Nagar"
• Unassign area: "remove 9876543210 from Shivaji Nagar"
• Remove karyakarta: "remove karyakarta 9876543210"
• Remove area: "remove Shivaji Nagar area"
• Rename area: "rename Shivaji Nagar to Shivaji Nagar Ward 5"
• List karyakartas: "show all karyakartas"
• List areas: "show all areas"

Tag @ComplaintBot or send a voice note in the admin group.`;

/**
 * Build the instruction classification prompt.
 * Multilingual (English/Hindi/Marathi) with examples.
 */
export function buildInstructionPrompt(text: string): string {
  return `You are classifying an admin's management instruction for a constituency complaint system. Analyze the text and return a JSON object identifying the action.

Available actions:
- "add_area" — create a new area. Extract "areaName".
- "add_karyakarta" — add a karyakarta (field worker) and optionally assign to an area. Extract "phone" and optionally "areaName".
- "assign_area" — assign an existing karyakarta to an area. Extract "phone" and "areaName".
- "unassign_area" — unassign a karyakarta from an area. Extract "phone" and "areaName".
- "remove_karyakarta" — deactivate a karyakarta. Extract "phone".
- "remove_area" — deactivate an area. Extract "areaName".
- "rename_area" — rename an area. Extract "areaName" (old name) and "newAreaName".
- "list_karyakartas" — list all karyakartas.
- "list_areas" — list all areas.
- "unrecognized" — instruction doesn't match any management operation.

Examples:
- "add Shivaji Nagar area" → {"action":"add_area","areaName":"Shivaji Nagar","confidence":0.95}
- "शिवाजी नगर एरिया ॲड करा" → {"action":"add_area","areaName":"शिवाजी नगर","confidence":0.9}
- "make 9876543210 karyakarta for Shivaji Nagar" → {"action":"add_karyakarta","phone":"9876543210","areaName":"Shivaji Nagar","confidence":0.95}
- "9876543210 ला शिवाजी नगर चा कार्यकर्ता बनवा" → {"action":"add_karyakarta","phone":"9876543210","areaName":"शिवाजी नगर","confidence":0.9}
- "9876543210 ko Shivaji Nagar ka karyakarta banao" → {"action":"add_karyakarta","phone":"9876543210","areaName":"Shivaji Nagar","confidence":0.9}
- "add karyakarta 9876543210" → {"action":"add_karyakarta","phone":"9876543210","confidence":0.9}
- "assign 9876543210 to Shivaji Nagar" → {"action":"assign_area","phone":"9876543210","areaName":"Shivaji Nagar","confidence":0.95}
- "remove 9876543210 from Shivaji Nagar" → {"action":"unassign_area","phone":"9876543210","areaName":"Shivaji Nagar","confidence":0.9}
- "remove karyakarta 9876543210" → {"action":"remove_karyakarta","phone":"9876543210","confidence":0.9}
- "9876543210 कार्यकर्ता काढा" → {"action":"remove_karyakarta","phone":"9876543210","confidence":0.85}
- "remove Shivaji Nagar area" → {"action":"remove_area","areaName":"Shivaji Nagar","confidence":0.9}
- "rename Shivaji Nagar to Shivaji Nagar Ward 5" → {"action":"rename_area","areaName":"Shivaji Nagar","newAreaName":"Shivaji Nagar Ward 5","confidence":0.9}
- "show all karyakartas" / "सर्व कार्यकर्ते दाखवा" → {"action":"list_karyakartas","confidence":0.95}
- "show all areas" / "सर्व भाग दाखवा" → {"action":"list_areas","confidence":0.95}
- "good morning" → {"action":"unrecognized","confidence":0.95}

IMPORTANT:
- Extract phone numbers exactly as they appear (digits, may include +91 or country code).
- Extract area names as spoken — do NOT slugify or modify them.
- Respond with ONLY a JSON object. No explanation.

Instruction text: "${text}"`;
}

/**
 * Parse AI response text into an InstructionResult.
 * Handles JSON wrapped in code fences or surrounded by text.
 */
export function parseInstructionResponse(text: string): InstructionResult {
  if (!text) return { action: 'unrecognized', confidence: 0 };

  // Strip markdown code fences
  const cleaned = text.replace(/```(?:json)?\s*\n?/g, '').trim();

  // Try to extract JSON object from text
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { action: 'unrecognized', confidence: 0 };

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.action || typeof parsed.action !== 'string') {
      return { action: 'unrecognized', confidence: 0 };
    }
    return {
      action: parsed.action,
      phone: parsed.phone,
      areaName: parsed.areaName,
      newAreaName: parsed.newAreaName,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    };
  } catch {
    return { action: 'unrecognized', confidence: 0 };
  }
}

/**
 * Interpret a natural language instruction using Claude Sonnet.
 */
export async function interpretInstruction(
  text: string,
): Promise<InstructionResult> {
  const prompt = buildInstructionPrompt(text);

  try {
    let resultText = '';

    const q = query({
      prompt,
      options: {
        model: REPLY_INTERPRETER_MODEL,
        maxTurns: 1,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        disallowedTools: [
          'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
          'NotebookEdit', 'Task',
        ],
      },
    });

    for await (const message of q) {
      if (message.type === 'result' && message.subtype === 'success' && 'result' in message) {
        resultText = (message as { result: string }).result;
      }
    }

    const result = parseInstructionResponse(resultText);

    logger.info(
      {
        action: result.action,
        phone: result.phone,
        areaName: result.areaName,
        confidence: result.confidence,
        textLength: text.length,
      },
      'Instruction interpreted',
    );

    return result;
  } catch (err) {
    logger.error({ err }, 'Instruction interpretation failed');
    return { action: 'unrecognized', confidence: 0 };
  }
}

/**
 * Resolve an area name to an existing area slug, or auto-create if needed.
 * Returns { slug, created } or { error }.
 */
function resolveArea(
  db: Database.Database,
  areaName: string,
  autoCreate: boolean,
): { slug: string; created: boolean } | { error: string } {
  // 1. Try exact slug match
  const directSlug = slugify(areaName);
  const directArea = getArea(db, directSlug);
  if (directArea) {
    return { slug: directSlug, created: false };
  }

  // 2. Fuzzy match
  const matches = matchArea(db, areaName);
  if (matches.length > 0 && matches[0].confidence >= 0.8) {
    return { slug: matches[0].id, created: false };
  }

  // 3. Auto-create if allowed
  if (autoCreate) {
    try {
      const created = createArea(db, { name: areaName });
      return { slug: created.id, created: true };
    } catch {
      return { error: `Failed to create area '${areaName}'.` };
    }
  }

  return { error: `Area '${areaName}' not found.` };
}

/**
 * Execute an interpreted instruction against the database.
 * Bridges AI result to existing executeAdminCommand() infrastructure.
 */
export function executeInstruction(
  db: Database.Database,
  instruction: InstructionResult,
  senderPhone: string,
): string {
  switch (instruction.action) {
    case 'add_area': {
      if (!instruction.areaName) {
        return 'Please specify an area name.';
      }
      const slug = slugify(instruction.areaName);
      const existing = getArea(db, slug);
      if (existing) {
        return `Area '${instruction.areaName}' (${slug}) already exists.`;
      }
      const created = createArea(db, { name: instruction.areaName });
      return `Area '${created.name}' created with slug '${created.id}'.`;
    }

    case 'add_karyakarta': {
      if (!instruction.phone) {
        return 'Please specify a phone number for the karyakarta.';
      }
      let phone: string;
      try {
        phone = normalizePhone(instruction.phone);
      } catch {
        return `Invalid phone number '${instruction.phone}'.`;
      }

      if (instruction.areaName) {
        const area = resolveArea(db, instruction.areaName, true);
        if ('error' in area) return area.error;
        const prefix = area.created ? `Area '${instruction.areaName}' auto-created. ` : '';
        const result = executeAdminCommand(db, 'add-karyakarta', `${phone} ${area.slug}`, senderPhone);
        return prefix + result.response;
      }
      // No area specified — add karyakarta without area assignment
      addKaryakarta(db, phone, senderPhone);
      return `Karyakarta ${phone} added (no area assigned).`;
    }

    case 'assign_area': {
      if (!instruction.phone) {
        return 'Please specify a phone number.';
      }
      if (!instruction.areaName) {
        return 'Please specify an area name.';
      }
      let phone: string;
      try {
        phone = normalizePhone(instruction.phone);
      } catch {
        return `Invalid phone number '${instruction.phone}'.`;
      }
      const area = resolveArea(db, instruction.areaName, true);
      if ('error' in area) return area.error;
      const prefix = area.created ? `Area '${instruction.areaName}' auto-created. ` : '';
      const result = executeAdminCommand(db, 'assign-area', `${phone} ${area.slug}`, senderPhone);
      return prefix + result.response;
    }

    case 'unassign_area': {
      if (!instruction.phone) {
        return 'Please specify a phone number.';
      }
      if (!instruction.areaName) {
        return 'Please specify an area name.';
      }
      let phone: string;
      try {
        phone = normalizePhone(instruction.phone);
      } catch {
        return `Invalid phone number '${instruction.phone}'.`;
      }
      const area = resolveArea(db, instruction.areaName, false);
      if ('error' in area) return area.error;
      const result = executeAdminCommand(db, 'unassign-area', `${phone} ${area.slug}`, senderPhone);
      return result.response;
    }

    case 'remove_karyakarta': {
      if (!instruction.phone) {
        return 'Please specify a phone number.';
      }
      let phone: string;
      try {
        phone = normalizePhone(instruction.phone);
      } catch {
        return `Invalid phone number '${instruction.phone}'.`;
      }
      const result = executeAdminCommand(db, 'remove-karyakarta', phone, senderPhone);
      return result.response;
    }

    case 'remove_area': {
      if (!instruction.areaName) {
        return 'Please specify an area name.';
      }
      const area = resolveArea(db, instruction.areaName, false);
      if ('error' in area) return area.error;
      const result = executeAdminCommand(db, 'remove-area', area.slug, senderPhone);
      return result.response;
    }

    case 'rename_area': {
      if (!instruction.areaName) {
        return 'Please specify the current area name.';
      }
      if (!instruction.newAreaName) {
        return 'Please specify the new area name.';
      }
      const area = resolveArea(db, instruction.areaName, false);
      if ('error' in area) return area.error;
      const result = executeAdminCommand(db, 'rename-area', `${area.slug} ${instruction.newAreaName}`, senderPhone);
      return result.response;
    }

    case 'list_karyakartas': {
      const result = executeAdminCommand(db, 'list-karyakartas', '', senderPhone);
      return result.response;
    }

    case 'list_areas': {
      const result = executeAdminCommand(db, 'list-areas', '', senderPhone);
      return result.response;
    }

    case 'unrecognized':
    default:
      return HELP_MESSAGE;
  }
}
