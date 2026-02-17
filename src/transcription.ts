import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { WAMessage, WASocket } from '@whiskeysockets/baileys';

import { logger } from './logger.js';

// Transcribe audio using OpenAI Whisper API
async function transcribeWithOpenAI(audioBuffer: Buffer): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.warn('OPENAI_API_KEY not set, voice transcription unavailable');
    return null;
  }

  try {
    const openaiModule = await import('openai');
    const OpenAI = openaiModule.default;
    const toFile = openaiModule.toFile;

    const openai = new OpenAI({ apiKey });

    const file = await toFile(audioBuffer, 'voice.ogg', {
      type: 'audio/ogg',
    });

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      response_format: 'text',
    });

    // OpenAI returns plain string when response_format is 'text'
    return transcription as unknown as string;
  } catch (err) {
    logger.error({ err }, 'OpenAI transcription failed');
    return null;
  }
}

/**
 * Transcribe a WhatsApp voice message to text.
 * Downloads the audio from WhatsApp servers and sends it to OpenAI Whisper.
 */
export async function transcribeAudioMessage(
  msg: WAMessage,
  sock: WASocket,
): Promise<string | null> {
  try {
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
      logger.error('Failed to download audio message');
      return null;
    }

    logger.info({ bytes: buffer.length }, 'Downloaded audio message');

    const transcript = await transcribeWithOpenAI(buffer);
    return transcript?.trim() || null;
  } catch (err) {
    logger.error({ err }, 'Transcription error');
    return null;
  }
}

/** Check if a message is a voice note (ptt = push to talk) */
export function isVoiceMessage(msg: WAMessage): boolean {
  return msg.message?.audioMessage?.ptt === true;
}
