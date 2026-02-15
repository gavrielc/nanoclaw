import { html, nothing } from 'lit';
import type { NanoClawApp } from '../app.ts';

export function renderConfig(state: NanoClawApp) {
  const config = state.config;

  return html`
    <section class="card">
      <div class="card-title">System Configuration</div>
      <div class="card-sub">Current configuration values (read-only, set via environment variables).</div>

      ${!config
        ? html`<div class="muted" style="margin-top: 16px;">Loading...</div>`
        : html`
          <div class="status-list" style="margin-top: 16px;">
            ${Object.entries(config.values).map(([key, info]) => html`
              <div>
                <span>
                  <span style="font-weight: 500;">${key}</span>
                  <br/><span class="muted" style="font-size: 11px;">${info.description}</span>
                </span>
                <span>
                  <span class="mono">${String(info.value)}</span>
                  <br/><span class="muted" style="font-size: 11px;">env: ${info.env}</span>
                </span>
              </div>
            `)}
          </div>
        `
      }
    </section>

    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">CLAUDE.md Editor</div>
          <div class="card-sub">Edit per-group or global CLAUDE.md files.</div>
        </div>
        ${state.claudeMdDirty ? html`
          <button class="btn primary" @click=${() => state.saveClaudeMd()}>Save</button>
        ` : nothing}
      </div>

      <div class="filters" style="margin-top: 14px;">
        <label class="field" style="min-width: 200px;">
          <span>Scope</span>
          <select
            .value=${state.claudeMdFolder}
            @change=${(e: Event) => {
              state.claudeMdFolder = (e.target as HTMLSelectElement).value;
              state.loadClaudeMd();
            }}
          >
            <option value="global">Global</option>
            ${state.groups.map(g => html`<option value=${g.folder}>${g.name} (${g.folder})</option>`)}
          </select>
        </label>
      </div>

      <label class="field" style="margin-top: 12px;">
        <span>Content</span>
        <textarea
          .value=${state.claudeMdContent}
          @input=${(e: Event) => {
            state.claudeMdContent = (e.target as HTMLTextAreaElement).value;
            state.claudeMdDirty = true;
          }}
          rows="16"
          style="min-height: 300px;"
        ></textarea>
      </label>
    </section>
  `;
}
