/**
 * Email Channel for NanoClaw
 *
 * Monitors IMAP folders for incoming emails and passes them to the agent.
 * Can create draft replies via IMAP APPEND. Never sends email directly.
 */
import { ImapFlow } from 'imapflow';

import { EmailConfig, IncomingEmail } from './types.js';
import { isEmailProcessed, markEmailProcessed } from './db.js';
import { logger } from './logger.js';

export interface EmailDraft {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}

export interface EmailChannelDeps {
  processEmails: (emails: IncomingEmail[]) => Promise<void>;
}

class ImapWatcher {
  private client: ImapFlow;
  private folder: string;
  private config: EmailConfig;
  private running = false;
  private reconnectDelay = 5000;
  private onEmails: (emails: IncomingEmail[]) => Promise<void>;
  private processingLock: Promise<void> = Promise.resolve();

  constructor(
    config: EmailConfig,
    folder: string,
    onEmails: (emails: IncomingEmail[]) => Promise<void>,
  ) {
    this.config = config;
    this.folder = folder;
    this.onEmails = onEmails;
    this.client = this.createClient();
  }

  private createClient(): ImapFlow {
    return new ImapFlow({
      host: this.config.imap.host,
      port: this.config.imap.port,
      secure: this.config.imap.tls,
      auth: this.config.imap.auth,
      logger: false,
    });
  }

  async start(): Promise<void> {
    this.running = true;
    await this.connectAndWatch();
  }

  private async connectAndWatch(): Promise<void> {
    while (this.running) {
      try {
        this.client = this.createClient();
        await this.client.connect();
        logger.info({ folder: this.folder }, 'IMAP connected');
        this.reconnectDelay = 5000;

        const lock = await this.client.getMailboxLock(this.folder);
        try {
          // Process existing unseen messages
          await this.processNewMessagesWithLock();

          // Listen for new messages via IDLE
          // Use a lock to prevent duplicate processing when multiple 'exists' events fire rapidly
          this.client.on('exists', () => {
            this.processNewMessagesWithLock().catch((err) =>
              logger.error({ err, folder: this.folder }, 'Error processing new emails'),
            );
          });

          // Block until connection drops or stop() is called
          await new Promise<void>((resolve) => {
            this.client.on('close', () => resolve());
            this.client.on('error', () => resolve());
          });
        } finally {
          lock.release();
        }
      } catch (err) {
        logger.error(
          { err, folder: this.folder, delay: this.reconnectDelay },
          'IMAP connection error, reconnecting',
        );
      }

      if (!this.running) break;

      await new Promise((r) => setTimeout(r, this.reconnectDelay));
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 300000);
    }
  }

  /**
   * Process new messages with a lock to prevent duplicate processing.
   * Multiple 'exists' events can fire rapidly (e.g., when marking as seen triggers another update).
   * This ensures only one processNewMessages runs at a time.
   */
  private async processNewMessagesWithLock(): Promise<void> {
    // Chain onto the existing lock - if another call is in progress, wait for it
    const previousLock = this.processingLock;
    let resolve: () => void;
    this.processingLock = new Promise((r) => { resolve = r; });

    try {
      await previousLock;
      await this.processNewMessages();
    } finally {
      resolve!();
    }
  }

  private async processNewMessages(): Promise<void> {
    const uids = await this.client.search({ seen: false }, { uid: true });
    if (!uids || uids.length === 0) return;

    const batch: IncomingEmail[] = [];
    const processedUids: number[] = [];

    for (const uid of uids) {
      try {
        const msg = await this.client.fetchOne(String(uid), {
          envelope: true,
          bodyStructure: true,
          uid: true,
        } as any, { uid: true });

        if (!msg || !msg.envelope) continue;

        const messageId = msg.envelope.messageId || '';
        if (!messageId || isEmailProcessed(messageId)) {
          // Mark as seen even if already processed
          await this.client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
          continue;
        }

        // Download plain text body
        const body = await this.downloadTextBody(uid, msg.bodyStructure);

        const email: IncomingEmail = {
          uid,
          messageId,
          from: msg.envelope.from?.[0]?.address || '',
          fromName: msg.envelope.from?.[0]?.name || msg.envelope.from?.[0]?.address || '',
          to: (msg.envelope.to || []).map((a) => a.address || '').filter(Boolean),
          subject: msg.envelope.subject || '(no subject)',
          body,
          date: msg.envelope.date || new Date(),
          inReplyTo: msg.envelope.inReplyTo,
          folder: this.folder,
        };

        // Get References header separately if needed
        const headerBuf = await this.client.fetchOne(String(uid), {
          headers: ['references'],
          uid: true,
        } as any, { uid: true });
        if (headerBuf && headerBuf.headers) {
          const headerStr = headerBuf.headers.toString();
          const match = headerStr.match(/^References:\s*(.+)/im);
          if (match) email.references = match[1].trim();
        }

        markEmailProcessed(messageId, this.folder);
        await this.client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        processedUids.push(uid);

        logger.info(
          { from: email.from, subject: email.subject, folder: this.folder },
          'New email received',
        );

        batch.push(email);
      } catch (err) {
        logger.error({ err, uid, folder: this.folder }, 'Error processing email');
      }
    }

    // Send entire batch to the agent in one call
    if (batch.length > 0) {
      logger.info({ count: batch.length, folder: this.folder }, 'Processing email batch');
      await this.onEmails(batch);

      // Move all processed emails to processed folder
      for (const uid of processedUids) {
        try {
          await this.client.messageMove(String(uid), this.config.processedFolder, { uid: true });
        } catch (moveErr) {
          logger.warn({ err: moveErr, uid }, 'Failed to move email to processed folder');
        }
      }
    }
  }

  private async downloadTextBody(
    uid: number,
    bodyStructure: any,
  ): Promise<string> {
    try {
      // Find the text/plain part
      const part = this.findTextPart(bodyStructure);
      const partId = part?.part || '1';

      const { content } = await this.client.download(String(uid), partId, { uid: true });
      const chunks: Buffer[] = [];
      for await (const chunk of content) {
        chunks.push(chunk as Buffer);
      }
      const text = Buffer.concat(chunks).toString('utf-8');
      // Truncate very long emails
      return text.length > 10000 ? text.slice(0, 10000) + '\n[...truncated]' : text;
    } catch {
      return '(unable to extract email body)';
    }
  }

  private findTextPart(structure: any): any {
    if (!structure) return null;
    if (structure.type === 'text/plain') return structure;
    if (structure.childNodes) {
      for (const child of structure.childNodes) {
        const found = this.findTextPart(child);
        if (found) return found;
      }
    }
    return null;
  }

  async stop(): Promise<void> {
    this.running = false;
    try {
      await this.client.logout();
    } catch {
      this.client.close();
    }
  }
}

