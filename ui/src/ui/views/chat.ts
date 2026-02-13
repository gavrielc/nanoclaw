import { html, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { NanoClawApp } from '../app.ts';
import { toSanitizedMarkdownHtml } from '../markdown.ts';

export function renderChat(state: NanoClawApp) {
  const allMessages = state.chatMessages;

  return html`
    <div class="chat">
      <div class="chat-thread" id="chat-thread">
        ${allMessages.length === 0 && !state.chatStreaming
          ? html`<div class="muted" style="text-align: center; margin-top: 40px;">No messages yet. Send a message to start chatting with the agent.</div>`
          : nothing
        }
        ${allMessages.map(msg => {
          const isUser = !msg.is_from_me && msg.sender !== 'assistant';
          return html`
            <div class="chat-line ${isUser ? 'user' : 'assistant'}">
              <div class="chat-msg">
                <div class="chat-bubble">
                  <div class="chat-text">${isUser ? msg.content : unsafeHTML(toSanitizedMarkdownHtml(msg.content))}</div>
                </div>
                <div class="chat-stamp">${new Date(msg.timestamp).toLocaleTimeString()}</div>
              </div>
            </div>
          `;
        })}
        ${state.chatStreaming ? html`
          <div class="chat-line assistant">
            <div class="chat-msg">
              <div class="chat-bubble streaming">
                ${state.chatStreamText
                  ? html`<div class="chat-text">${unsafeHTML(toSanitizedMarkdownHtml(state.chatStreamText))}</div>`
                  : html`<div class="chat-reading-indicator"><div class="chat-reading-indicator__dots"><span></span><span></span><span></span></div></div>`
                }
              </div>
            </div>
          </div>
        ` : nothing}
      </div>

      <div class="chat-compose">
        <div class="field chat-compose__field">
          <textarea
            .value=${state.chatDraft}
            @input=${(e: Event) => state.chatDraft = (e.target as HTMLTextAreaElement).value}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                state.sendChat();
              }
            }}
            placeholder="Send a message..."
            ?disabled=${state.chatStreaming}
          ></textarea>
        </div>
        <div class="row chat-compose__actions">
          <button class="btn primary" @click=${() => state.sendChat()} ?disabled=${state.chatStreaming || !state.chatDraft.trim()}>
            Send
          </button>
        </div>
      </div>
    </div>
  `;
}
