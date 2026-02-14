/**
 * Host-side IPC handler for Trello integration
 *
 * Processes IPC requests from the container agent and executes Trello API operations.
 */

import fs from 'fs';
import path from 'path';
import { trelloAPI } from './lib/trello-api.js';
import { getListKey, ListKey, LIST_NAMES } from './lib/config.js';
import { logger } from '../../logger.js';
import { DATA_DIR } from '../../config.js';

export interface TrelloIpcTask {
  type: string;
  responseFile?: string;
  [key: string]: any;
}

interface TrelloResponse {
  success: boolean;
  message: string;
  error?: string;
  data?: any;
}

/**
 * Write response back to the container
 */
function writeResponse(responseFile: string | undefined, response: TrelloResponse): void {
  if (!responseFile) return;

  try {
    const responseDir = path.join(DATA_DIR, 'ipc', 'responses');
    fs.mkdirSync(responseDir, { recursive: true });

    const responsePath = path.join(responseDir, responseFile);
    fs.writeFileSync(responsePath, JSON.stringify(response, null, 2), 'utf-8');

    logger.debug({ responseFile }, 'Trello response written');
  } catch (err) {
    logger.error({ err, responseFile }, 'Failed to write Trello response');
  }
}

/**
 * Handle Trello IPC requests from container
 *
 * @param data IPC task data
 * @param sourceGroup Group JID that triggered the task
 * @param isMain Whether this is from the main group
 * @param dataDir Data directory path
 * @returns true if handled, false if not a Trello task
 */
