import { html, nothing } from 'lit';
import type { NanoClawApp } from '../app.ts';

export function renderMessages(state: NanoClawApp) {
  const groups = state.groups;

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Message History</div>
          <div class="card-sub">Read-only message history per group.</div>
        </div>
      </div>

      <div class="filters" style="margin-top: 14px;">
        <label class="field" style="flex: 1; max-width: 400px;">
          <span>Group</span>
          <select
            .value=${state.messagesGroupJid}
            @change=${(e: Event) => {
              state.messagesGroupJid = (e.target as HTMLSelectElement).value;
              state.loadMessages();
            }}
          >
            <option value="">Select a group...</option>
            ${groups.map(g => html`<option value=${g.jid}>${g.name} (${g.folder})</option>`)}
          </select>
        </label>
      </div>

      ${!state.messagesGroupJid
        ? html`<div class="muted" style="margin-top: 16px;">Select a group to view messages.</div>`
        : state.messages.length === 0
          ? html`<div class="muted" style="margin-top: 16px;">No messages found for this group.</div>`
          : html`
            <div style="margin-top: 16px; border: 1px solid var(--border); border-radius: var(--radius-md); max-height: 500px; overflow: auto;">
              ${state.messages.map(msg => html`
                <div style="padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 13px;">
                  <div class="row" style="justify-content: space-between;">
                    <span style="font-weight: 500;">${msg.sender_name || msg.sender}</span>
                    <span class="muted" style="font-size: 11px;">${new Date(msg.timestamp).toLocaleString()}</span>
                  </div>
                  <div style="margin-top: 4px; white-space: pre-wrap; word-break: break-word; color: var(--chat-text);">${msg.content}</div>
                </div>
              `)}
            </div>
            ${state.messagesHasMore ? html`
              <div style="margin-top: 8px; text-align: center;">
                <button class="btn btn--sm" @click=${async () => {
                  const oldest = state.messages[0];
                  if (!oldest) return;
                  const res = await fetch(`/api/messages?group=${encodeURIComponent(state.messagesGroupJid)}&limit=50&before=${encodeURIComponent(oldest.timestamp)}`);
                  const data = await res.json();
                  state.messages = [...data.messages.reverse(), ...state.messages];
                  state.messagesHasMore = data.hasMore;
                }}>Load older</button>
              </div>
            ` : nothing}
          `
      }
    </section>
  `;
}
