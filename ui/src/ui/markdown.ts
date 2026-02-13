import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

const allowedTags = [
  'a', 'b', 'blockquote', 'br', 'code', 'del', 'em',
  'h1', 'h2', 'h3', 'h4', 'hr', 'i', 'li', 'ol', 'p',
  'pre', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
];
const allowedAttrs = ['class', 'href', 'rel', 'target', 'title', 'start'];

let hooksInstalled = false;

function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof HTMLAnchorElement)) return;
    node.setAttribute('rel', 'noreferrer noopener');
    node.setAttribute('target', '_blank');
  });
}

const cache = new Map<string, string>();
const CACHE_LIMIT = 200;
const CHAR_LIMIT = 140_000;

export function toSanitizedMarkdownHtml(markdown: string): string {
  const input = markdown.trim();
  if (!input) return '';
  installHooks();

  if (input.length <= 50_000) {
    const cached = cache.get(input);
    if (cached !== undefined) return cached;
  }

  let text = input;
  if (text.length > CHAR_LIMIT) {
    text = text.slice(0, CHAR_LIMIT) + `\n\n… truncated (${input.length} chars)`;
  }

  const rendered = marked.parse(text) as string;
  const sanitized = DOMPurify.sanitize(rendered, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: allowedAttrs,
  });

  if (input.length <= 50_000) {
    cache.set(input, sanitized);
    if (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
  }

  return sanitized;
}
