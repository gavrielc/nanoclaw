import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { getPendingMessages } from '../db/messages-in.js';
import { extractAttachments } from '../formatter.js';
import { closeSessionDb, getInboundDb, initTestSessionDb } from '../mailbox/sqlite/connection.js';
import {
  buildAttachmentFileParts,
  buildPromptParts,
  inspectNativeAttachment,
  resolveNativeAttachmentLimits,
  sniffMediaType,
  type NativeAttachmentFileInfo,
  type NativeAttachmentLimits,
} from './opencode.js';

const bytes = (text: string): Uint8Array => Buffer.from(text, 'latin1');

const PNG = bytes('\x89PNG\r\n\x1a\n\x00\x00\x00\x0d');
const JPEG = bytes('\xff\xd8\xff\xe0\x00\x10JFIF\x00');
const GIF = bytes('GIF89a\x01\x00\x01\x00');
const WEBP = bytes('RIFF\x24\x00\x00\x00WEBP');
const PDF = bytes('%PDF-1.7\n%');
const HEIC = bytes('\x00\x00\x00\x18ftypheic');
const SVG = bytes('<svg xmlns="');
const TEXT = bytes('just some te');

const FILES = new Map<string, { size: number; head: Uint8Array }>([
  ['/workspace/inbox/msg-1/cat.png', { size: 1_024, head: PNG }],
  ['/workspace/inbox/msg-1/photo.jpg', { size: 1_024, head: JPEG }],
  ['/workspace/inbox/msg-1/anim.gif', { size: 1_024, head: GIF }],
  ['/workspace/inbox/msg-1/pic.webp', { size: 1_024, head: WEBP }],
  ['/workspace/inbox/msg-1/report.pdf', { size: 2_048, head: PDF }],
  ['/workspace/inbox/msg-1/phone.heic', { size: 1_024, head: HEIC }],
  ['/workspace/inbox/msg-1/logo.svg', { size: 1_024, head: SVG }],
  ['/workspace/inbox/msg-1/fake.png', { size: 1_024, head: TEXT }],
  ['/workspace/inbox/msg-1/blob', { size: 128, head: TEXT }],
  ['/workspace/inbox/msg-1/second.png', { size: 3_072, head: PNG }],
]);
const inspect = (filePath: string): NativeAttachmentFileInfo | null => {
  const file = FILES.get(filePath);
  return file === undefined ? null : { realPath: filePath, ...file };
};
const anyPng = (filePath: string): NativeAttachmentFileInfo => ({ realPath: filePath, size: 10, head: PNG });
const generous: NativeAttachmentLimits = { maxCount: 8, maxBytes: 25 * 1024 * 1024 };

function attachment(filename: string, mime?: string, sourceMessageId = 'msg-1') {
  return {
    sourceMessageId,
    filename,
    ...(mime ? { mime } : {}),
    path: `/workspace/inbox/${sourceMessageId}/${filename}`,
  };
}

afterEach(() => {
  delete process.env.OPENCODE_NATIVE_ATTACHMENT_MAX_COUNT;
  delete process.env.OPENCODE_NATIVE_ATTACHMENT_MAX_BYTES;
});

