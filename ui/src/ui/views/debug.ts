import { html, nothing } from 'lit';
import type { NanoClawApp } from '../app.ts';
import { formatBytes, formatUptime } from '../format.ts';

export function renderDebug(state: NanoClawApp) {
  const d = state.debug;
  if (!d) return html`<div class="muted">Loading...</div>`;

  return html`
    <section class="grid grid-cols-2">
      <div class="card">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">Queue State</div>
            <div class="card-sub">Current group queue status.</div>
          </div>
          <button class="btn" ?disabled=${state.loading} @click=${() => state.loadDebug()}>
            ${state.loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        <div class="status-list" style="margin-top: 16px;">
          <div><span class="label">Active</span><span>${d.queue.activeCount}</span></div>
          <div><span class="label">Max Concurrent</span><span>${d.queue.maxConcurrent}</span></div>
          <div><span class="label">Waiting</span><span>${d.queue.waitingCount}</span></div>
        </div>
        ${d.queue.groups.length > 0 ? html`
          <div style="margin-top: 12px;">
            <div class="muted" style="margin-bottom: 6px;">Active Groups</div>
            <pre class="code-block">${JSON.stringify(d.queue.groups, null, 2)}</pre>
          </div>
        ` : nothing}
      </div>

      <div class="card">
        <div class="card-title">Process Info</div>
        <div class="card-sub">Node.js process details.</div>
        <div class="status-list" style="margin-top: 16px;">
          <div><span class="label">PID</span><span>${d.process.pid}</span></div>
          <div><span class="label">Uptime</span><span>${formatUptime(d.process.uptime)}</span></div>
          <div><span class="label">Node</span><span>${d.process.nodeVersion}</span></div>
          <div><span class="label">RSS</span><span>${formatBytes(d.process.memoryUsage.rss)}</span></div>
          <div><span class="label">Heap Used</span><span>${formatBytes(d.process.memoryUsage.heapUsed)}</span></div>
          <div><span class="label">Heap Total</span><span>${formatBytes(d.process.memoryUsage.heapTotal)}</span></div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-title">Database Stats</div>
      <div class="card-sub">Row counts per table.</div>
      <div class="stat-grid" style="margin-top: 16px;">
        ${Object.entries(d.db).map(([table, count]) => html`
          <div class="stat">
            <div class="stat-label">${table}</div>
            <div class="stat-value">${(count as number).toLocaleString()}</div>
          </div>
        `)}
      </div>
    </section>

    <section class="card">
      <div class="card-title">Environment</div>
      <div class="card-sub">Active environment variables.</div>
      <pre class="code-block" style="margin-top: 12px;">${JSON.stringify(d.env, null, 2)}</pre>
    </section>
  `;
}
