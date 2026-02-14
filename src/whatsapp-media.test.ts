import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- Mocks ---

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockMkdirSync = vi.fn();
const mockWriteFileSync = vi.fn();

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
      writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
    },
  };
});

const mockDownloadMediaMessage = vi.fn();

vi.mock('@whiskeysockets/baileys', () => ({
  downloadMediaMessage: (...args: unknown[]) => mockDownloadMediaMessage(...args),
}));

import { getMediaInfo, downloadAndSaveMedia } from './whatsapp-media.js';
import type { WAMessage } from '@whiskeysockets/baileys';

// --- Helpers ---

function makeMessage(overrides: Partial<WAMessage> = {}): WAMessage {
  return {
    key: { id: 'test-msg-id', remoteJid: 'group@g.us' },
    ...overrides,
  } as WAMessage;
}

// --- Tests ---

describe('getMediaInfo', () => {
  it('returns null when message has no content', () => {
    expect(getMediaInfo(makeMessage({ message: undefined }))).toBeNull();
    expect(getMediaInfo(makeMessage({ message: null as any }))).toBeNull();
  });

  it('detects imageMessage', () => {
    const msg = makeMessage({
      message: { imageMessage: { mimetype: 'image/jpeg' } } as any,
    });
    expect(getMediaInfo(msg)).toEqual({ type: 'imageMessage', mimetype: 'image/jpeg' });
  });

  it('detects videoMessage', () => {
    const msg = makeMessage({
      message: { videoMessage: { mimetype: 'video/mp4' } } as any,
    });
    expect(getMediaInfo(msg)).toEqual({ type: 'videoMessage', mimetype: 'video/mp4' });
  });

  it('detects audioMessage', () => {
    const msg = makeMessage({
      message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true } } as any,
    });
    expect(getMediaInfo(msg)).toEqual({ type: 'audioMessage', mimetype: 'audio/ogg; codecs=opus' });
  });

  it('detects documentMessage', () => {
    const msg = makeMessage({
      message: { documentMessage: { mimetype: 'application/pdf' } } as any,
    });
    expect(getMediaInfo(msg)).toEqual({ type: 'documentMessage', mimetype: 'application/pdf' });
  });

  it('detects stickerMessage', () => {
    const msg = makeMessage({
      message: { stickerMessage: { mimetype: 'image/webp' } } as any,
    });
    expect(getMediaInfo(msg)).toEqual({ type: 'stickerMessage', mimetype: 'image/webp' });
  });

  it('returns empty mimetype when not set', () => {
    const msg = makeMessage({
      message: { imageMessage: {} } as any,
    });
    expect(getMediaInfo(msg)).toEqual({ type: 'imageMessage', mimetype: '' });
  });

  it('returns null for text-only messages', () => {
    const msg = makeMessage({
      message: { conversation: 'hello' } as any,
    });
    expect(getMediaInfo(msg)).toBeNull();
  });
});

describe('downloadAndSaveMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when message has no media', async () => {
    const msg = makeMessage({ message: { conversation: 'text only' } as any });
    const result = await downloadAndSaveMedia(msg, 'test-group', '/groups');
    expect(result).toBeNull();
    expect(mockDownloadMediaMessage).not.toHaveBeenCalled();
  });

  it('returns null when message has no ID', async () => {
    const msg = makeMessage({
      key: { id: undefined as any, remoteJid: 'group@g.us' },
      message: { imageMessage: { mimetype: 'image/jpeg' } } as any,
    });
    const result = await downloadAndSaveMedia(msg, 'test-group', '/groups');
    expect(result).toBeNull();
  });

  it('downloads and saves image with correct extension', async () => {
    const buffer = Buffer.from('fake-image-data');
    mockDownloadMediaMessage.mockResolvedValue(buffer);

    const msg = makeMessage({
      key: { id: 'img-001', remoteJid: 'group@g.us' },
      message: { imageMessage: { mimetype: 'image/jpeg' } } as any,
    });

    const result = await downloadAndSaveMedia(msg, 'test-group', '/groups');

    expect(result).toEqual({
      filePath: '/groups/test-group/media/img-001.jpg',
      containerPath: '/workspace/group/media/img-001.jpg',
    });
    expect(mockMkdirSync).toHaveBeenCalledWith('/groups/test-group/media', { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledWith('/groups/test-group/media/img-001.jpg', buffer);
  });

  it('uses correct extension for video/mp4', async () => {
    mockDownloadMediaMessage.mockResolvedValue(Buffer.from('video'));

    const msg = makeMessage({
      key: { id: 'vid-001', remoteJid: 'group@g.us' },
      message: { videoMessage: { mimetype: 'video/mp4' } } as any,
    });

    const result = await downloadAndSaveMedia(msg, 'my-group', '/groups');
    expect(result!.filePath).toBe('/groups/my-group/media/vid-001.mp4');
  });

  it('uses correct extension for audio/ogg opus', async () => {
    mockDownloadMediaMessage.mockResolvedValue(Buffer.from('audio'));

    const msg = makeMessage({
      key: { id: 'aud-001', remoteJid: 'group@g.us' },
      message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus' } } as any,
    });

    const result = await downloadAndSaveMedia(msg, 'my-group', '/groups');
    expect(result!.filePath).toBe('/groups/my-group/media/aud-001.ogg');
  });

  it('uses correct extension for PDF document', async () => {
    mockDownloadMediaMessage.mockResolvedValue(Buffer.from('pdf'));

    const msg = makeMessage({
      key: { id: 'doc-001', remoteJid: 'group@g.us' },
      message: { documentMessage: { mimetype: 'application/pdf' } } as any,
    });

    const result = await downloadAndSaveMedia(msg, 'my-group', '/groups');
    expect(result!.filePath).toBe('/groups/my-group/media/doc-001.pdf');
  });

  it('falls back to default extension for unknown mimetype', async () => {
    mockDownloadMediaMessage.mockResolvedValue(Buffer.from('data'));

    const msg = makeMessage({
      key: { id: 'img-002', remoteJid: 'group@g.us' },
      message: { imageMessage: { mimetype: 'image/x-custom' } } as any,
    });

    const result = await downloadAndSaveMedia(msg, 'test-group', '/groups');
    // Unknown mimetype falls back to DEFAULT_EXTENSIONS for imageMessage → 'jpg'
    expect(result!.filePath).toBe('/groups/test-group/media/img-002.jpg');
  });

  it('falls back to bin for document with unknown mimetype', async () => {
    mockDownloadMediaMessage.mockResolvedValue(Buffer.from('data'));

    const msg = makeMessage({
      key: { id: 'doc-002', remoteJid: 'group@g.us' },
      message: { documentMessage: { mimetype: 'application/x-unknown' } } as any,
    });

    const result = await downloadAndSaveMedia(msg, 'test-group', '/groups');
    expect(result!.filePath).toBe('/groups/test-group/media/doc-002.bin');
  });

  it('returns null and logs warning on download failure', async () => {
    mockDownloadMediaMessage.mockRejectedValue(new Error('Network error'));

    const msg = makeMessage({
      key: { id: 'fail-001', remoteJid: 'group@g.us' },
      message: { imageMessage: { mimetype: 'image/jpeg' } } as any,
    });

    const result = await downloadAndSaveMedia(msg, 'test-group', '/groups');
    expect(result).toBeNull();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});