describe('sniffMediaType', () => {
  it('recognizes JPEG, PNG, GIF, WebP and PDF by their first bytes', () => {
    expect([JPEG, PNG, GIF, WEBP, PDF].map(sniffMediaType)).toEqual([
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
    ]);
  });

  it('recognizes nothing else, including short or empty input', () => {
    expect([HEIC, SVG, TEXT, bytes('RIFF'), bytes('')].map(sniffMediaType)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe('inspectNativeAttachment', () => {
  it('reads the size and first bytes of a regular file, and refuses a symlink', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'opencode-attach-'));
    try {
      const file = path.join(dir, 'cat.png');
      writeFileSync(file, Buffer.concat([Buffer.from(PNG), Buffer.alloc(100)]));
      symlinkSync(file, path.join(dir, 'link.png'));
      const info = inspectNativeAttachment(file);
      expect(info?.size).toBe(PNG.length + 100);
      expect(info && sniffMediaType(info.head)).toBe('image/png');
      expect(inspectNativeAttachment(path.join(dir, 'link.png'))).toBeNull();
      expect(inspectNativeAttachment(path.join(dir, 'missing.png'))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildAttachmentFileParts', () => {
  it('sends a message-bound image as a file part', () => {
    expect(buildAttachmentFileParts([attachment('cat.png', 'image/png')], inspect, generous)).toEqual([
      {
        type: 'file',
        mime: 'image/png',
        filename: 'msg-1--cat.png',
        url: 'file:///workspace/inbox/msg-1/cat.png',
      },
    ]);
  });

  it('sends each supported type with the mime its bytes show', () => {
    const parts = buildAttachmentFileParts(
      ['photo.jpg', 'cat.png', 'anim.gif', 'pic.webp', 'report.pdf'].map((name) => attachment(name)),
      inspect,
      generous,
    );
    expect(parts.map((part) => part.mime)).toEqual([
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
    ]);
  });

  it('keeps HEIC, SVG, a mislabelled file and other files as prompt text', () => {
    expect(
      buildAttachmentFileParts(
        [
          attachment('phone.heic', 'image/heic'),
          attachment('logo.svg', 'image/svg+xml'),
          attachment('fake.png', 'image/png'),
          attachment('blob'),
        ],
        inspect,
        generous,
      ),
    ).toEqual([]);
  });

  it('trusts the bytes over the reported mime', () => {
    expect(buildAttachmentFileParts([attachment('cat.png', 'text/plain')], inspect, generous)).toEqual([
      expect.objectContaining({ mime: 'image/png' }),
    ]);
  });

  it('accepts a routed message id', () => {
    expect(buildAttachmentFileParts([attachment('cat.png', undefined, 'tg-42:ag-1')], anyPng, generous)).toEqual([
      expect.objectContaining({ filename: 'tg-42:ag-1--cat.png' }),
    ]);
  });

  it('keeps a file with an unusual name or message id as prompt text', () => {
    const unusual = [
      attachment('say "hi".png'),
      attachment('two\nlines.png'),
      attachment('a<b>.png'),
      attachment('cat.png', undefined, 'id"1'),
      attachment('cat.png', undefined, 'id<1>'),
    ];
    expect(buildAttachmentFileParts(unusual, anyPng, generous)).toEqual([]);
  });

  it('rejects a path outside the source message inbox even when it exists', () => {
    const forged = { sourceMessageId: 'msg-1', filename: 'cat.png', path: '/workspace/agent/cat.png' };
    expect(buildAttachmentFileParts([forged], anyPng, generous)).toEqual([]);
  });

  it('rejects a symlink/escape reported by filesystem inspection', () => {
    const escapedInspect = (): NativeAttachmentFileInfo => ({
      realPath: '/workspace/agent/private.pdf',
      size: 10,
      head: PDF,
    });
    expect(buildAttachmentFileParts([attachment('report.pdf')], escapedInspect, generous)).toEqual([]);
  });

  it('skips a missing file', () => {
    expect(buildAttachmentFileParts([attachment('gone.png', 'image/png', 'msg-9')], inspect, generous)).toEqual([]);
  });

  it('keeps an entry missing its source id, name, or path as prompt text instead of throwing', () => {
    const { sourceMessageId: _id, ...noId } = attachment('cat.png');
    const { filename: _name, ...noName } = attachment('cat.png');
    const { path: _path, ...noPath } = attachment('cat.png');
    expect(buildAttachmentFileParts([noId, noName, noPath], inspect, generous)).toEqual([]);
  });

  it('enforces count and actual total-byte limits', () => {
    const files = [attachment('cat.png'), attachment('second.png')];
    expect(buildAttachmentFileParts(files, inspect, { maxCount: 1, maxBytes: 10_000 })).toHaveLength(1);
    expect(buildAttachmentFileParts(files, inspect, { maxCount: 8, maxBytes: 3_000 })).toHaveLength(1);
    expect(buildAttachmentFileParts(files, inspect, { maxCount: 8, maxBytes: 500 })).toEqual([]);
  });

  it('uses safe defaults and accepts positive environment overrides', () => {
    expect(resolveNativeAttachmentLimits()).toEqual({ maxCount: 8, maxBytes: 25 * 1024 * 1024 });
    process.env.OPENCODE_NATIVE_ATTACHMENT_MAX_COUNT = '3';
    process.env.OPENCODE_NATIVE_ATTACHMENT_MAX_BYTES = '4096';
    expect(resolveNativeAttachmentLimits()).toEqual({ maxCount: 3, maxBytes: 4096 });
  });

  it('ignores invalid environment overrides', () => {
    process.env.OPENCODE_NATIVE_ATTACHMENT_MAX_COUNT = '0';
    process.env.OPENCODE_NATIVE_ATTACHMENT_MAX_BYTES = '25mb';
    expect(resolveNativeAttachmentLimits()).toEqual({ maxCount: 8, maxBytes: 25 * 1024 * 1024 });
  });
});

describe('buildPromptParts', () => {
  it('carries native media on opening and follow-up prompt construction', () => {
    expect(buildPromptParts('what is this?', [attachment('cat.png', 'image/png')], inspect, generous)).toEqual([
      { type: 'text', text: 'what is this?' },
      {
        type: 'file',
        mime: 'image/png',
        filename: 'msg-1--cat.png',
        url: 'file:///workspace/inbox/msg-1/cat.png',
      },
    ]);
  });

  it('stays text-only when there are no accepted attachments', () => {
    expect(buildPromptParts('just words', undefined, inspect, generous)).toEqual([
      { type: 'text', text: 'just words' },
    ]);
  });
});

describe('core extractAttachments feeding buildPromptParts', () => {
  afterEach(() => {
    closeSessionDb();
  });

  // Content shaped the way the host writes it after staging a file to the inbox.
  function insertChat(id: string, attachments: object[]): void {
    getInboundDb()
      .prepare(
        `INSERT INTO messages_in (id, kind, timestamp, status, content)
         VALUES (?, 'chat', ?, 'pending', ?)`,
      )
      .run(id, new Date().toISOString(), JSON.stringify({ text: 'look', attachments }));
  }

  it('turns a staged image into a file part bound to its message', () => {
    initTestSessionDb();
    insertChat('msg-1', [
      { type: 'image', name: 'cat.png', mimeType: 'image/png', size: 1_024, localPath: 'inbox/msg-1/cat.png' },
    ]);
    const attachments = extractAttachments(getPendingMessages());
    expect(buildPromptParts('look', attachments, inspect, generous)).toEqual([
      { type: 'text', text: 'look' },
      {
        type: 'file',
        mime: 'image/png',
        filename: 'msg-1--cat.png',
        url: 'file:///workspace/inbox/msg-1/cat.png',
      },
    ]);
  });

  it('keeps url-only and foreign-inbox attachments as prompt text', () => {
    initTestSessionDb();
    insertChat('msg-1', [{ type: 'image', name: 'remote.png', url: 'https://example.test/remote.png' }]);
    // A row whose staged path names another message's inbox is not sent as media.
    insertChat('msg-2', [{ type: 'image', name: 'cat.png', mimeType: 'image/png', localPath: 'inbox/msg-1/cat.png' }]);
    const attachments = extractAttachments(getPendingMessages());
    expect(attachments.map((a) => a.sourceMessageId)).toEqual(['msg-2']);
    expect(buildPromptParts('look', attachments, inspect, generous)).toEqual([{ type: 'text', text: 'look' }]);
  });
});
