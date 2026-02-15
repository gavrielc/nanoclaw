import { html, nothing } from 'lit';
import type { NanoClawApp } from '../app.ts';
import { formatAgo, formatDurationMs, clampText } from '../format.ts';

export function renderTasks(state: NanoClawApp) {
  const tasks = state.tasks;

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Scheduled Tasks</div>
          <div class="card-sub">${tasks.length} task${tasks.length !== 1 ? 's' : ''} total.</div>
        </div>
        <button class="btn" ?disabled=${state.loading} @click=${() => state.loadTasks()}>
          ${state.loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      ${tasks.length === 0
        ? html`<div class="muted" style="margin-top: 16px;">No scheduled tasks.</div>`
        : html`
          <div class="list" style="margin-top: 16px;">
            ${tasks.map(t => html`
              <div class="list-item">
                <div class="list-main">
                  <div class="list-title">${clampText(t.prompt, 80)}</div>
                  <div class="list-sub">
                    ${t.group_folder} &middot; ${t.schedule_type}: ${t.schedule_value}
                    ${t.context_mode !== 'isolated' ? ` &middot; context: ${t.context_mode}` : ''}
                  </div>
                  <div class="chip-row" style="margin-top: 6px;">
                    <span class="chip ${t.status === 'active' ? 'chip-ok' : t.status === 'paused' ? 'chip-warn' : ''}">${t.status}</span>
                    ${t.next_run ? html`<span class="chip">Next: ${formatAgo(new Date(t.next_run).getTime())}</span>` : nothing}
                    ${t.last_run ? html`<span class="chip">Last: ${formatAgo(new Date(t.last_run).getTime())}</span>` : nothing}
                  </div>
                  ${t.recentRuns.length > 0 ? html`
                    <details style="margin-top: 8px;">
                      <summary class="muted" style="cursor: pointer; font-size: 12px;">Recent runs (${t.recentRuns.length})</summary>
                      <div style="margin-top: 6px;">
                        ${t.recentRuns.map(r => html`
                          <div style="font-size: 12px; padding: 4px 0; border-bottom: 1px solid var(--border);">
                            <span class="chip ${r.status === 'success' ? 'chip-ok' : 'chip-warn'}" style="font-size: 10px; padding: 2px 8px;">${r.status}</span>
                            ${formatAgo(new Date(r.run_at).getTime())} &middot; ${formatDurationMs(r.duration_ms)}
                            ${r.error ? html`<div class="muted" style="margin-top: 2px; color: var(--danger);">${clampText(r.error, 100)}</div>` : nothing}
                          </div>
                        `)}
                      </div>
                    </details>
                  ` : nothing}
                </div>
                <div class="list-meta">
                  <div class="row" style="justify-content: flex-end; gap: 6px;">
                    ${t.status === 'active' ? html`
                      <button class="btn btn--sm" @click=${() => state.pauseTask(t.id)}>Pause</button>
                    ` : t.status === 'paused' ? html`
                      <button class="btn btn--sm" @click=${() => state.resumeTask(t.id)}>Resume</button>
                    ` : nothing}
                    <button class="btn btn--sm danger" @click=${() => state.deleteTask(t.id)}>Delete</button>
                  </div>
                  <div class="muted" style="margin-top: 4px;">ID: ${t.id.slice(0, 8)}</div>
                </div>
              </div>
            `)}
          </div>
        `
      }
    </section>
  `;
}
