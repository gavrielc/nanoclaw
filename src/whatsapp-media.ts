import fs from 'fs';
import path from 'path';

import { downloadMediaMessage, type WAMessage } from '@whiskeysockets/baileys';

import { logger } from './logger.js';

export interface MediaInfo {
  type: string;
  mimetype: string;
}

export interface MediaResult {
  filePath: string;
  containerPath: string;
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'audio/ogg': 'ogg',
  'audio/ogg; codecs=opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

const MEDIA_MESSAGE_KEYS = [
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'documentMessage',
  'stickerMessage',
] as const;

const DEFAULT_EXTENSIONS: Record<string, string> = {
  imageMessage: 'jpg',
  videoMessage: 'mp4',
  audioMessage: 'ogg',
  documentMessage: 'bin',
  stickerMessage: 'webp',
};

export function getMediaInfo(msg: WAMessage): MediaInfo | null {
  if (!msg.message) return null;

  for (const key of MEDIA_MESSAGE_KEYS) {
    const mediaMsg = msg.message[key];
    if (mediaMsg) {
      return {
        type: key,
        mimetype: (mediaMsg as { mimetype?: string }).mimetype || '',
      };
    }
  }

  return null;
}

export async function downloadAndSaveMedia(
  msg: WAMessage,
  groupFolder: string,
  groupsDir: string,
): Promise<MediaResult | null> {
  const info = getMediaInfo(msg);
  if (!info) return null;

  const msgId = msg.key.id;
  if (!msgId) return null;

  try {
    const buffer = await downloadMediaMessage(msg, 'buffer', {});

    const ext =
      MIME_TO_EXT[info.mimetype] || DEFAULT_EXTENSIONS[info.type] || 'bin';
    const filename = `${msgId}.${ext}`;

    const mediaDir = path.join(groupsDir, groupFolder, 'media');
    fs.mkdirSync(mediaDir, { recursive: true });

    const filePath = path.join(mediaDir, filename);
    fs.writeFileSync(filePath, buffer as Buffer);

    const containerPath = `/workspace/group/media/${filename}`;

    logger.info(
      { msgId, type: info.type, size: (buffer as Buffer).length },
      'Media downloaded',
    );

    return { filePath, containerPath };
  } catch (err) {
    logger.warn({ msgId, type: info.type, err }, 'Failed to download media');
    return null;
  }
}
