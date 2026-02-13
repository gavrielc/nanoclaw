import { html, nothing } from 'lit';
import type { NanoClawApp } from '../app.ts';
import { formatAgo, clampText } from '../format.ts';

export function renderGroups(state: NanoClawApp) {
  const groups = state.groups;

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Registered Groups</div>
          <div class="card-sub">${groups.length} group${groups.length !== 1 ? 's' : ''} registered.</div>
        </div>
        <button class="btn" ?disabled=${state.loading} @click=${() => state.loadGroups()}>
          ${state.loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      ${groups.length === 0
        ? html`<div class="muted" style="margin-top: 16px;">No groups registered yet.</div>`
        : html`
          <div class="list" style="margin-top: 16px;">
            ${groups.map(g => html`
              <div class="list-item" @click=${() => {
                state.selectedGroupFolder = state.selectedGroupFolder === g.folder ? null : g.folder;
              }} style="cursor: pointer;">
                <div class="list-main">
                  <div class="list-title">${g.name}</div>
                  <div class="list-sub">${g.folder} &middot; ${clampText(g.jid, 40)}</div>
                  <div class="chip-row" style="margin-top: 6px;">
                    <span class="chip ${g.containerActive ? 'chip-ok' : ''}">${g.containerActive ? 'Running' : 'Idle'}</span>
                    ${g.requiresTrigger !== false ? html`<span class="chip">Trigger: ${g.trigger}</span>` : html`<span class="chip chip-ok">Auto</span>`}
                    ${g.sessionId ? html`<span class="chip">Session active</span>` : nothing}
                  </div>
                </div>
                <div class="list-meta">
                  <div>Added ${formatAgo(new Date(g.added_at).getTime())}</div>
                </div>
              </div>
              ${state.selectedGroupFolder === g.folder ? html`
                <div class="card" style="margin-top: -4px; border-top: none; border-top-left-radius: 0; border-top-right-radius: 0;">
                  <div class="status-list">
                    <div><span class="label">JID</span><span class="mono">${g.jid}</span></div>
                    <div><span class="label">Folder</span><span class="mono">${g.folder}</span></div>
                    <div><span class="label">Trigger</span><span>${g.trigger}</span></div>
                    <div><span class="label">Requires Trigger</span><span>${g.requiresTrigger !== false ? 'Yes' : 'No'}</span></div>
                    <div><span class="label">Session ID</span><span class="mono">${g.sessionId || 'none'}</span></div>
                    <div><span class="label">Container Active</span><span>${g.containerActive ? 'Yes' : 'No'}</span></div>
                  </div>
                  ${g.containerConfig ? html`
                    <div style="margin-top: 12px;">
                      <div class="muted" style="margin-bottom: 6px;">Container Config</div>
                      <pre class="code-block">${JSON.stringify(g.containerConfig, null, 2)}</pre>
                    </div>
                  ` : nothing}
                </div>
              ` : nothing}
            `)}
          </div>
        `
      }
    </section>
  `;
}
