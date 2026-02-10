import { describe, it, expect } from 'vitest';
import { normalizeJid } from './utils.js';

describe('normalizeJid', () => {
  it('strips LID-style :N suffix from local part', () => {
    expect(normalizeJid('17252273945:4@s.whatsapp.net')).toBe('17252273945@s.whatsapp.net');
  });

  it('preserves JID without suffix', () => {
    expect(normalizeJid('19719980254@s.whatsapp.net')).toBe('19719980254@s.whatsapp.net');
  });

  it('handles LID domain JIDs', () => {
    expect(normalizeJid('59790273302580@lid')).toBe('59790273302580@lid');
  });

  it('handles LID JID with :N suffix', () => {
    expect(normalizeJid('59790273302580:4@lid')).toBe('59790273302580@lid');
  });

  it('handles bare JID without domain', () => {
    expect(normalizeJid('19719980254')).toBe('19719980254');
  });

  it('DOES NOT translate LID to phone — that is translateJid responsibility', () => {
    // normalizeJid only strips :N suffix, it does NOT convert LID→phone
    // This is critical: authorization depends on phone JIDs matching the registry
    // If a LID JID reaches canInvoke without translation, it will be "stranger"
    const lidJid = '59790273302580@lid';
    const phoneJid = '19719980254@s.whatsapp.net';
    expect(normalizeJid(lidJid)).not.toBe(phoneJid);
  });
});
