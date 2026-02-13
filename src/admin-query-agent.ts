/**
 * admin-query-agent.ts — Read-only SQL query agent for admin data questions.
 *
 * When an admin asks a data question via @ComplaintBot (e.g. "how many complaints
 * today?"), the instruction classifier marks it `unrecognized`. This module handles
 * those queries using a read-only SQL MCP tool + Agent SDK query().
 */
import type Database from 'better-sqlite3';
import {
  query,
  tool,
  createSdkMcpServer,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import {
  ADMIN_QUERY_MAX_TURNS,
  ADMIN_QUERY_ROW_LIMIT,
  REPLY_INTERPRETER_MODEL,
} from './config.js';
import { logger } from './logger.js';

/** Tables exposed to the query agent (complaint-domain only). */
const QUERYABLE_TABLES = [
  'users',
  'complaints',
  'complaint_updates',
  'conversations',
  'categories',
  'areas',
  'karyakartas',
  'karyakarta_areas',
  'complaint_validations',
  'rate_limits',
  'usage_log',
  'tenant_config',
];

/** Forbidden SQL keywords (case-insensitive). */
const FORBIDDEN_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REPLACE|GRANT|REVOKE|TRUNCATE)\b/i;

// Module-level schema cache
let cachedSchema: string | null = null;

/**
 * Validate that a SQL string is read-only.
 * Must start with SELECT or WITH (CTEs). Rejects write/DDL keywords
 * and multi-statement injection (semicolons).
 */
export function validateReadOnlyQuery(sql: string): {
  valid: boolean;
  error?: string;
} {
  const trimmed = sql.trim();

  // Must start with SELECT or WITH
  if (!/^(SELECT|WITH)\b/i.test(trimmed)) {
    return { valid: false, error: 'Query must start with SELECT or WITH.' };
  }

  // Reject forbidden keywords
  if (FORBIDDEN_KEYWORDS.test(trimmed)) {
    return {
      valid: false,
      error: 'Query contains forbidden keyword (write/DDL operations not allowed).',
    };
  }

  // Reject multi-statement: semicolons anywhere except inside string literals
  // Simple heuristic: reject if semicolon appears before the end of the trimmed string
  const withoutEnd = trimmed.replace(/;\s*$/, ''); // allow trailing semicolon
  if (withoutEnd.includes(';')) {
    return {
      valid: false,
      error: 'Multi-statement queries are not allowed.',
    };
  }

  return { valid: true };
}

/**
 * Generate schema description from sqlite_master for queryable tables.
 * Cached at module level; call _resetSchemaCache() in tests.
 */