export class EmailChannel {
  private watchers: ImapWatcher[] = [];
  private config: EmailConfig;
  private deps: EmailChannelDeps;
  private draftClient: ImapFlow | null = null;

  constructor(config: EmailConfig, deps: EmailChannelDeps) {
    this.config = config;
    this.deps = deps;
  }

  async start(): Promise<void> {
    // Ensure monitored and processed folders exist
    for (const folder of this.config.monitoredFolders) {
      await this.ensureFolder(folder);
    }
    await this.ensureFolder(this.config.processedFolder);

    // Start a watcher per monitored folder
    for (const folder of this.config.monitoredFolders) {
      const watcher = new ImapWatcher(this.config, folder, (emails) =>
        this.deps.processEmails(emails),
      );
      this.watchers.push(watcher);
      watcher.start().catch((err) =>
        logger.error({ err, folder }, 'IMAP watcher failed'),
      );
    }

    logger.info(
      {
        folders: this.config.monitoredFolders,
        address: this.config.address,
      },
      'Email channel started',
    );
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    const client = new ImapFlow({
      host: this.config.imap.host,
      port: this.config.imap.port,
      secure: this.config.imap.tls,
      auth: this.config.imap.auth,
      logger: false,
    });

    try {
      await client.connect();
      try {
        await client.mailboxCreate(folderPath);
        logger.info({ folder: folderPath }, 'Created IMAP folder');
      } catch {
        // Already exists
      }
      await client.logout();
    } catch (err) {
      logger.warn({ err, folder: folderPath }, 'Failed to ensure IMAP folder');
      try { client.close(); } catch { /* ignore */ }
    }
  }

  async createDraft(draft: EmailDraft): Promise<void> {
    const client = new ImapFlow({
      host: this.config.imap.host,
      port: this.config.imap.port,
      secure: this.config.imap.tls,
      auth: this.config.imap.auth,
      logger: false,
    });

    try {
      await client.connect();

      const rfc822 = this.buildRfc822(draft);
      await client.append(this.config.draftsFolder, rfc822, ['\\Draft', '\\Seen']);

      logger.info(
        { to: draft.to, subject: draft.subject },
        'Email draft created',
      );

      await client.logout();
    } catch (err) {
      logger.error({ err, to: draft.to }, 'Failed to create email draft');
      try { client.close(); } catch { /* ignore */ }
      throw err;
    }
  }

  private buildRfc822(draft: EmailDraft): string {
    const boundary = `----=_Part_${Date.now()}`;
    const date = new Date().toUTCString();
    const msgId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${this.config.address.split('@')[1]}>`;

    let headers = `From: "${this.config.fromName}" <${this.config.address}>\r\n`;
    headers += `To: ${draft.to}\r\n`;
    headers += `Subject: ${draft.subject}\r\n`;
    headers += `Date: ${date}\r\n`;
    headers += `Message-ID: ${msgId}\r\n`;
    headers += `MIME-Version: 1.0\r\n`;
    headers += `Content-Type: text/plain; charset=utf-8\r\n`;
    headers += `Content-Transfer-Encoding: 8bit\r\n`;

    if (draft.inReplyTo) {
      headers += `In-Reply-To: ${draft.inReplyTo}\r\n`;
    }
    if (draft.references) {
      headers += `References: ${draft.references}\r\n`;
    }

    return `${headers}\r\n${draft.body}\r\n`;
  }

  async stop(): Promise<void> {
    await Promise.all(this.watchers.map((w) => w.stop()));
    logger.info('Email channel stopped');
  }
}