export async function handleTrelloIpc(
  data: TrelloIpcTask,
  sourceGroup: string,
  isMain: boolean,
  dataDir: string,
): Promise<boolean> {
  const { type, responseFile } = data;

  // Only handle Trello tasks
  if (!type.startsWith('trello_')) {
    return false;
  }

  logger.info({ type, sourceGroup }, 'Handling Trello IPC task');

  try {
    switch (type) {
      case 'trello_add_card': {
        const { list, title, description } = data;
        const listKey = getListKey(list);

        if (!listKey) {
          const errorMsg = `❌ Ungültige Liste "${list}". Nutze: heute, woche, bald, warten, erledigt`;
          logger.error({ list }, 'Invalid Trello list name');
          writeResponse(responseFile, {
            success: false,
            message: errorMsg,
            error: `Invalid list: ${list}`,
          });
          return true;
        }

        const result = await trelloAPI.addCard(listKey, title, description);

        if (result.success && result.data) {
          // Get current count in list
          const cardsResult = await trelloAPI.listCards(listKey);
          const count = cardsResult.success && cardsResult.data ? cardsResult.data.length : 0;

          const listName = LIST_NAMES[listKey];
          const countInfo = listKey === 'heute' && count > 0
            ? ` (${count} von max 5 Karten)`
            : ` (${count} Karten)`;

          const successMsg = `✅ Karte "${title}" zu ${listName} hinzugefügt${countInfo}\n📋 ${result.data.url}`;

          logger.info(
            { cardId: result.data.id, list: listKey, title, count },
            'Trello card created',
          );

          writeResponse(responseFile, {
            success: true,
            message: successMsg,
            data: { cardId: result.data.id, url: result.data.url, count },
          });
        } else {
          const errorMsg = `❌ Fehler beim Erstellen der Karte: ${result.error}`;
          logger.error({ error: result.error, list, title }, 'Failed to create Trello card');
          writeResponse(responseFile, {
            success: false,
            message: errorMsg,
            error: result.error,
          });
        }

        return true;
      }

      case 'trello_list_cards': {
        const { list } = data;
        let listKey: ListKey | undefined;

        if (list) {
          const key = getListKey(list);
          if (!key) {
            const errorMsg = `❌ Ungültige Liste "${list}". Nutze: heute, woche, bald, warten, erledigt`;
            logger.error({ list }, 'Invalid Trello list name');
            writeResponse(responseFile, {
              success: false,
              message: errorMsg,
              error: `Invalid list: ${list}`,
            });
            return true;
          }
          listKey = key;
        }

        const result = await trelloAPI.listCards(listKey);

        if (result.success && result.data) {
          let formatted: string;

          if (listKey) {
            // Single list
            formatted = trelloAPI.formatCardList(result.data, listKey);
          } else {
            // All lists - need to fetch each list separately to group cards
            const allLists = {
              heute: (await trelloAPI.listCards('heute')).data || [],
              woche: (await trelloAPI.listCards('woche')).data || [],
              bald: (await trelloAPI.listCards('bald')).data || [],
              warten: (await trelloAPI.listCards('warten')).data || [],
              erledigt: (await trelloAPI.listCards('erledigt')).data || [],
            };
            formatted = trelloAPI.formatAllLists(allLists);
          }

          logger.info({ count: result.data.length, list: listKey }, 'Trello cards listed');
          writeResponse(responseFile, {
            success: true,
            message: formatted || '📋 Keine Karten gefunden',
            data: { count: result.data.length, cards: result.data },
          });
        } else {
          const errorMsg = `❌ Fehler beim Laden der Karten: ${result.error}`;
          logger.error({ error: result.error, list: listKey }, 'Failed to list Trello cards');
          writeResponse(responseFile, {
            success: false,
            message: errorMsg,
            error: result.error,
          });
        }

        return true;
      }

      case 'trello_move_card': {
        const { cardId, targetList } = data;
        const listKey = getListKey(targetList);

        if (!listKey) {
          const errorMsg = `❌ Ungültige Liste "${targetList}". Nutze: heute, woche, bald, warten, erledigt`;
          logger.error({ targetList }, 'Invalid Trello list name');
          writeResponse(responseFile, {
            success: false,
            message: errorMsg,
            error: `Invalid list: ${targetList}`,
          });
          return true;
        }

        const result = await trelloAPI.moveCard(cardId, listKey);

        if (result.success && result.data) {
          const listName = LIST_NAMES[listKey];
          const successMsg = `✅ Karte nach ${listName} verschoben\n📋 ${result.data.url}`;

          logger.info({ cardId, targetList: listKey }, 'Trello card moved');
          writeResponse(responseFile, {
            success: true,
            message: successMsg,
            data: { cardId: result.data.id, url: result.data.url },
          });
        } else {
          const errorMsg = `❌ Fehler beim Verschieben der Karte: ${result.error}`;
          logger.error({ error: result.error, cardId, targetList }, 'Failed to move Trello card');
          writeResponse(responseFile, {
            success: false,
            message: errorMsg,
            error: result.error,
          });
        }

        return true;
      }

      case 'trello_complete_card': {
        const { cardIdOrName } = data;

        const result = await trelloAPI.completeCard(cardIdOrName);

        if (result.success && result.data) {
          const successMsg = `✅ Karte "${result.data.name}" erledigt!\n📋 ${result.data.url}`;

          logger.info({ card: cardIdOrName }, 'Trello card completed');
          writeResponse(responseFile, {
            success: true,
            message: successMsg,
            data: { cardId: result.data.id, name: result.data.name, url: result.data.url },
          });
        } else {
          const errorMsg = `❌ Fehler: ${result.error}`;
          logger.error({ error: result.error, card: cardIdOrName }, 'Failed to complete Trello card');
          writeResponse(responseFile, {
            success: false,
            message: errorMsg,
            error: result.error,
          });
        }

        return true;
      }

      case 'trello_find_card': {
        const { name, list } = data;
        let listKey: ListKey | undefined;

        if (list) {
          const key = getListKey(list);
          if (key) {
            listKey = key;
          }
        }

        const result = await trelloAPI.findCardByName(name, listKey);

        if (result.success && result.data) {
          const listName = listKey ? LIST_NAMES[listKey] : 'allen Listen';
          const successMsg = `🔍 Karte gefunden in ${listName}:\n• ${result.data.name}\n📋 ${result.data.url}`;

          logger.info({ cardId: result.data.id, name }, 'Trello card found');
          writeResponse(responseFile, {
            success: true,
            message: successMsg,
            data: { cardId: result.data.id, name: result.data.name, url: result.data.url },
          });
        } else {
          const errorMsg = `❌ ${result.error}`;
          logger.error({ error: result.error, name, list }, 'Failed to find Trello card');
          writeResponse(responseFile, {
            success: false,
            message: errorMsg,
            error: result.error,
          });
        }

        return true;
      }

      default:
        logger.warn({ type }, 'Unknown Trello IPC task type');
        writeResponse(responseFile, {
          success: false,
          message: `❌ Unbekannter Trello Befehl: ${type}`,
          error: `Unknown task type: ${type}`,
        });
        return false;
    }
  } catch (err: any) {
    const errorMsg = `❌ Interner Fehler: ${err.message}`;
    logger.error({ err: err.message, type, sourceGroup }, 'Trello IPC handler error');
    writeResponse(responseFile, {
      success: false,
      message: errorMsg,
      error: err.message,
    });
    return true;
  }
}
