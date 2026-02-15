import { html } from 'lit';
import type { NanoClawApp } from '../app.ts';

export function renderSessions(state: NanoClawApp) {
  const sessions = state.sessions;

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Sessions</div>
          <div class="card-sub">${sessions.length} active session${sessions.length !== 1 ? 's' : ''}.</div>
        </div>
        <button class="btn" ?disabled=${state.loading} @click=${() => state.loadSessions()}>
          ${state.loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      ${sessions.length === 0
        ? html`<div class="muted" style="margin-top: 16px;">No active sessions.</div>`
        : html`
          <div class="table" style="margin-top: 16px;">
            <div class="table-head" style="grid-template-columns: 1fr 1fr 2fr auto;">
              <div>Group</div>
              <div>Folder</div>
              <div>Session ID</div>
              <div></div>
            </div>
            ${sessions.map(s => html`
              <div class="table-row" style="grid-template-columns: 1fr 1fr 2fr auto;">
                <div>${s.groupName || s.groupFolder}</div>
                <div class="mono">${s.groupFolder}</div>
                <div class="mono" style="font-size: 12px; overflow: hidden; text-overflow: ellipsis;">${s.sessionId}</div>
                <div>
                  <button class="btn btn--sm danger" @click=${() => state.deleteSession(s.groupFolder)}>Delete</button>
                </div>
              </div>
            `)}
          </div>
        `
      }
    </section>
  `;
}
