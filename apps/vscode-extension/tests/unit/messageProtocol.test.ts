import { describe, it, expect } from 'vitest';
import { parseHostMessage, parseWebviewMessage, type HostToWebview, type WebviewToHost } from '../../src/settings/messageProtocol.js';

describe('messageProtocol', () => {
  it('parses a valid Host→Webview state message', () => {
    const msg: HostToWebview = { kind: 'state', state: { license: { kind: 'NO_LICENSE' }, settings: { 'features.hover': true } } };
    const parsed = parseHostMessage(msg);
    expect(parsed?.kind).toBe('state');
  });

  it('parses a valid Webview→Host setSetting message', () => {
    const msg: WebviewToHost = { kind: 'setSetting', key: 'features.hover', value: false };
    const parsed = parseWebviewMessage(msg);
    expect(parsed?.kind).toBe('setSetting');
    if (parsed?.kind === 'setSetting') {
      expect(parsed.key).toBe('features.hover');
      expect(parsed.value).toBe(false);
    }
  });

  it('parses a valid Webview→Host activateLicense message', () => {
    const msg: WebviewToHost = { kind: 'activateLicense', key: 'KEY-1234' };
    const parsed = parseWebviewMessage(msg);
    expect(parsed?.kind).toBe('activateLicense');
  });

  it('parses a valid Webview→Host startTrial message', () => {
    const msg: WebviewToHost = { kind: 'startTrial', email: 'me@example.com' };
    const parsed = parseWebviewMessage(msg);
    expect(parsed?.kind).toBe('startTrial');
  });

  it('rejects an unknown Host→Webview kind', () => {
    expect(parseHostMessage({ kind: 'unknown' })).toBeNull();
  });

  it('rejects an unknown Webview→Host kind', () => {
    expect(parseWebviewMessage({ kind: 'haxx0r' })).toBeNull();
  });

  it('rejects messages missing required fields', () => {
    expect(parseWebviewMessage({ kind: 'setSetting' })).toBeNull();
    expect(parseWebviewMessage({ kind: 'startTrial' })).toBeNull();
  });
});