export function generateSchemaDescription(db: Database.Database): string {
  if (cachedSchema) return cachedSchema;

  const placeholders = QUERYABLE_TABLES.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT name, sql FROM sqlite_master
       WHERE type IN ('table', 'index') AND name IN (${placeholders})
       ORDER BY type DESC, name`,
    )
    .all(...QUERYABLE_TABLES) as { name: string; sql: string }[];

  cachedSchema = rows
    .filter((r) => r.sql) // indexes may have null sql
    .map((r) => r.sql)
    .join(';\n\n');

  return cachedSchema;
}

/** Clear schema cache (for tests). */
export function _resetSchemaCache(): void {
  cachedSchema = null;
}

/** Columns that contain phone numbers — values will be masked. */
const PHONE_COLUMNS = new Set([
  'phone',
  'karyakarta_phone',
  'updated_by',
  'assigned_by',
  'created_by',
]);

/**
 * Mask sensitive phone fields in a result row.
 * "919876543210" → "919***210"
 */
export function maskSensitiveFields(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (PHONE_COLUMNS.has(key) && typeof value === 'string' && value.length >= 6) {
      // Keep first 3 and last 3 chars, mask the middle
      masked[key] = value.slice(0, 3) + '×××' + value.slice(-3);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

/** MCP tool content result type. */
type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

/**
 * Build the in-process MCP server with a single read-only SQL tool.
 */
function buildMcpServer(db: Database.Database) {
  return createSdkMcpServer({
    name: 'admin-query',
    version: '1.0.0',
    tools: [
      tool(
        'run_readonly_query',
        'Execute a read-only SQL SELECT query against the complaint database. Returns JSON rows.',
        {
          sql: z.string().describe('SQL SELECT query to execute'),
        },
        async (params): Promise<ToolResult> => {
          try {
            const validation = validateReadOnlyQuery(params.sql);
            if (!validation.valid) {
              return {
                content: [
                  { type: 'text' as const, text: `Error: ${validation.error}` },
                ],
                isError: true,
              };
            }

            // Auto-inject LIMIT if not present
            let sql = params.sql.trim().replace(/;\s*$/, '');
            if (!/\bLIMIT\b/i.test(sql)) {
              sql = `${sql} LIMIT ${ADMIN_QUERY_ROW_LIMIT + 1}`;
            }

            const rows = db.prepare(sql).all() as Record<string, unknown>[];
            const truncated = rows.length > ADMIN_QUERY_ROW_LIMIT;
            const limited = truncated
              ? rows.slice(0, ADMIN_QUERY_ROW_LIMIT)
              : rows;

            const maskedRows = limited.map(maskSensitiveFields);

            const result = {
              rows: maskedRows,
              row_count: maskedRows.length,
              truncated,
            };

            return {
              content: [
                { type: 'text' as const, text: JSON.stringify(result, null, 2) },
              ],
            };
          } catch (err) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `SQL Error: ${(err as Error).message}`,
                },
              ],
              isError: true,
            };
          }
        },
      ),
    ],
  });
}

/**
 * Build the system prompt for the query agent.
 */
function buildQueryAgentPrompt(schema: string): string {
  return `You are a read-only database assistant for a constituency complaint management system. You answer admin questions by querying an SQLite database.

## Rules
- Only use SELECT queries (no writes, no DDL).
- Return concise, WhatsApp-friendly responses (under 1500 characters).
- Do NOT include raw SQL in your answer — summarize results in plain language.
- Use Marathi/Hindi where appropriate if the question is in those languages.
- For counts, use COUNT(*). For lists, format as numbered or bulleted text.
- When grouping by date, use date() for day-level and strftime for finer granularity.

## Database Schema
${schema}

## Key Relationships
- complaints.phone → users.phone
- complaints.area_id → areas.id
- complaints.category → categories.name
- complaint_updates.complaint_id → complaints.id
- karyakarta_areas.karyakarta_phone → karyakartas.phone
- karyakarta_areas.area_id → areas.id
- complaint_validations.complaint_id → complaints.id
- complaint_validations.karyakarta_phone → karyakartas.phone

## Status Values
registered, acknowledged, in_progress, action_taken, resolved, on_hold, escalated

## Date Patterns
- Today: date('now')
- This week: date('now', '-7 days')
- Specific date column: created_at, updated_at (ISO 8601 format)

## Tips
- Phone numbers in results are masked for privacy — do not try to work around this.
- If a table referenced in the schema doesn't exist yet, the query will fail — handle gracefully.
- Prefer aggregate summaries over dumping raw rows.`;
}

/**
 * Handle an admin data query using a read-only SQL agent.
 * Returns a human-readable response for WhatsApp.
 */
export async function handleAdminQuery(
  db: Database.Database,
  question: string,
): Promise<string> {
  const schema = generateSchemaDescription(db);
  const systemPrompt = buildQueryAgentPrompt(schema);
  const mcpServer = buildMcpServer(db);

  logger.info({ questionLength: question.length }, 'Starting admin query agent');

  try {
    let resultText = '';

    const q = query({
      prompt: question,
      options: {
        systemPrompt,
        model: REPLY_INTERPRETER_MODEL,
        mcpServers: { 'admin-query': mcpServer },
        allowedTools: ['mcp__admin-query__*'],
        disallowedTools: [
          'Bash',
          'Read',
          'Write',
          'Edit',
          'Glob',
          'Grep',
          'NotebookEdit',
          'Task',
        ],
        maxTurns: ADMIN_QUERY_MAX_TURNS,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      },
    });

    for await (const message of q) {
      if (
        message.type === 'result' &&
        message.subtype === 'success' &&
        'result' in message
      ) {
        resultText = (message as { result: string }).result;
      }
    }

    if (!resultText) {
      logger.warn('Admin query agent returned empty result');
      return 'Sorry, I could not find an answer to your question. Try rephrasing or use #commands for specific actions.';
    }

    logger.info(
      { resultLength: resultText.length },
      'Admin query agent complete',
    );

    return resultText;
  } catch (err) {
    logger.error({ err }, 'Admin query agent failed');
    return 'Sorry, I could not process your question right now. Please try again or use #commands.';
  }
}
