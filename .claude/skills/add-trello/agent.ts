/**
 * Container-side Trello tool registration
 *
 * Import this in container/agent-runner/src/ipc-mcp-stdio.ts and call registerTrelloTools(server)
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

const IPC_DIR = '/workspace/ipc';
const TASKS_DIR = path.join(IPC_DIR, 'tasks');
const RESPONSES_DIR = path.join(IPC_DIR, 'responses');

function writeIpcFile(dir: string, data: object): string {
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);

  // Atomic write: temp file then rename
  const tempPath = `${filepath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filepath);

  return filename;
}

/**
 * Wait for a response file and return its contents
 */
async function waitForResponse(responseFile: string, timeoutMs: number = 10000): Promise<any> {
  const responsePath = path.join(RESPONSES_DIR, responseFile);
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (fs.existsSync(responsePath)) {
      try {
        const content = fs.readFileSync(responsePath, 'utf-8');
        fs.unlinkSync(responsePath); // Clean up
        return JSON.parse(content);
      } catch (err) {
        // File might be mid-write, retry
      }
    }
    // Wait 100ms before checking again
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return {
    success: false,
    message: '⏱️ Timeout: Keine Antwort vom Host erhalten',
    error: 'Response timeout',
  };
}

/**
 * Register Trello tools with the MCP server
 */
export function registerTrelloTools(server: McpServer): void {
  server.tool(
    'trello_add_card',
    `Add a new card to a Trello list. Lists: heute (today, max 3-5 cards), woche (this week), bald (soon), warten (waiting for), erledigt (done).

ADHS Optimization: "heute" list has a limit to prevent overwhelm. If full, suggest "woche" instead.

Example: Add "Einkaufen gehen" to heute
Example: Add "Email an Chef" with description "Wegen Urlaub nachfragen" to heute`,
    {
      list: z.string().describe('List name or key: heute, woche, bald, warten, erledigt'),
      title: z.string().describe('Card title (short, clear task description)'),
      description: z.string().optional().describe('Optional card description (additional context)'),
    },
    async (args) => {
      const responseFile = `trello_${Date.now()}.json`;
      const data = {
        type: 'trello_add_card',
        list: args.list,
        title: args.title,
        description: args.description || '',
        responseFile,
        timestamp: new Date().toISOString(),
      };

      writeIpcFile(TASKS_DIR, data);

      // Wait for response from host
      const response = await waitForResponse(responseFile);

      return {
        content: [
          {
            type: 'text' as const,
            text: response.message || `✅ Karte "${args.title}" erstellt`,
          },
        ],
        isError: !response.success,
      };
    },
  );

  server.tool(
    'trello_list_cards',
    `List cards from a Trello list or all lists. Use this to show what needs to be done.

Example: Show all cards in "heute"
Example: Show all cards across all lists`,
    {
      list: z.string().optional().describe('Optional: list name (heute, woche, bald, warten, erledigt). Omit to show all.'),
    },
    async (args) => {
      const responseFile = `trello_${Date.now()}.json`;
      const data = {
        type: 'trello_list_cards',
        list: args.list || '',
        responseFile,
        timestamp: new Date().toISOString(),
      };

      writeIpcFile(TASKS_DIR, data);

      // Wait for response from host
      const response = await waitForResponse(responseFile);

      return {
        content: [
          {
            type: 'text' as const,
            text: response.message || '📋 Karten geladen',
          },
        ],
        isError: !response.success,
      };
    },
  );

  server.tool(
    'trello_move_card',
    `Move a card to a different list. Use when prioritizing or completing tasks.

Example: Move card to "heute" to work on it today
Example: Move card to "warten" if blocked`,
    {
      cardId: z.string().describe('Trello card ID (24-character hex string)'),
      targetList: z.string().describe('Target list name: heute, woche, bald, warten, erledigt'),
    },
    async (args) => {
      const responseFile = `trello_${Date.now()}.json`;
      const data = {
        type: 'trello_move_card',
        cardId: args.cardId,
        targetList: args.targetList,
        responseFile,
        timestamp: new Date().toISOString(),
      };

      writeIpcFile(TASKS_DIR, data);

      // Wait for response from host
      const response = await waitForResponse(responseFile);

      return {
        content: [
          {
            type: 'text' as const,
            text: response.message || '✅ Karte verschoben',
          },
        ],
        isError: !response.success,
      };
    },
  );

  server.tool(
    'trello_complete_card',
    `Mark a card as complete (moves to "erledigt" list). Use when a task is finished.

You can provide either the card ID or a partial name match.

Example: Complete card "Einkaufen gehen"
Example: Complete card with ID "abc123..."`,
    {
      cardIdOrName: z.string().describe('Card ID or name (partial match supported)'),
    },
    async (args) => {
      const responseFile = `trello_${Date.now()}.json`;
      const data = {
        type: 'trello_complete_card',
        cardIdOrName: args.cardIdOrName,
        responseFile,
        timestamp: new Date().toISOString(),
      };

      writeIpcFile(TASKS_DIR, data);

      // Wait for response from host
      const response = await waitForResponse(responseFile);

      return {
        content: [
          {
            type: 'text' as const,
            text: response.message || '✅ Karte erledigt',
          },
        ],
        isError: !response.success,
      };
    },
  );

  server.tool(
    'trello_find_card',
    `Find a card by name (partial match). Useful before moving or completing a card.

Example: Find card containing "Einkaufen"
Example: Find card in "heute" list containing "Email"`,
    {
      name: z.string().describe('Card name or partial name to search for'),
      list: z.string().optional().describe('Optional: limit search to specific list (heute, woche, etc.)'),
    },
    async (args) => {
      const responseFile = `trello_${Date.now()}.json`;
      const data = {
        type: 'trello_find_card',
        name: args.name,
        list: args.list || '',
        responseFile,
        timestamp: new Date().toISOString(),
      };

      writeIpcFile(TASKS_DIR, data);

      // Wait for response from host
      const response = await waitForResponse(responseFile);

      return {
        content: [
          {
            type: 'text' as const,
            text: response.message || '🔍 Karte gefunden',
          },
        ],
        isError: !response.success,
      };
    },
  );
}
