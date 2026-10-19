/**
 * Shared ask_question payload schema + normalization.
 *
 * Producers (host-side approvals, container-side ask_user_question MCP tool)
 * emit an `ask_question` payload. Options may be bare strings for ergonomics,
 * but are normalized here into a consistent shape before delivery, persistence,
 * and rendering.
 */

/** Chat SDK button styles — Slack maps primary→green, danger→red; platforms
 *  without button colors (Telegram) ignore it. */
export type OptionStyle = 'primary' | 'danger' | 'default';

export interface OptionInput {
  label: string;
  selectedLabel?: string;
  value?: string;
  style?: OptionStyle;
}

export type RawOption = string | OptionInput;

export interface NormalizedOption {
  label: string;
  selectedLabel: string;
  value: string;
  style?: OptionStyle;
}

export function normalizeOption(raw: RawOption): NormalizedOption {
  if (typeof raw === 'string') {
    return { label: raw, selectedLabel: raw, value: raw };
  }
  const label = raw.label;
  return {
    label,
    selectedLabel: raw.selectedLabel ?? label,
    value: raw.value ?? label,
    style: raw.style === 'primary' || raw.style === 'danger' || raw.style === 'default' ? raw.style : undefined,
  };
}

export function normalizeOptions(raws: RawOption[]): NormalizedOption[] {
  return raws.map(normalizeOption);
}

export interface AskQuestionPayload {
  type: 'ask_question';
  questionId: string;
  title: string;
  question: string;
  options: NormalizedOption[];
  /** Set by host delivery on questions an agent asks; their markup is the agent's own and is not escaped. */
  fromAgent?: boolean;
}

/**
 * Render every control/format/invisible/bidi character — and backtick, so a
 * payload can never close a card's code fence — as a visible \uXXXX
 * escape. Applied to JSON-encoded payload fields: JSON.stringify already
 * escapes chars below 0x20, this covers the rest (Cf bidi/zero-width chars,
 * U+2028/U+2029 line separators, private-use, lone surrogates).
 */
export function escapeInvisibles(s: string): string {
  return s.replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\u2028\u2029`]/gu, (c) => {
    const cp = c.codePointAt(0) ?? 0;
    return cp > 0xffff ? `\\u{${cp.toString(16)}}` : `\\u${cp.toString(16).padStart(4, '0')}`;
  });
}

/**
 * Quote an untrusted name or value for card text: one line, no fence or hidden
 * characters. Markdown renderers would decode `&#10;` into a line break and
 * turn `](` into a link that swallows host text, so both are shown escaped.
 */
export function quoteForCard(value: string): string {
  return escapeInvisibles(JSON.stringify(value))
    .replace(/&(?=#?[0-9A-Za-z]+;)/g, '\\u0026')
    .replace(/\]\(/g, ']\\u0028');
}

/** Fence untrusted multi-line text for card text: lines kept, nothing inside can close the fence. */
export function fenceForCard(text: string): string {
  return '```\n' + text.split('\n').map(escapeInvisibles).join('\n') + '\n```';
}
