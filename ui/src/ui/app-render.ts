import { html, nothing } from 'lit';
import type { NanoClawApp } from './app.ts';
import { NAV_GROUPS, tabDescription } from './navigation.ts';
import { renderIcon } from './icons.ts';
import { renderOverview } from './views/overview.ts';
import { renderChat } from './views/chat.ts';
import { renderChannels } from './views/channels.ts';
import { renderGroups } from './views/groups.ts';
import { renderMessages } from './views/messages.ts';
import { renderTasks } from './views/tasks.ts';
import { renderSessions } from './views/sessions.ts';
import { renderSkills } from './views/skills.ts';
import { renderConfig } from './views/config.ts';
import { renderLogs } from './views/logs.ts';
import { renderDebug } from './views/debug.ts';

export function renderApp(state: NanoClawApp) {
  const isChat = state.tab === 'chat';

  return html`
    <div class="shell ${isChat ? 'shell--chat' : ''}">
      <!-- Topbar -->
      <header class="topbar">
        <div class="topbar-left">
          <div class="brand">
            <div class="brand-text">
              <div class="brand-title">NanoClaw</div>
              <div class="brand-sub">Control Panel</div>
            </div>
          </div>
        </div>
        <div class="topbar-status">
          <div class="pill">
            <div class="statusDot ${state.overview?.channels.some(c => c.connected) ? 'ok' : ''}"></div>
            <span class="mono">${state.overview?.channels.some(c => c.connected) ? 'Connected' : 'Offline'}</span>
          </div>
        </div>
      </header>

      <!-- Navigation -->
      <nav class="nav">
        ${NAV_GROUPS.map(group => html`
          <div class="nav-group">
            <div class="nav-label"><span class="nav-label__text">${group.label}</span></div>
            <div class="nav-group__items">
              ${group.items.map(item => html`
                <button
                  class="nav-item ${state.tab === item.id ? 'active' : ''}"
                  @click=${() => state.switchTab(item.id)}
                >
                  ${renderIcon(item.id as any)}
                  <span class="nav-item__text">${item.label}</span>
                </button>
              `)}
            </div>
          </div>
        `)}
      </nav>

      <!-- Content -->
      <main class="content ${isChat ? 'content--chat' : ''}">
        ${!isChat ? html`
          <div class="content-header">
            <div>
              <div class="page-title">${NAV_GROUPS.flatMap(g => g.items).find(i => i.id === state.tab)?.label ?? state.tab}</div>
              <div class="page-sub">${tabDescription(state.tab)}</div>
            </div>
          </div>
        ` : nothing}

        ${state.error ? html`<div class="callout danger">${state.error}</div>` : nothing}

        ${state.tab === 'overview' ? renderOverview(state) : nothing}
        ${state.tab === 'chat' ? renderChat(state) : nothing}
        ${state.tab === 'channels' ? renderChannels(state) : nothing}
        ${state.tab === 'groups' ? renderGroups(state) : nothing}
        ${state.tab === 'messages' ? renderMessages(state) : nothing}
        ${state.tab === 'tasks' ? renderTasks(state) : nothing}
        ${state.tab === 'sessions' ? renderSessions(state) : nothing}
        ${state.tab === 'skills' ? renderSkills(state) : nothing}
        ${state.tab === 'config' ? renderConfig(state) : nothing}
        ${state.tab === 'logs' ? renderLogs(state) : nothing}
        ${state.tab === 'debug' ? renderDebug(state) : nothing}
      </main>
    </div>
  `;
}
