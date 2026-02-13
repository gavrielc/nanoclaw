import { html } from 'lit';
import type { NanoClawApp } from '../app.ts';

export function renderChannels(state: NanoClawApp) {
  if (state.channels.length === 0) {
    return html`<div class="card"><div class="muted">No channels configured.</div></div>`;
  }

  return html`
    <section class="grid grid-cols-2">
      ${state.channels.map(ch => html`
        <div class="card">
          <div class="card-title">${ch.name}</div>
          <div class="card-sub">${ch.type === 'telegram' ? 'Telegram Bot' : 'WhatsApp via Baileys'}</div>
          <div class="status-list" style="margin-top: 16px;">
            <div>
              <span class="label">Status</span>
              <span>
                <span class="statusDot ${ch.connected ? 'ok' : ''}" style="display: inline-block; vertical-align: middle;"></span>
                ${ch.connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div>
              <span class="label">Type</span>
              <span>${ch.type}</span>
            </div>
          </div>
        </div>
      `)}
    </section>
  `;
}
