/**
 * Email Channel for NanoClaw
 * Polls Gmail via the gmail-autoauth-mcp MCP server (stdio subprocess)
 * and routes new labeled emails to the agent.
 */
import { spawn, ChildProcess } from 'child_process';

import { EMAIL_CHANNEL } from './config.js';
import { logger } from './logger.js';

export interface EmailMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  body: string;
  date: string;
}

// ---------------------------------------------------------------------------
// Lightweight MCP stdio client — spawns the server, handshakes, runs calls
// ---------------------------------------------------------------------------

import path from 'path';

const NODE_PATH = '/opt/homebrew/Cellar/node@22/22.22.0/bin/node';
// Entry point for the locally-installed Gmail MCP package
const GMAIL_MCP_ENTRY = path.resolve(process.cwd(), 'node_modules/@gongrzhe/server-gmail-autoauth-mcp/dist/index.js');

/**
 * One-shot MCP call: spawn the server, handshake, run a single tool call,
 * collect the response, then close. Avoids keeping the process alive across
 * multiple calls (which hangs under launchd for unknown reasons).
 */
async function gmailMcpCall(toolName: string, args: Record<string, unknown>): Promise<string> {
  // Build all messages upfront and pipe them in one write so the server
  // can process them sequentially and we can read responses from stdout.
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'nanoclaw', version: '1.0' } } },
    { jsonrpc: '2.0', method: 'initialized', params: {} },                          // notification, no id
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: toolName, arguments: args } },
  ];
  const input = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';

  return new Promise<string>((resolve, reject) => {
    const child: ChildProcess = spawn(NODE_PATH, [GMAIL_MCP_ENTRY], {
      env: {
        ...process.env,
        PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`,
        HOME: process.env.HOME || '/Users/raymondchen',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
    });

    let stdout = '';
    let stderr = '';

    child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('error', (err) => {
      logger.error({ err }, 'Gmail MCP spawn error');
      reject(err);
    });

    child.on('close', () => {
      // Parse the tools/call response (id: 2) from stdout
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 2 && msg.result?.content?.[0]?.text != null) {
            resolve(msg.result.content[0].text);
            return;
          }
        } catch {
          // skip non-JSON lines
        }
      }
      // No tools/call response found
      resolve('');
    });

    // Write all messages and close stdin so the server processes and exits
    child.stdin!.write(input);
    child.stdin!.end();

    // Safety timeout
    setTimeout(() => {
      child.kill();
      reject(new Error('Gmail MCP call timed out'));
    }, 20000);
  });
}

// ---------------------------------------------------------------------------
// Parsing helpers for the plain-text responses from this MCP
// ---------------------------------------------------------------------------

/**
 * search_emails returns one block per message like:
 *   ID: <id>
 *   Subject: <subject>
 *   From: <from>
 *   Date: <date>
 */
function parseSearchResults(text: string): Array<{ id: string; subject: string; from: string; date: string }> {
  const results: Array<{ id: string; subject: string; from: string; date: string }> = [];
  const blocks = text.split(/\n\s*\n/);

  for (const block of blocks) {
    if (!block.trim()) continue;
    let id = '', subject = '', from = '', date = '';

    for (const line of block.trim().split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim().toLowerCase();
      const val = line.slice(colonIdx + 1).trim();

      if (key === 'id') id = val;
      else if (key === 'subject') subject = val;
      else if (key === 'from') from = val;
      else if (key === 'date') date = val;
    }

    if (id) results.push({ id, subject, from, date });
  }

  return results;
}

/**
 * read_email returns headers + body separated by a blank line:
 *   Thread ID: <threadId>
 *   Subject: <subject>
 *   From: <from>
 *   To: <to>
 *   Date: <date>
 *
 *   <body>
 */
function parseReadEmail(text: string): { threadId: string; from: string; subject: string; date: string; body: string } {
  const blankIdx = text.indexOf('\n\n');
  const headerSection = blankIdx === -1 ? text : text.slice(0, blankIdx);
  const body = blankIdx === -1 ? '' : text.slice(blankIdx + 2);

  let threadId = '', from = '', subject = '', date = '';
  for (const line of headerSection.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const val = line.slice(colonIdx + 1).trim();

    if (key === 'thread id') threadId = val;
    else if (key === 'from') from = val;
    else if (key === 'subject') subject = val;
    else if (key === 'date') date = val;
  }

  return { threadId, from, subject, date, body };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Poll Gmail for new emails matching the configured trigger.
 */
export async function checkForNewEmails(): Promise<EmailMessage[]> {
  let query: string;
  switch (EMAIL_CHANNEL.triggerMode) {
    case 'label':
      query = `label:${EMAIL_CHANNEL.triggerValue} is:unread`;
      break;
    case 'address':
      query = `to:${EMAIL_CHANNEL.triggerValue} is:unread`;
      break;
    case 'subject':
      query = `subject:"${EMAIL_CHANNEL.triggerValue}" is:unread`;
      break;
  }

  let searchText: string;
  try {
    searchText = await gmailMcpCall('search_emails', { query, maxResults: 25 });
  } catch (err) {
    logger.error({ err }, 'Gmail search failed');
    return [];
  }

  const summaries = parseSearchResults(searchText);
  if (summaries.length === 0) return [];

  logger.info({ count: summaries.length }, 'Gmail found new emails');

  const emails: EmailMessage[] = [];
  for (const summary of summaries) {
    try {
      const readText = await gmailMcpCall('read_email', { messageId: summary.id });
      const parsed = parseReadEmail(readText);

      emails.push({
        id: summary.id,
        threadId: parsed.threadId || summary.id,
        from: parsed.from || summary.from,
        subject: parsed.subject || summary.subject,
        body: parsed.body,
        date: parsed.date || summary.date,
      });
    } catch (err) {
      logger.error({ id: summary.id, err }, 'Gmail read_email failed');
    }
  }

  return emails;
}

/**
 * Send an email reply via the Gmail MCP.
 * `to` is extracted from the original sender address.
 */
export async function sendEmailReply(
  to: string,
  subject: string,
  body: string,
  threadId?: string,
  inReplyTo?: string,
): Promise<void> {
  const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
  const prefixedBody = EMAIL_CHANNEL.replyPrefix
    ? `${EMAIL_CHANNEL.replyPrefix}${body}`
    : body;

  // Extract bare address from "Display Name <addr>" format
  const match = to.match(/<(.+?)>/);
  const addr = match ? match[1] : to;

  const args: Record<string, unknown> = {
    to: [addr],
    subject: replySubject,
    body: prefixedBody,
  };
  if (threadId) args.threadId = threadId;
  if (inReplyTo) args.inReplyTo = inReplyTo;

  try {
    await gmailMcpCall('send_email', args);
    logger.info({ to: addr, subject: replySubject }, 'Email reply sent');
  } catch (err) {
    logger.error({ to: addr, err }, 'Failed to send email reply');
  }
}

/**
 * Derive the group folder key for an email based on the configured context mode.
 */
export function getContextKey(email: EmailMessage): string {
  switch (EMAIL_CHANNEL.contextMode) {
    case 'thread':
      return `email-thread-${email.threadId}`;
    case 'sender': {
      const match = email.from.match(/<(.+?)>/);
      const addr = (match ? match[1] : email.from).toLowerCase().replace(/[^a-z0-9.@-]/g, '');
      return `email-sender-${addr}`;
    }
    case 'single':
      return 'email-main';
  }
}
