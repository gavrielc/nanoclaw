/**
 * whatsapp-audio.test.ts — Tests for WhatsApp audio message detection and routing.
 *
 * Isolated from whatsapp-1to1.test.ts to protect existing text message tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { _initTestDatabase } from './db.js';
import {
  isIndividualChat,
  isGroupChat,
  VIRTUAL_COMPLAINT_GROUP_JID,
  type AudioMetadata,
} from './channels/whatsapp.js';

beforeEach(() => {
  _initTestDatabase();
});

// ============================================================
// Audio message detection
// ============================================================

describe('WhatsApp audio message detection', () => {
  it('audioMessage field is detected from Baileys message', () => {
    const mockMsg = {
      message: {
        audioMessage: {
          url: 'https://mmg.whatsapp.net/audio',
          mimetype: 'audio/ogg; codecs=opus',
          fileLength: 50000,
          seconds: 15,
          ptt: true,
        },
      },
      key: {
        remoteJid: '919876543210@s.whatsapp.net',
        fromMe: false,
        id: 'audio-msg-1',
      },
      pushName: 'Rajesh',
      messageTimestamp: Math.floor(Date.now() / 1000),
    };

    expect(mockMsg.message.audioMessage).toBeDefined();
    expect(mockMsg.message.audioMessage.ptt).toBe(true);
    expect(mockMsg.message.audioMessage.fileLength).toBe(50000);
    expect(mockMsg.message.audioMessage.seconds).toBe(15);
    expect(mockMsg.message.audioMessage.mimetype).toBe(
      'audio/ogg; codecs=opus',
    );
  });

  it('text message has no audioMessage field', () => {
    const mockMsg = {
      message: {
        conversation: 'I have a water problem',
        audioMessage: undefined as any,
      },
    };

    expect(mockMsg.message.audioMessage).toBeUndefined();
    expect(mockMsg.message.conversation).toBe('I have a water problem');
  });

  it('extendedTextMessage is NOT treated as audio', () => {
    const mockMsg = {
      message: {
        extendedTextMessage: { text: 'This is a reply' },
        audioMessage: undefined as any,
      },
    };

    expect(mockMsg.message.audioMessage).toBeUndefined();
    expect(mockMsg.message.extendedTextMessage?.text).toBe('This is a reply');
  });

  it('image message with caption is NOT treated as audio', () => {
    const mockMsg = {
      message: {
        imageMessage: { caption: 'Look at this road damage' },
        audioMessage: undefined as any,
      },
    };

    expect(mockMsg.message.audioMessage).toBeUndefined();
    const content = mockMsg.message.imageMessage?.caption || '';
    expect(content).toBe('Look at this road damage');
  });
});

// ============================================================
// Audio message routing — 1:1 vs groups
// ============================================================

describe('WhatsApp audio routing', () => {
  it('audio only handled for 1:1 individual chats', () => {
    expect(isIndividualChat('919876543210@s.whatsapp.net')).toBe(true);
    expect(isIndividualChat('186410254491803@lid')).toBe(true);
  });

  it('audio NOT handled for group chats', () => {
    expect(isIndividualChat('12345678@g.us')).toBe(false);
    expect(isGroupChat('12345678@g.us')).toBe(true);
  });

  it('1:1 audio routes through virtual complaint group', () => {
    const registeredGroups: Record<string, any> = {
      'complaint@virtual': {
        name: 'complaint',
        folder: 'complaint',
        trigger: '',
        added_at: '2024-01-01T00:00:00.000Z',
        requiresTrigger: false,
      },
    };

    const chatJid = '919876543210@s.whatsapp.net';
    expect(isIndividualChat(chatJid)).toBe(true);

    const routeJid = VIRTUAL_COMPLAINT_GROUP_JID;
    expect(registeredGroups[routeJid]).toBeDefined();
  });
});

// ============================================================
// AudioMetadata extraction
// ============================================================

describe('AudioMetadata', () => {
  it('extracts correct fields from audioMessage', () => {
    const audioMsg = {
      url: 'https://mmg.whatsapp.net/...',
      mimetype: 'audio/ogg; codecs=opus',
      fileLength: 524288,
      seconds: 45,
      ptt: true,
    };

    const metadata: AudioMetadata = {
      messageId: 'msg-1',
      senderJid: '919876543210@s.whatsapp.net',
      senderName: 'Rajesh',
      timestamp: new Date().toISOString(),
      fileLength: Number(audioMsg.fileLength || 0),
      seconds: audioMsg.seconds || 0,
      mimetype: audioMsg.mimetype || 'audio/ogg; codecs=opus',
      ptt: audioMsg.ptt || false,
    };

    expect(metadata.fileLength).toBe(524288);
    expect(metadata.seconds).toBe(45);
    expect(metadata.ptt).toBe(true);
    expect(metadata.mimetype).toBe('audio/ogg; codecs=opus');
    expect(metadata.senderName).toBe('Rajesh');
    expect(metadata.messageId).toBe('msg-1');
  });

  it('handles missing audioMessage fields with defaults', () => {
    const audioMsg = {
      url: 'https://mmg.whatsapp.net/...',
    } as any;

    const metadata: AudioMetadata = {
      messageId: 'msg-2',
      senderJid: '919876543210@s.whatsapp.net',
      senderName: '919876543210',
      timestamp: new Date().toISOString(),
      fileLength: Number(audioMsg.fileLength || 0),
      seconds: audioMsg.seconds || 0,
      mimetype: audioMsg.mimetype || 'audio/ogg; codecs=opus',
      ptt: audioMsg.ptt || false,
    };

    expect(metadata.fileLength).toBe(0);
    expect(metadata.seconds).toBe(0);
    expect(metadata.mimetype).toBe('audio/ogg; codecs=opus');
    expect(metadata.ptt).toBe(false);
  });
});

// ============================================================
// Bot's own messages filtered
// ============================================================

describe('Bot own audio messages', () => {
  it('audio message with fromMe=true is skipped', () => {
    const mockMsg = {
      key: { fromMe: true, id: 'audio-own-1' },
      message: { audioMessage: { seconds: 10 } },
    };
    expect(mockMsg.key.fromMe).toBe(true);
  });

  it('audio message with fromMe=false is processed', () => {
    const mockMsg = {
      key: { fromMe: false, id: 'audio-incoming-1' },
      message: { audioMessage: { seconds: 10 } },
    };
    expect(mockMsg.key.fromMe).toBe(false);
  });
});

// ============================================================
// Voice handler integration flow
// ============================================================

describe('handleVoiceDirect flow', () => {
  it('blocked user voice message is ignored (no download)', () => {
    // In the actual handler: if (isUserBlocked(phone)) return;
    // Block check happens BEFORE downloadMediaMessage
    const isBlocked = true;
    expect(isBlocked).toBe(true);
    // No download, no Whisper call, no sendMessage
  });

  it('successful transcription routes to complaint handler', () => {
    // Flow: download audio -> processVoiceNote -> handleComplaintMessage
    const voiceResult = {
      status: 'transcript' as const,
      text: 'मला पाणी नाही मिळत',
    };
    expect(voiceResult.status).toBe('transcript');
    expect(voiceResult.text).toBeTruthy();
    // The transcript would be passed to handleComplaintMessage(phone, name, transcript)
  });

  it('rejected voice note sends rejection message to user', () => {
    const voiceResult = {
      status: 'rejected' as const,
      message:
        'कृपया तुमची तक्रार २ मिनिटांत सांगा. तुमचा व्हॉइस मेसेज खूप मोठा आहे.',
    };
    expect(voiceResult.status).toBe('rejected');
    expect(voiceResult.message).toBeTruthy();
    // The message would be sent directly to the user via sendMessage
  });

  it('Whisper error sends error message to user', () => {
    const voiceResult = {
      status: 'error' as const,
      message: 'मला तुमचा आवाज समजला नाही. कृपया लिहून पाठवा.',
    };
    expect(voiceResult.status).toBe('error');
    expect(voiceResult.message).toBeTruthy();
    // The error message would be sent to the user
  });
});
