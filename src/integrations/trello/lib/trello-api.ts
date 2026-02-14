import fetch from 'node-fetch';
import { loadConfig, loadCredentials, TrelloConfig, ListKey, LIST_NAMES } from './config.js';

export interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  idList: string;
  url: string;
  dateLastActivity: string;
}

export interface TrelloList {
  id: string;
  name: string;
  cards?: TrelloCard[];
}

export interface TrelloBoard {
  id: string;
  name: string;
  url: string;
}

export interface ApiResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

const API_BASE = 'https://api.trello.com/1';

class TrelloAPI {
  private config: TrelloConfig | null = null;
  private credentials: { apiKey: string; token: string } | null = null;

  constructor() {
    this.config = loadConfig();
    this.credentials = loadCredentials();
  }

  private getAuthParams(): string {
    if (!this.credentials) {
      throw new Error('Trello credentials not found. Set TRELLO_API_KEY and TRELLO_TOKEN in .env');
    }
    return `key=${this.credentials.apiKey}&token=${this.credentials.token}`;
  }

  private async request<T>(endpoint: string, method: string = 'GET', body?: any): Promise<T> {
    const auth = this.getAuthParams();
    const url = `${API_BASE}${endpoint}${endpoint.includes('?') ? '&' : '?'}${auth}`;

    const options: any = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Trello API error: ${response.status} ${error}`);
    }

    return await response.json() as T;
  }

  // ============================================================================
  // Board operations
  // ============================================================================

  async getBoard(): Promise<ApiResult<TrelloBoard>> {
    try {
      if (!this.config) {
        return { success: false, error: 'Trello not configured. Run setup script first.' };
      }

      const board = await this.request<TrelloBoard>(`/boards/${this.config.boardId}`);
      return { success: true, data: board };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async createBoard(name: string): Promise<ApiResult<TrelloBoard>> {
    try {
      const board = await this.request<TrelloBoard>('/boards', 'POST', { name });
      return { success: true, data: board };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async getLists(): Promise<ApiResult<TrelloList[]>> {
    try {
      if (!this.config) {
        return { success: false, error: 'Trello not configured. Run setup script first.' };
      }

      const lists = await this.request<TrelloList[]>(`/boards/${this.config.boardId}/lists`);
      return { success: true, data: lists };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async createList(name: string): Promise<ApiResult<TrelloList>> {
    try {
      if (!this.config) {
        return { success: false, error: 'Trello not configured. Run setup script first.' };
      }

      const list = await this.request<TrelloList>('/lists', 'POST', {
        name,
        idBoard: this.config.boardId,
      });
      return { success: true, data: list };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // ============================================================================
  // Card operations
  // ============================================================================

  async addCard(listKey: ListKey, name: string, description?: string): Promise<ApiResult<TrelloCard>> {
    try {
      if (!this.config) {
        return { success: false, error: 'Trello not configured. Run setup script first.' };
      }

      const listId = this.config.lists[listKey];
      if (!listId) {
        return { success: false, error: `List "${listKey}" not found in config` };
      }

      // ADHS optimization: Check "Heute" limit
      if (listKey === 'heute') {
        const cardsResult = await this.listCards('heute');
        if (cardsResult.success && cardsResult.data) {
          const currentCount = cardsResult.data.length;
          const maxCount = this.config.limits.heuteMax;

          if (currentCount >= maxCount) {
            return {
              success: false,
              error: `⚠️ "Heute" ist voll (${currentCount}/${maxCount} Karten). Verschiebe eine Karte nach "Diese Woche" oder wähle eine andere Liste.`,
            };
          }
        }
      }

      const card = await this.request<TrelloCard>('/cards', 'POST', {
        name,
        desc: description || '',
        idList: listId,
      });

      return { success: true, data: card };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async listCards(listKey?: ListKey): Promise<ApiResult<TrelloCard[]>> {
    try {
      if (!this.config) {
        return { success: false, error: 'Trello not configured. Run setup script first.' };
      }

      if (listKey) {
        const listId = this.config.lists[listKey];
        if (!listId) {
          return { success: false, error: `List "${listKey}" not found in config` };
        }

        const cards = await this.request<TrelloCard[]>(`/lists/${listId}/cards`);
        return { success: true, data: cards };
      } else {
        // Get all cards from all lists
        const allCards: TrelloCard[] = [];
        for (const key of Object.keys(this.config.lists) as ListKey[]) {
          const listId = this.config.lists[key];
          const cards = await this.request<TrelloCard[]>(`/lists/${listId}/cards`);
          allCards.push(...cards);
        }
        return { success: true, data: allCards };
      }
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async moveCard(cardId: string, targetListKey: ListKey): Promise<ApiResult<TrelloCard>> {
    try {
      if (!this.config) {
        return { success: false, error: 'Trello not configured. Run setup script first.' };
      }

      const listId = this.config.lists[targetListKey];
      if (!listId) {
        return { success: false, error: `List "${targetListKey}" not found in config` };
      }

      // ADHS optimization: Check "Heute" limit if moving to "heute"
      if (targetListKey === 'heute') {
        const cardsResult = await this.listCards('heute');
        if (cardsResult.success && cardsResult.data) {
          const currentCount = cardsResult.data.length;
          const maxCount = this.config.limits.heuteMax;

          if (currentCount >= maxCount) {
            return {
              success: false,
              error: `⚠️ "Heute" ist voll (${currentCount}/${maxCount} Karten). Verschiebe erst eine andere Karte weg.`,
            };
          }
        }
      }

      const card = await this.request<TrelloCard>(`/cards/${cardId}`, 'PUT', {
        idList: listId,
      });

      return { success: true, data: card };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async completeCard(cardIdOrName: string): Promise<ApiResult<TrelloCard>> {
    try {
      // If it's not a card ID, find the card by name
      let cardId = cardIdOrName;
      if (!cardIdOrName.match(/^[a-f0-9]{24}$/)) {
        const allCardsResult = await this.listCards();
        if (!allCardsResult.success || !allCardsResult.data) {
          return { success: false, error: allCardsResult.error || 'Failed to fetch cards' };
        }

        const card = allCardsResult.data.find(c =>
          c.name.toLowerCase().includes(cardIdOrName.toLowerCase())
        );

        if (!card) {
          return { success: false, error: `Karte "${cardIdOrName}" nicht gefunden` };
        }

        cardId = card.id;
      }

      return await this.moveCard(cardId, 'erledigt');
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async archiveCard(cardId: string): Promise<ApiResult<TrelloCard>> {
    try {
      const card = await this.request<TrelloCard>(`/cards/${cardId}`, 'PUT', {
        closed: true,
      });
      return { success: true, data: card };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async findCardByName(name: string, listKey?: ListKey): Promise<ApiResult<TrelloCard>> {
    try {
      const cardsResult = await this.listCards(listKey);
      if (!cardsResult.success || !cardsResult.data) {
        return { success: false, error: cardsResult.error || 'Failed to fetch cards' };
      }

      const normalized = name.toLowerCase().trim();
      const card = cardsResult.data.find(c =>
        c.name.toLowerCase().includes(normalized) ||
        normalized.includes(c.name.toLowerCase())
      );

      if (!card) {
        return { success: false, error: `Karte "${name}" nicht gefunden` };
      }

      return { success: true, data: card };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // ============================================================================
  // Formatting helpers
  // ============================================================================

  formatCardList(cards: TrelloCard[], listKey?: ListKey): string {
    if (cards.length === 0) {
      return listKey
        ? `${LIST_NAMES[listKey]}: Keine Karten`
        : 'Keine Karten gefunden';
    }

    const lines: string[] = [];

    if (listKey) {
      const max = listKey === 'heute' && this.config ? this.config.limits.heuteMax : null;
      const header = max
        ? `${LIST_NAMES[listKey]} (${cards.length}/${max} Karten):`
        : `${LIST_NAMES[listKey]} (${cards.length} Karten):`;
      lines.push(header);
    }

    cards.forEach((card, i) => {
      lines.push(`${i + 1}. ${card.name}`);
      if (card.desc) {
        lines.push(`   ${card.desc}`);
      }
    });

    return lines.join('\n');
  }

  formatAllLists(listCards: Record<ListKey, TrelloCard[]>): string {
    const lines: string[] = [];
    const keys: ListKey[] = ['heute', 'woche', 'bald', 'warten', 'erledigt'];

    for (const key of keys) {
      const cards = listCards[key] || [];
      lines.push(this.formatCardList(cards, key));
      lines.push(''); // Empty line between lists
    }

    return lines.join('\n').trim();
  }
}

// Export singleton instance
export const trelloAPI = new TrelloAPI();
