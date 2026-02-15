import { html, nothing } from 'lit';
import type { NanoClawApp } from '../app.ts';
import type { LogLevel } from '../types.ts';

const LEVELS: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const LEVEL_NAMES: Record<number, LogLevel> = { 10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal' };

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString();
}

export function renderLogs(state: NanoClawApp) {
  const needle = state.logsFilterText.trim().toLowerCase();
  const filtered = state.logs.filter(entry => {
    if (needle && !entry.msg.toLowerCase().includes(needle)) return false;
    return true;
  });

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Logs</div>
          <div class="card-sub">In-memory log buffer (last 2000 entries).</div>
        </div>
        <button class="btn" ?disabled=${state.loading} @click=${() => state.loadLogs()}>
          ${state.loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <div class="filters" style="margin-top: 14px;">
        <label class="field" style="min-width: 220px;">
          <span>Filter</span>
          <input
            .value=${state.logsFilterText}
            @input=${(e: Event) => state.logsFilterText = (e.target as HTMLInputElement).value}
            placeholder="Search logs"
          />
        </label>
        <label class="field" style="min-width: 120px;">
          <span>Level</span>
          <select
            .value=${state.logsLevel}
            @change=${(e: Event) => {
              state.logsLevel = (e.target as HTMLSelectElement).value;
              state.loadLogs();
            }}
          >
            <option value="">All</option>
            ${LEVELS.map(l => html`<option value=${l}>${l}</option>`)}
          </select>
        </label>
      </div>

      <div class="log-stream" style="margin-top: 12px;">
        ${filtered.length === 0
          ? html`<div class="muted" style="padding: 12px;">No log entries.</div>`
          : filtered.map(entry => {
              const lvl = LEVEL_NAMES[entry.level] || 'info';
              return html`
                <div class="log-row">
                  <div class="log-time mono">${formatTime(entry.time)}</div>
                  <div class="log-level ${lvl}">${lvl}</div>
                  <div class="log-message mono">${entry.msg}</div>
                </div>
              `;
            })
        }
      </div>
    </section>
  `;
}
