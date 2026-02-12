/**
 * admin-instruction.test.ts — Tests for NL admin instruction interpreter + executor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  parseInstructionResponse,
  interpretInstruction,
  executeInstruction,
  HELP_MESSAGE,
  type InstructionResult,
} from './admin-instruction.js';
import { clearAreaCache } from './area-matcher.js';
import { createTestDb, seedArea, seedKaryakarta } from './test-helpers.js';
import type Database from 'better-sqlite3';

// Mock the Agent SDK query function
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
const mockedQuery = vi.mocked(query);

// --- parseInstructionResponse ---

describe('parseInstructionResponse', () => {
  it('parses valid JSON response with all fields', () => {
    const json = '{"action":"add_karyakarta","phone":"9876543210","areaName":"Shivaji Nagar","confidence":0.95}';
    const result = parseInstructionResponse(json);
    expect(result).toEqual({
      action: 'add_karyakarta',
      phone: '9876543210',
      areaName: 'Shivaji Nagar',
      newAreaName: undefined,
      confidence: 0.95,
    });
  });

  it('parses JSON wrapped in code fences', () => {
    const response = '```json\n{"action":"add_area","areaName":"Gandhi Nagar","confidence":0.9}\n```';
    const result = parseInstructionResponse(response);
    expect(result.action).toBe('add_area');
    expect(result.areaName).toBe('Gandhi Nagar');
  });

  it('parses JSON wrapped in backtick-only fences', () => {
    const response = '```\n{"action":"list_areas","confidence":0.95}\n```';
    const result = parseInstructionResponse(response);
    expect(result.action).toBe('list_areas');
  });

  it('extracts JSON embedded in surrounding text', () => {
    const response = 'Here is the result:\n{"action":"remove_karyakarta","phone":"9876543210","confidence":0.85}\nDone.';
    const result = parseInstructionResponse(response);
    expect(result.action).toBe('remove_karyakarta');
    expect(result.phone).toBe('9876543210');
  });

  it('returns unrecognized for missing action field', () => {
    const result = parseInstructionResponse('{"phone":"9876543210","confidence":0.9}');
    expect(result.action).toBe('unrecognized');
    expect(result.confidence).toBe(0);
  });

  it('returns unrecognized for empty string', () => {
    const result = parseInstructionResponse('');
    expect(result.action).toBe('unrecognized');
  });

  it('returns unrecognized for invalid JSON', () => {
    const result = parseInstructionResponse('I do not understand this instruction');
    expect(result.action).toBe('unrecognized');
    expect(result.confidence).toBe(0);
  });

  it('returns unrecognized for non-string action', () => {
    const result = parseInstructionResponse('{"action":123,"confidence":0.5}');
    expect(result.action).toBe('unrecognized');
  });

  it('preserves rename fields', () => {
    const json = '{"action":"rename_area","areaName":"Shivaji Nagar","newAreaName":"Shivaji Nagar Ward 5","confidence":0.9}';
    const result = parseInstructionResponse(json);
    expect(result.action).toBe('rename_area');
    expect(result.areaName).toBe('Shivaji Nagar');
    expect(result.newAreaName).toBe('Shivaji Nagar Ward 5');
  });

  it('defaults confidence to 0 when not a number', () => {
    const result = parseInstructionResponse('{"action":"list_areas","confidence":"high"}');
    expect(result.action).toBe('list_areas');
    expect(result.confidence).toBe(0);
  });
});

// --- interpretInstruction ---

describe('interpretInstruction', () => {
  function mockQueryResult(responseText: string) {
    const messages = [
      {
        type: 'result' as const,
        subtype: 'success' as const,
        result: responseText,
        session_id: 'test-session',
      },
    ];
    mockedQuery.mockReturnValue({
      [Symbol.asyncIterator]: () => {
        let index = 0;
        return {
          next: async () => {
            if (index < messages.length) {
              return { value: messages[index++], done: false };
            }
            return { value: undefined, done: true };
          },
        };
      },
    } as any);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('interprets add_area instruction', async () => {
    mockQueryResult('{"action":"add_area","areaName":"Shivaji Nagar","confidence":0.95}');

    const result = await interpretInstruction('add Shivaji Nagar area');

    expect(result.action).toBe('add_area');
    expect(result.areaName).toBe('Shivaji Nagar');
    expect(mockedQuery).toHaveBeenCalledOnce();
  });

  it('interprets add_karyakarta instruction', async () => {
    mockQueryResult('{"action":"add_karyakarta","phone":"9876543210","areaName":"Shivaji Nagar","confidence":0.95}');

    const result = await interpretInstruction('make 9876543210 karyakarta for Shivaji Nagar');

    expect(result.action).toBe('add_karyakarta');
    expect(result.phone).toBe('9876543210');
    expect(result.areaName).toBe('Shivaji Nagar');
  });

  it('interprets list_karyakartas instruction', async () => {
    mockQueryResult('{"action":"list_karyakartas","confidence":0.95}');

    const result = await interpretInstruction('show all karyakartas');

    expect(result.action).toBe('list_karyakartas');
  });

  it('returns unrecognized for unrelated text', async () => {
    mockQueryResult('{"action":"unrecognized","confidence":0.95}');

    const result = await interpretInstruction('good morning');

    expect(result.action).toBe('unrecognized');
  });

  it('returns unrecognized on query error', async () => {
    mockedQuery.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: async () => { throw new Error('API error'); },
      }),
    } as any);

    const result = await interpretInstruction('add area test');

    expect(result.action).toBe('unrecognized');
    expect(result.confidence).toBe(0);
  });

  it('uses maxTurns: 1 and disallows tools', async () => {
    mockQueryResult('{"action":"list_areas","confidence":0.9}');

    await interpretInstruction('show areas');

    const callArgs = mockedQuery.mock.calls[0][0];
    expect(callArgs.options!.maxTurns).toBe(1);
    expect(callArgs.options!.disallowedTools).toContain('Bash');
  });
});

// --- executeInstruction ---

describe('executeInstruction', () => {
  let db: Database.Database;
  const SENDER = '918600822444';

  beforeEach(() => {
    db = createTestDb();
    clearAreaCache();
  });

  // --- add_area ---

  describe('add_area', () => {
    it('creates a new area', () => {
      const result = executeInstruction(db, {
        action: 'add_area',
        areaName: 'Shivaji Nagar',
        confidence: 0.95,
      }, SENDER);

      expect(result).toContain("Area 'Shivaji Nagar' created");
      expect(result).toContain('shivaji-nagar');

      const area = db.prepare('SELECT * FROM areas WHERE id = ?').get('shivaji-nagar');
      expect(area).toBeDefined();
    });

    it('rejects duplicate area', () => {
      seedArea(db, { name: 'Shivaji Nagar' });

      const result = executeInstruction(db, {
        action: 'add_area',
        areaName: 'Shivaji Nagar',
        confidence: 0.95,
      }, SENDER);

      expect(result).toContain('already exists');
    });

    it('returns error when area name missing', () => {
      const result = executeInstruction(db, {
        action: 'add_area',
        confidence: 0.95,
      }, SENDER);

      expect(result).toContain('specify an area name');
    });
  });

  // --- add_karyakarta ---

  describe('add_karyakarta', () => {
    it('adds karyakarta with existing area', () => {
      seedArea(db, { name: 'Shivaji Nagar' });

      const result = executeInstruction(db, {
        action: 'add_karyakarta',
        phone: '+919876543210',
        areaName: 'Shivaji Nagar',
        confidence: 0.95,
      }, SENDER);

      expect(result).toContain('919876543210');
      expect(result).toContain('Shivaji Nagar');

      // Verify karyakarta exists
      const k = db.prepare('SELECT * FROM karyakartas WHERE phone = ?').get('919876543210');
      expect(k).toBeDefined();
    });

    it('auto-creates area when not found', () => {
      const result = executeInstruction(db, {
        action: 'add_karyakarta',
        phone: '+919876543210',
        areaName: 'New Colony',
        confidence: 0.95,
      }, SENDER);

      expect(result).toContain('auto-created');
      expect(result).toContain('919876543210');

      // Verify area was created
      const area = db.prepare('SELECT * FROM areas WHERE id = ?').get('new-colony');
      expect(area).toBeDefined();
    });

    it('fuzzy matches existing area', () => {
      seedArea(db, { name: 'Shivaji Nagar' });

      // Slightly different spelling (lowercase exact match via slug)
      const result = executeInstruction(db, {
        action: 'add_karyakarta',
        phone: '+919876543210',
        areaName: 'shivaji nagar',
        confidence: 0.95,
      }, SENDER);

      expect(result).not.toContain('auto-created');
      expect(result).toContain('919876543210');
    });

    it('adds karyakarta without area when area not specified', () => {
      const result = executeInstruction(db, {
        action: 'add_karyakarta',
        phone: '+919876543210',
        confidence: 0.9,
      }, SENDER);

      expect(result).toContain('919876543210');
      expect(result).toContain('no area assigned');

      // Verify karyakarta exists
      const k = db.prepare('SELECT * FROM karyakartas WHERE phone = ?').get('919876543210');
      expect(k).toBeDefined();
    });

    it('returns error for invalid phone', () => {
      const result = executeInstruction(db, {
        action: 'add_karyakarta',
        phone: 'abc',
        areaName: 'Test',
        confidence: 0.95,
      }, SENDER);

      expect(result).toContain('Invalid phone number');
    });

    it('returns error when phone missing', () => {
      const result = executeInstruction(db, {
        action: 'add_karyakarta',
        areaName: 'Shivaji Nagar',
        confidence: 0.95,
      }, SENDER);

      expect(result).toContain('specify a phone number');
    });
  });

  // --- assign_area ---

  describe('assign_area', () => {
    it('assigns karyakarta to existing area', () => {
      const areaId = seedArea(db, { name: 'Gandhi Nagar' });
      seedKaryakarta(db, '919876543210');

      const result = executeInstruction(db, {
        action: 'assign_area',
        phone: '+919876543210',
        areaName: 'Gandhi Nagar',
        confidence: 0.95,
      }, SENDER);

      expect(result).toContain('919876543210');
      expect(result).toContain('Gandhi Nagar');
    });

    it('auto-creates area and assigns', () => {
      seedKaryakarta(db, '919876543210');

      const result = executeInstruction(db, {
        action: 'assign_area',
        phone: '+919876543210',
        areaName: 'Brand New Area',
        confidence: 0.95,
      }, SENDER);

      expect(result).toContain('auto-created');

      const area = db.prepare('SELECT * FROM areas WHERE id = ?').get('brand-new-area');
      expect(area).toBeDefined();
    });

    it('returns error when phone missing', () => {
      const result = executeInstruction(db, {
        action: 'assign_area',
        areaName: 'Test',
        confidence: 0.95,
      }, SENDER);

      expect(result).toContain('specify a phone number');
    });

    it('returns error when area name missing', () => {
      const result = executeInstruction(db, {
        action: 'assign_area',
        phone: '9876543210',
        confidence: 0.95,
      }, SENDER);

      expect(result).toContain('specify an area name');
    });
  });

  // --- unassign_area ---

  describe('unassign_area', () => {
    it('unassigns karyakarta from area', () => {
      const areaId = seedArea(db, { name: 'Test Area' });
      seedKaryakarta(db, '919876543210', [areaId]);

      const result = executeInstruction(db, {
        action: 'unassign_area',
        phone: '+919876543210',
        areaName: 'Test Area',
        confidence: 0.9,
      }, SENDER);

      expect(result).toContain('unassigned');
    });

    it('returns error when area not found', () => {
      const result = executeInstruction(db, {
        action: 'unassign_area',
        phone: '+919876543210',
        areaName: 'Nonexistent',
        confidence: 0.9,
      }, SENDER);

      expect(result).toContain('not found');
    });
  });

  // --- remove_karyakarta ---

  describe('remove_karyakarta', () => {
    it('removes an existing karyakarta', () => {
      seedKaryakarta(db, '919876543210');

      const result = executeInstruction(db, {
        action: 'remove_karyakarta',
        phone: '+919876543210',
        confidence: 0.9,
      }, SENDER);

      expect(result).toContain('removed');
    });

    it('returns error for non-existent karyakarta', () => {
      const result = executeInstruction(db, {
        action: 'remove_karyakarta',
        phone: '+919876543210',
        confidence: 0.9,
      }, SENDER);

      expect(result).toContain('not found');
    });

    it('returns error for invalid phone', () => {
      const result = executeInstruction(db, {
        action: 'remove_karyakarta',
        phone: 'invalid',
        confidence: 0.9,
      }, SENDER);

      expect(result).toContain('Invalid phone number');
    });
  });

  // --- remove_area ---

  describe('remove_area', () => {
    it('deactivates an existing area', () => {
      seedArea(db, { name: 'Old Area' });

      const result = executeInstruction(db, {
        action: 'remove_area',
        areaName: 'Old Area',
        confidence: 0.9,
      }, SENDER);

      expect(result).toContain('deactivated');
    });

    it('returns error when area not found', () => {
      const result = executeInstruction(db, {
        action: 'remove_area',
        areaName: 'Ghost Area',
        confidence: 0.9,
      }, SENDER);

      expect(result).toContain('not found');
    });
  });

  // --- rename_area ---

  describe('rename_area', () => {
    it('renames an existing area', () => {
      seedArea(db, { name: 'Old Name' });

      const result = executeInstruction(db, {
        action: 'rename_area',
        areaName: 'Old Name',
        newAreaName: 'New Name',
        confidence: 0.9,
      }, SENDER);

      expect(result).toContain('renamed');
    });

    it('returns error when area not found', () => {
      const result = executeInstruction(db, {
        action: 'rename_area',
        areaName: 'Ghost',
        newAreaName: 'New',
        confidence: 0.9,
      }, SENDER);

      expect(result).toContain('not found');
    });

    it('returns error when new name missing', () => {
      seedArea(db, { name: 'Test' });

      const result = executeInstruction(db, {
        action: 'rename_area',
        areaName: 'Test',
        confidence: 0.9,
      }, SENDER);

      expect(result).toContain('specify the new area name');
    });
  });

  // --- list_karyakartas ---

  describe('list_karyakartas', () => {
    it('returns list of active karyakartas', () => {
      seedKaryakarta(db, '919876543210');

      const result = executeInstruction(db, {
        action: 'list_karyakartas',
        confidence: 0.95,
      }, SENDER);

      expect(result).toContain('919876543210');
    });

    it('returns empty message when no karyakartas', () => {
      const result = executeInstruction(db, {
        action: 'list_karyakartas',
        confidence: 0.95,
      }, SENDER);

      expect(result).toContain('No active karyakartas');
    });
  });

  // --- list_areas ---

  describe('list_areas', () => {
    it('returns list of active areas', () => {
      seedArea(db, { name: 'Ward 1' });
      seedArea(db, { name: 'Ward 2' });

      const result = executeInstruction(db, {
        action: 'list_areas',
        confidence: 0.95,
      }, SENDER);

      expect(result).toContain('Ward 1');
      expect(result).toContain('Ward 2');
    });

    it('returns empty message when no areas', () => {
      const result = executeInstruction(db, {
        action: 'list_areas',
        confidence: 0.95,
      }, SENDER);

      expect(result).toContain('No active areas');
    });
  });

  // --- unrecognized ---

  describe('unrecognized', () => {
    it('returns help message', () => {
      const result = executeInstruction(db, {
        action: 'unrecognized',
        confidence: 0.95,
      }, SENDER);

      expect(result).toBe(HELP_MESSAGE);
    });
  });
});
