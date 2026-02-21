import { downloadMediaMessage } from '@whiskeysockets/baileys';
import type { WAMessage, WASocket } from '@whiskeysockets/baileys';
import { logger } from './logger.js';
import type { ContentBlock, ImageSource, DocumentSource } from './types.js';

// Detector functions
export function isImageMessage(msg: WAMessage): boolean {
  return msg.message?.imageMessage != null;
}

export function isPdfDocument(msg: WAMessage): boolean {
  return (
    msg.message?.documentMessage != null &&
    msg.message.documentMessage.mimetype === 'application/pdf'
  );
}

// Image processing
export async function processImageMessage(
  msg: WAMessage,
  sock: WASocket,
): Promise<ContentBlock[] | null> {
  try {
    logger.info({
      chatJid: msg.key.remoteJid,
      hasImageMessage: !!msg.message?.imageMessage,
      hasMimetype: !!msg.message?.imageMessage?.mimetype,
      hasUrl: !!msg.message?.imageMessage?.url,
      hasMediaKey: !!msg.message?.imageMessage?.mediaKey
    }, 'Attempting to download image - message details');

    const buffer = (await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger: console as any,
        reuploadRequest: sock.updateMediaMessage,
      },
    )) as Buffer;

    if (!buffer || buffer.length === 0) {
      logger.warn({ chatJid: msg.key.remoteJid }, 'Empty image buffer received - download failed, returning caption only');

      // Even if download fails, extract caption and metadata
      const caption = msg.message?.imageMessage?.caption || '';
      const mimeType = msg.message?.imageMessage?.mimetype || 'unknown';
      const width = msg.message?.imageMessage?.width;
      const height = msg.message?.imageMessage?.height;

      if (caption) {
        // Return caption as text so user gets some information
        return [{
          type: 'text',
          text: `📷 Image (download failed - Baileys limitation)\nCaption: ${caption}\nType: ${mimeType}${width && height ? `\nSize: ${width}x${height}` : ''}`
        }];
      }

      // No caption, return null to show generic message
      return null;
    }

    const base64 = buffer.toString('base64');
    const mimeType = msg.message?.imageMessage?.mimetype || 'image/jpeg';
    const caption = msg.message?.imageMessage?.caption || '';

    // Sanitize MIME type to match Claude's expected types
    const mediaType = mimeType.includes('png') ? 'image/png'
      : mimeType.includes('gif') ? 'image/gif'
      : mimeType.includes('webp') ? 'image/webp'
      : 'image/jpeg';

    const blocks: ContentBlock[] = [];

    // Add caption as text block if present
    if (caption) {
      blocks.push({ type: 'text', text: caption });
    }

    // Add image block
    blocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: base64,
      } as ImageSource,
    });

    logger.info(
      {
        chatJid: msg.key.remoteJid,
        sizeKB: Math.round(buffer.length / 1024),
        mediaType,
        hasCaption: !!caption,
      },
      'Processed image message'
    );

    return blocks;
  } catch (err) {
    logger.error({
      err,
      chatJid: msg.key.remoteJid,
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack : undefined
    }, 'Image processing error - download or conversion failed');
    return null;
  }
}

// PDF processing
export async function processPdfDocument(
  msg: WAMessage,
  sock: WASocket,
): Promise<ContentBlock[] | null> {
  try {
    logger.info({ chatJid: msg.key.remoteJid }, 'Attempting to download PDF');

    const buffer = (await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger: console as any,
        reuploadRequest: sock.updateMediaMessage,
      },
    )) as Buffer;

    if (!buffer || buffer.length === 0) {
      logger.warn({ chatJid: msg.key.remoteJid }, 'Empty PDF buffer received - download failed, returning metadata only');

      // Even if download fails, extract caption and metadata
      const caption = msg.message?.documentMessage?.caption || '';
      const filename = msg.message?.documentMessage?.fileName || 'document.pdf';
      const pageCount = msg.message?.documentMessage?.pageCount;
      const fileSize = msg.message?.documentMessage?.fileLength;

      if (caption || filename !== 'document.pdf') {
        // Return metadata as text so user gets some information
        const sizeText = fileSize && typeof fileSize === 'number' ? `\nSize: ${Math.round(fileSize / 1024)}KB` : '';
        return [{
          type: 'text',
          text: `📄 PDF Document (download failed - Baileys limitation)\nFilename: ${filename}${caption ? `\nCaption: ${caption}` : ''}${pageCount ? `\nPages: ${pageCount}` : ''}${sizeText}`
        }];
      }

      // No useful metadata, return null
      return null;
    }

    const base64 = buffer.toString('base64');
    const caption = msg.message?.documentMessage?.caption || '';
    const filename = msg.message?.documentMessage?.fileName || 'document.pdf';

    const blocks: ContentBlock[] = [];

    // Add caption/filename as text block
    const textContent = caption || `[PDF: ${filename}]`;
    blocks.push({ type: 'text', text: textContent });

    // Add PDF document block
    blocks.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: base64,
      } as DocumentSource,
    });

    logger.info(
      {
        chatJid: msg.key.remoteJid,
        sizeKB: Math.round(buffer.length / 1024),
        filename,
        hasCaption: !!caption,
      },
      'Processed PDF document'
    );

    return blocks;
  } catch (err) {
    logger.error({
      err,
      chatJid: msg.key.remoteJid,
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack : undefined
    }, 'PDF processing error - download or conversion failed');
    return null;
  }
}
