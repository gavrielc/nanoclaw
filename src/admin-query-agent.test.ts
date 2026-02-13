/**
 * admin-query-agent.test.ts — Tests for read-only SQL query agent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  validateReadOnlyQuery,
  generateSchemaDescription,
  maskSensitiveFields,
  handleAdminQuery,
  _resetSchemaCache,
} from './admin-query-agent.js';
import { createTestDb, seedComplaint, seedUser, seedArea, seedKaryakarta } from './test-helpers.js';
import type Database from 'better-sqlite3';

// Mock the Agent SDK query function
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  tool: vi.fn((_name: string, _desc: string, _schema: unknown, handler: unknown) => ({
    name: _name,
    handler,
  })),
  createSdkMcpServer: vi.fn((_opts: unknown) => ({})),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
const mockedQuery = vi.mocked(query);

// ============================================================
// validateReadOnlyQuery
// ============================================================

describe('validateReadOnlyQuery', () => {
  it('accepts simple SELECT', () => {
    expect(validateReadOnlyQuery('SELECT * FROM complaints')).toEqual({
      valid: true,
    });
  });

  it('accepts SELECT with lowercase', () => {
    expect(validateReadOnlyQuery('select count(*) from complaints')).toEqual({
      valid: true,
    });
  });

  it('accepts WITH (CTE) queries', () => {
    expect(
      validateReadOnlyQuery(
        'WITH recent AS (SELECT * FROM complaints) SELECT * FROM recent',
      ),
    ).toEqual({ valid: true });
  });

  it('accepts WITH lowercase', () => {
    expect(
      validateReadOnlyQuery(
        'with cte as (select 1) select * from cte',
      ),
    ).toEqual({ valid: true });
  });

  it('accepts SELECT with leading whitespace', () => {
    expect(validateReadOnlyQuery('  SELECT 1')).toEqual({ valid: true });
  });

  it('accepts SELECT with trailing semicolon', () => {
    expect(validateReadOnlyQuery('SELECT 1;')).toEqual({ valid: true });
  });

  it('rejects INSERT', () => {
    const result = validateReadOnlyQuery(
      "INSERT INTO users VALUES ('test', 'test')",
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('must start with SELECT');
  });

  it('rejects UPDATE', () => {
    const result = validateReadOnlyQuery(
      "UPDATE complaints SET status = 'resolved'",
    );
    expect(result.valid).toBe(false);
  });

  it('rejects DELETE', () => {
    const result = validateReadOnlyQuery('DELETE FROM complaints');
    expect(result.valid).toBe(false);
  });

  it('rejects DROP keyword inside SELECT', () => {
    const result = validateReadOnlyQuery(
      'SELECT 1 FROM complaints WHERE DROP TABLE x',
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('forbidden keyword');
  });

  it('rejects ALTER hidden inside SELECT', () => {
    const result = validateReadOnlyQuery(
      'SELECT 1 FROM complaints WHERE ALTER TABLE x',
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('forbidden keyword');
  });

  it('rejects PRAGMA', () => {
    const result = validateReadOnlyQuery('PRAGMA table_info(complaints)');
    expect(result.valid).toBe(false);
  });

  it('rejects ATTACH', () => {
    const result = validateReadOnlyQuery("ATTACH DATABASE 'x' AS y");
    expect(result.valid).toBe(false);
  });

  it('rejects multi-statement (semicolons mid-query)', () => {
    const result = validateReadOnlyQuery(
      'SELECT 1; SELECT 2',
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Multi-statement');
  });

  it('rejects empty string', () => {
    const result = validateReadOnlyQuery('');
    expect(result.valid).toBe(false);
  });

  it('rejects VACUUM', () => {
    const result = validateReadOnlyQuery('VACUUM');
    expect(result.valid).toBe(false);
  });
});

// ============================================================
// generateSchemaDescription
// ============================================================

describe('generateSchemaDescription', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _resetSchemaCache();
  });

  it('returns DDL for queryable tables', () => {
    const schema = generateSchemaDescription(db);

    expect(schema).toContain('complaints');
    expect(schema).toContain('users');
    expect(schema).toContain('complaint_updates');
    expect(schema).toContain('categories');
    expect(schema).toContain('areas');
    expect(schema).toContain('karyakartas');
  });

  it('excludes internal tables not in the allowlist', () => {
    // Create a table not in the allowlist
    db.exec('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY)');

    const schema = generateSchemaDescription(db);

    expect(schema).not.toContain('CREATE TABLE sessions');
  });

  it('caches schema across calls', () => {
    const first = generateSchemaDescription(db);
    const second = generateSchemaDescription(db);

    expect(first).toBe(second);
  });
});

// ============================================================
// maskSensitiveFields
// ============================================================

describe('maskSensitiveFields', () => {
  it('masks phone column values', () => {
    const row = { phone: '919876543210', name: 'Riyaz', status: 'registered' };
    const masked = maskSensitiveFields(row);

    expect(masked.phone).toBe('919×××210');
    expect(masked.name).toBe('Riyaz');
    expect(masked.status).toBe('registered');
  });

  it('masks karyakarta_phone and updated_by columns', () => {
    const row = {
      karyakarta_phone: '918765432100',
      updated_by: '919999888777',
      note: 'test',
    };
    const masked = maskSensitiveFields(row);

    expect(masked.karyakarta_phone).toBe('918×××100');
    expect(masked.updated_by).toBe('919×××777');
    expect(masked.note).toBe('test');
  });

  it('handles short phone strings gracefully', () => {
    const row = { phone: '12345', name: 'Short' };
    const masked = maskSensitiveFields(row);

    // Under 6 chars → not masked
    expect(masked.phone).toBe('12345');
  });

  it('leaves non-phone columns intact', () => {
    const row = { id: 'RK-20260212-0001', description: 'Test', status: 'registered' };
    const masked = maskSensitiveFields(row);

    expect(masked).toEqual(row);
  });

  it('handles null/undefined values', () => {
    const row = { phone: null, name: undefined, status: 'open' };
    const masked = maskSensitiveFields(row as unknown as Record<string, unknown>);

    expect(masked.phone).toBeNull();
    expect(masked.name).toBeUndefined();
  });
});

// ============================================================
// handleAdminQuery
// ============================================================

describe('handleAdminQuery', () => {
  let db: Database.Database;

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
    db = createTestDb();
    _resetSchemaCache();
    vi.clearAllMocks();
  });

  it('returns formatted answer for valid question', async () => {
    mockQueryResult('There are 5 complaints registered today.');

    const result = await handleAdminQuery(db, 'how many complaints today?');

    expect(result).toBe('There are 5 complaints registered today.');
    expect(mockedQuery).toHaveBeenCalledOnce();
  });

  it('passes correct model and maxTurns', async () => {
    mockQueryResult('Answer here');

    await handleAdminQuery(db, 'test question');

    const callArgs = mockedQuery.mock.calls[0][0];
    expect(callArgs.options!.model).toBe('claude-sonnet-4-5-20250929');
    expect(callArgs.options!.maxTurns).toBe(4);
    expect(callArgs.options!.permissionMode).toBe('bypassPermissions');
  });

  it('returns fallback on error', async () => {
    mockedQuery.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          throw new Error('API error');
        },
      }),
    } as any);

    const result = await handleAdminQuery(db, 'broken question');

    expect(result).toContain('could not process');
  });

  it('returns fallback on empty result', async () => {
    mockQueryResult('');

    const result = await handleAdminQuery(db, 'obscure question');

    expect(result).toContain('could not find an answer');
  });

  it('disallows file/bash tools', async () => {
    mockQueryResult('answer');

    await handleAdminQuery(db, 'test');

    const callArgs = mockedQuery.mock.calls[0][0];
    expect(callArgs.options!.disallowedTools).toContain('Bash');
    expect(callArgs.options!.disallowedTools).toContain('Read');
    expect(callArgs.options!.disallowedTools).toContain('Write');
  });

  it('uses admin-query MCP server', async () => {
    mockQueryResult('answer');

    await handleAdminQuery(db, 'test');

    const callArgs = mockedQuery.mock.calls[0][0];
    expect(callArgs.options!.allowedTools).toEqual(['mcp__admin-query__*']);
    expect(callArgs.options!.mcpServers).toHaveProperty('admin-query');
  });
});
