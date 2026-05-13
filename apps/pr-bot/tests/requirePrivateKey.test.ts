import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { requirePrivateKey } from '../src/auth/installation.js';

const SAMPLE_PEM =
  '-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0B...\n-----END PRIVATE KEY-----';

describe('requirePrivateKey', () => {
  let originalKey: string | undefined;
  let originalFlag: string | undefined;

  beforeEach(() => {
    originalKey = process.env['PRIVATE_KEY'];
    originalFlag = process.env['PRIVATE_KEY_BASE64'];
    delete process.env['PRIVATE_KEY'];
    delete process.env['PRIVATE_KEY_BASE64'];
  });

  afterEach(() => {
    if (originalKey !== undefined) process.env['PRIVATE_KEY'] = originalKey;
    else delete process.env['PRIVATE_KEY'];
    if (originalFlag !== undefined) process.env['PRIVATE_KEY_BASE64'] = originalFlag;
    else delete process.env['PRIVATE_KEY_BASE64'];
  });

  it('throws when PRIVATE_KEY is unset', () => {
    expect(() => requirePrivateKey()).toThrow(/PRIVATE_KEY environment variable is required/);
  });

  it('throws when PRIVATE_KEY is whitespace only', () => {
    process.env['PRIVATE_KEY'] = '   \n\t  ';
    expect(() => requirePrivateKey()).toThrow(/PRIVATE_KEY environment variable is required/);
  });

  it('accepts a raw PEM and returns it normalized', () => {
    process.env['PRIVATE_KEY'] = `\n  ${SAMPLE_PEM}  \n`;
    expect(requirePrivateKey()).toBe(SAMPLE_PEM);
    expect(process.env['PRIVATE_KEY']).toBe(SAMPLE_PEM);
  });

  it('accepts BEGIN RSA PRIVATE KEY headers (legacy GitHub Apps)', () => {
    const rsaPem = SAMPLE_PEM.replace('PRIVATE KEY', 'RSA PRIVATE KEY');
    process.env['PRIVATE_KEY'] = rsaPem;
    expect(requirePrivateKey()).toBe(rsaPem);
  });

  it('rejects PEM when PRIVATE_KEY_BASE64=1 is also set', () => {
    process.env['PRIVATE_KEY'] = SAMPLE_PEM;
    process.env['PRIVATE_KEY_BASE64'] = '1';
    expect(() => requirePrivateKey()).toThrow(/PRIVATE_KEY_BASE64=1 is set but PRIVATE_KEY is already a raw PEM/);
  });

  it('decodes base64 when PRIVATE_KEY_BASE64=1 is set', () => {
    const b64 = Buffer.from(SAMPLE_PEM, 'utf8').toString('base64');
    process.env['PRIVATE_KEY'] = b64;
    process.env['PRIVATE_KEY_BASE64'] = '1';
    expect(requirePrivateKey()).toBe(SAMPLE_PEM);
    expect(process.env['PRIVATE_KEY']).toBe(SAMPLE_PEM);
  });

  it('rejects base64 that decodes to non-PEM content', () => {
    process.env['PRIVATE_KEY'] = Buffer.from('not a pem key', 'utf8').toString('base64');
    process.env['PRIVATE_KEY_BASE64'] = '1';
    expect(() => requirePrivateKey()).toThrow(/result is not a PEM key/);
  });

  it('rejects base64 with characters outside the alphabet', () => {
    process.env['PRIVATE_KEY'] = 'AAAA*BBBB';
    process.env['PRIVATE_KEY_BASE64'] = '1';
    expect(() => requirePrivateKey()).toThrow(/outside the base64 alphabet/);
  });

  it('rejects ambiguous base64 input without the explicit opt-in flag', () => {
    const b64 = Buffer.from(SAMPLE_PEM, 'utf8').toString('base64');
    process.env['PRIVATE_KEY'] = b64;
    expect(() => requirePrivateKey()).toThrow(/PRIVATE_KEY_BASE64=1 is not set/);
  });

  it('rejects garbage that is neither PEM nor base64', () => {
    // Contains `!` which is not in the base64 alphabet, so we should fall
    // through to the final catch-all branch.
    process.env['PRIVATE_KEY'] = 'not a key!!';
    expect(() => requirePrivateKey()).toThrow(/neither a recognizable PEM nor a clean base64/);
  });
});
