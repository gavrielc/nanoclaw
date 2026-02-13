import { html, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { NanoClawApp } from '../app.ts';
import { toSanitizedMarkdownHtml } from '../markdown.ts';
import { clampText } from '../format.ts';

export function renderSkills(state: NanoClawApp) {
  const filter = state.skillsFilter.trim().toLowerCase();
  const filtered = filter
    ? state.skills.filter(s => [s.name, s.description].join(' ').toLowerCase().includes(filter))
    : state.skills;

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Skills</div>
          <div class="card-sub">Container skills from container/skills/.</div>
        </div>
        <div class="row" style="gap: 8px;">
          <button class="btn" ?disabled=${state.loading} @click=${() => state.loadSkills()}>
            ${state.loading ? 'Loading...' : 'Refresh'}
          </button>
          <button class="btn primary" @click=${() => {
            state.skillEditorName = '__new__';
            state.skillEditorContent = '---\ndescription: My new skill\nallowed-tools: Bash\n---\n\n# My Skill\n\nSkill instructions here.\n';
          }}>New Skill</button>
        </div>
      </div>

      <div class="filters" style="margin-top: 14px;">
        <label class="field" style="flex: 1;">
          <span>Filter</span>
          <input
            .value=${state.skillsFilter}
            @input=${(e: Event) => state.skillsFilter = (e.target as HTMLInputElement).value}
            placeholder="Search skills"
          />
        </label>
        <div class="muted">${filtered.length} shown</div>
      </div>

      ${filtered.length === 0
        ? html`<div class="muted" style="margin-top: 16px;">No skills found.</div>`
        : html`
          <div class="list" style="margin-top: 16px;">
            ${filtered.map(skill => html`
              <div class="list-item">
                <div class="list-main">
                  <div class="list-title">${skill.name}</div>
                  <div class="list-sub">${clampText(skill.description, 140)}</div>
                  <div class="chip-row" style="margin-top: 6px;">
                    <span class="chip ${skill.enabled ? 'chip-ok' : 'chip-warn'}">${skill.enabled ? 'Enabled' : 'Disabled'}</span>
                    ${skill.allowedTools.map(t => html`<span class="chip">${t}</span>`)}
                  </div>
                </div>
                <div class="list-meta">
                  <div class="row" style="justify-content: flex-end; gap: 6px;">
                    <button class="btn btn--sm" @click=${() => state.toggleSkill(skill.name)}>
                      ${skill.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button class="btn btn--sm" @click=${() => {
                      state.skillEditorName = skill.name;
                      state.skillEditorContent = skill.content;
                    }}>Edit</button>
                    <button class="btn btn--sm danger" @click=${() => {
                      if (confirm(`Delete skill "${skill.name}"?`)) state.deleteSkill(skill.name);
                    }}>Delete</button>
                  </div>
                </div>
              </div>
            `)}
          </div>
        `
      }
    </section>

    ${state.skillEditorName ? html`
      <section class="card" style="margin-top: 16px;">
        <div class="row" style="justify-content: space-between;">
          <div class="card-title">${state.skillEditorName === '__new__' ? 'New Skill' : `Edit: ${state.skillEditorName}`}</div>
          <button class="btn btn--sm" @click=${() => state.skillEditorName = null}>Close</button>
        </div>

        ${state.skillEditorName === '__new__' ? html`
          <label class="field" style="margin-top: 12px;">
            <span>Skill Name</span>
            <input id="new-skill-name" placeholder="my-skill" />
          </label>
        ` : nothing}

        <label class="field" style="margin-top: 12px;">
          <span>SKILL.md Content</span>
          <textarea
            .value=${state.skillEditorContent}
            @input=${(e: Event) => state.skillEditorContent = (e.target as HTMLTextAreaElement).value}
            rows="12"
            style="min-height: 200px;"
          ></textarea>
        </label>

        <div class="row" style="margin-top: 12px; gap: 8px;">
          <button class="btn primary" @click=${async () => {
            if (state.skillEditorName === '__new__') {
              const nameInput = document.getElementById('new-skill-name') as HTMLInputElement;
              const name = nameInput?.value?.trim();
              if (!name) return;
              await state.createSkill(name, state.skillEditorContent);
              state.skillEditorName = null;
            } else {
              await state.updateSkill(state.skillEditorName!, state.skillEditorContent);
              state.skillEditorName = null;
            }
          }}>Save</button>
          <button class="btn" @click=${() => state.skillEditorName = null}>Cancel</button>
        </div>

        ${state.skillEditorName !== '__new__' ? html`
          <details style="margin-top: 16px;">
            <summary class="muted" style="cursor: pointer;">Preview</summary>
            <div class="chat-text" style="margin-top: 8px; padding: 12px; background: var(--secondary); border-radius: var(--radius-md);">
              ${unsafeHTML(toSanitizedMarkdownHtml(state.skillEditorContent))}
            </div>
          </details>
        ` : nothing}
      </section>
    ` : nothing}
  `;
}
