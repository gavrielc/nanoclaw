import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger before importing modules that use it
vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock config before importing modules that use it
vi.mock('./config.js', () => ({
  DATA_DIR: '/tmp/nanoclaw-test-data',
  MOUNT_ALLOWLIST_PATH: '/tmp/nanoclaw-test-allowlist.json',
}));

// Mock fs to control user registry loading
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
    },
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import fs from 'fs';
import { canInvoke, determineAgentContext, hasStrangers, clearStrangerCache } from './authorization.js';
import { invalidateRegistryCache } from './user-registry.js';
import type { UserRegistry } from './types.js';

const OWNER_PHONE_JID = '19719980254@s.whatsapp.net';
const OWNER_LID_JID = '59790273302580@lid';
const FAMILY_PHONE_JID = '15551234567@s.whatsapp.net';
const STRANGER_JID = '19999999999@s.whatsapp.net';

const testRegistry: UserRegistry = {
  owner: { jid: OWNER_PHONE_JID, name: 'Owner', addedAt: '2024-01-01T00:00:00Z' },
  family: [{ jid: FAMILY_PHONE_JID, name: 'Family Member', addedAt: '2024-01-01T00:00:00Z' }],
  friend: [{ jid: '15559876543@s.whatsapp.net', name: 'Friend', addedAt: '2024-01-01T00:00:00Z' }],
};

function setupRegistry(registry: UserRegistry = testRegistry) {
  invalidateRegistryCache();
  clearStrangerCache();
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(registry));
}

describe('canInvoke', () => {
  beforeEach(() => {
    setupRegistry();
  });

  it('owner phone JID can invoke', () => {
    const result = canInvoke(OWNER_PHONE_JID, false);
    expect(result.canInvoke).toBe(true);
    expect(result.tier).toBe('owner');
  });

  it('owner phone JID with :N suffix can invoke', () => {
    const result = canInvoke('19719980254:4@s.whatsapp.net', false);
    expect(result.canInvoke).toBe(true);
    expect(result.tier).toBe('owner');
  });

  it('family member can invoke', () => {
    const result = canInvoke(FAMILY_PHONE_JID, false);
    expect(result.canInvoke).toBe(true);
    expect(result.tier).toBe('family');
  });

  it('friend cannot invoke', () => {
    const result = canInvoke('15559876543@s.whatsapp.net', false);
    expect(result.canInvoke).toBe(false);
    expect(result.tier).toBe('friend');
  });

  it('stranger cannot invoke', () => {
    const result = canInvoke(STRANGER_JID, false);
    expect(result.canInvoke).toBe(false);
    expect(result.tier).toBe('stranger');
  });

  // THE CRITICAL TEST: LID JIDs must be translated BEFORE reaching canInvoke
  // canInvoke does normalizeJid (strips :N suffix) but does NOT translate LID→phone
  // So if a LID JID reaches canInvoke, it will always be "stranger"
  it('LID JID without translation is treated as stranger — translateJid must be called first', () => {
    const result = canInvoke(OWNER_LID_JID, false);
    // This SHOULD be stranger because canInvoke only normalizes, doesn't translate
    // The fix is to translate BEFORE calling canInvoke
    expect(result.canInvoke).toBe(false);
    expect(result.tier).toBe('stranger');
  });

  // This test documents the correct flow: translate first, then authorize
  it('phone JID (after translation from LID) is recognized as owner', () => {
    // Simulates: translateJid('59790273302580@lid') -> '19719980254@s.whatsapp.net'
    // Then canInvoke gets the phone JID
    const translatedJid = OWNER_PHONE_JID; // This is what translateJid would return
    const result = canInvoke(translatedJid, false);
    expect(result.canInvoke).toBe(true);
    expect(result.tier).toBe('owner');
  });
});

describe('determineAgentContext', () => {
  it('owner sender gets owner context', () => {
    expect(determineAgentContext('owner')).toBe('owner');
  });

  it('family sender gets family context', () => {
    expect(determineAgentContext('family')).toBe('family');
  });

  it('friend sender gets friend context', () => {
    expect(determineAgentContext('friend')).toBe('friend');
  });

  it('stranger sender gets friend context (most restrictive)', () => {
    expect(determineAgentContext('stranger')).toBe('friend');
  });

  it('group context tier constrains by sender — family sender cannot get owner context', () => {
    expect(determineAgentContext('family', 'owner')).toBe('family');
  });

  it('group context tier constrains by sender — owner sender can get owner context', () => {
    expect(determineAgentContext('owner', 'owner')).toBe('owner');
  });

  it('group context tier further restricts — owner sender in friend group gets friend context', () => {
    expect(determineAgentContext('owner', 'friend')).toBe('friend');
  });
});

describe('hasStrangers', () => {
  beforeEach(() => {
    setupRegistry();
  });

  it('returns false when all participants are registered', () => {
    const result = hasStrangers('group@g.us', [OWNER_PHONE_JID, FAMILY_PHONE_JID]);
    expect(result).toBe(false);
  });

  it('returns true when group has unregistered participants', () => {
    const result = hasStrangers('group@g.us', [OWNER_PHONE_JID, STRANGER_JID]);
    expect(result).toBe(true);
  });
});
