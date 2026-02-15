import { html, nothing } from 'lit';
import type { NanoClawApp } from '../app.ts';
import { formatUptime } from '../format.ts';

export function renderOverview(state: NanoClawApp) {
  const o = state.overview;
  if (!o) return html`<div class="muted">Loading...</div>`;

  return html`
    <section class="stat-grid">
      <div class="stat">
        <div class="stat-label">Uptime</div>
        <div class="stat-value">${formatUptime(o.uptime)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Channels</div>
        <div class="stat-value ${o.channels.some(c => c.connected) ? 'ok' : 'warn'}">
          ${o.channels.filter(c => c.connected).length}/${o.channels.length}
        </div>
      </div>
      <div class="stat">
        <div class="stat-label">Groups</div>
        <div class="stat-value">${o.groups.total}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Containers</div>
        <div class="stat-value">${o.containers.running}/${o.queue.maxConcurrent}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Queue Waiting</div>
        <div class="stat-value ${o.queue.waitingCount > 0 ? 'warn' : ''}">${o.queue.waitingCount}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Messages</div>
        <div class="stat-value">${o.messages.total.toLocaleString()}</div>
      </div>
    </section>

    <section class="grid grid-cols-2">
      <div class="card">
        <div class="card-title">Channels</div>
        <div class="card-sub">Connected messaging channels.</div>
        <div class="status-list" style="margin-top: 16px;">
          ${o.channels.length === 0
            ? html`<div class="muted">No channels configured.</div>`
            : o.channels.map(ch => html`
              <div>
                <span>${ch.name}</span>
                <span>
                  <span class="statusDot ${ch.connected ? 'ok' : ''}" style="display: inline-block; vertical-align: middle;"></span>
                  ${ch.connected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
            `)
          }
        </div>
      </div>

      <div class="card">
        <div class="card-title">Tasks</div>
        <div class="card-sub">Scheduled task summary.</div>
        <div class="status-list" style="margin-top: 16px;">
          <div>
            <span class="label">Active</span>
            <span>${o.tasks.active}</span>
          </div>
          <div>
            <span class="label">Paused</span>
            <span>${o.tasks.paused}</span>
          </div>
          <div>
            <span class="label">Completed</span>
            <span>${o.tasks.completed}</span>
          </div>
        </div>
      </div>
    </section>
  `;
}
