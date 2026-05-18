/**
 * Tests for packages/core/src/install/hmacBlock.ts — Phase 2a of the
 * agent-harness plan. Pins:
 *
 *   - HMAC determinism (same content + key → same digest)
 *   - Block wrap/extract round-trip preserves content
 *   - Tampering detection (content drift fails verifyBlock)
 *   - upsertBlock preserves user content outside the markers
 *   - Env-var override (CTXLOOM_INSTALL_KEY) changes the signature
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  computeBlockHmac,
  wrapBlock,
  extractBlock,
  verifyBlock,
  upsertBlock,
  resolveHmacKey,
  DEFAULT_HMAC_KEY,
} from '../packages/core/src/install/hmacBlock.js';

const ORIGINAL_KEY_ENV = process.env.CTXLOOM_INSTALL_KEY;
beforeEach(() => {
  delete process.env.CTXLOOM_INSTALL_KEY;
});
afterEach(() => {
  if (ORIGINAL_KEY_ENV === undefined) delete process.env.CTXLOOM_INSTALL_KEY;
  else process.env.CTXLOOM_INSTALL_KEY = ORIGINAL_KEY_ENV;
});

describe('resolveHmacKey', () => {
  it('returns the published default when env unset', () => {
    expect(resolveHmacKey()).toBe(DEFAULT_HMAC_KEY);
  });
  it('honors CTXLOOM_INSTALL_KEY override', () => {
    process.env.CTXLOOM_INSTALL_KEY = 'custom-key';
    expect(resolveHmacKey()).toBe('custom-key');
  });
});

describe('computeBlockHmac', () => {
  it('returns a 64-char hex string', () => {
    const h = computeBlockHmac('hello');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
  it('is deterministic for the same content + key', () => {
    expect(computeBlockHmac('hello')).toBe(computeBlockHmac('hello'));
  });
  it('differs when content changes', () => {
    expect(computeBlockHmac('hello')).not.toBe(computeBlockHmac('hello!'));
  });
  it('differs when key changes', () => {
    expect(computeBlockHmac('hello', 'key1')).not.toBe(computeBlockHmac('hello', 'key2'));
  });
});

describe('wrapBlock / extractBlock round-trip', () => {
  it('round-trips inner content verbatim', () => {
    const content = 'line 1\nline 2\nline 3';
    const wrapped = wrapBlock('TEST', content);
    const extracted = extractBlock(wrapped, 'TEST');
    expect(extracted).not.toBeNull();
    expect(extracted!.content).toBe(content);
  });
  it('preserves the declared HMAC', () => {
    const content = 'hello world';
    const wrapped = wrapBlock('TEST', content);
    const extracted = extractBlock(wrapped, 'TEST')!;
    expect(extracted.declaredHmac).toBe(computeBlockHmac(content));
  });
  it('returns null when no block is present', () => {
    expect(extractBlock('some content with no block', 'TEST')).toBeNull();
  });
  it('returns null when start marker is missing', () => {
    const text = 'no start\n<!-- END TEST -->';
    expect(extractBlock(text, 'TEST')).toBeNull();
  });
  it('returns null when end marker is missing', () => {
    const text =
      '<!-- BEGIN TEST v:1 hmac:sha256:' + 'a'.repeat(64) + ' -->\nbody\nno end';
    expect(extractBlock(text, 'TEST')).toBeNull();
  });
});

describe('verifyBlock', () => {
  it('returns true for a fresh block', () => {
    const wrapped = wrapBlock('TEST', 'canonical content');
    const block = extractBlock(wrapped, 'TEST')!;
    expect(verifyBlock(block)).toBe(true);
  });
  it('returns false when content has been tampered with', () => {
    const wrapped = wrapBlock('TEST', 'canonical content');
    // Simulate a hand-edit — block content modified, declared HMAC unchanged.
    const tampered = wrapped.replace('canonical content', 'hand-edited content');
    const block = extractBlock(tampered, 'TEST')!;
    expect(verifyBlock(block)).toBe(false);
  });
});

describe('upsertBlock', () => {
  it('appends a new block when the file has no existing block', () => {
    const out = upsertBlock('existing user content\n', 'TEST', 'new block');
    expect(out).toContain('existing user content');
    expect(out).toContain('<!-- BEGIN TEST');
    expect(out).toContain('new block');
    expect(out).toContain('<!-- END TEST -->');
  });
  it('replaces only the block, preserving user content around it', () => {
    const initial = upsertBlock(
      'PREFACE TEXT\n\n--- separator ---\n',
      'TEST',
      'v1 content',
    );
    expect(initial).toContain('PREFACE TEXT');
    const updated = upsertBlock(initial, 'TEST', 'v2 content');
    expect(updated).toContain('PREFACE TEXT');
    expect(updated).toContain('v2 content');
    expect(updated).not.toContain('v1 content');
    // The "separator" line is still there:
    expect(updated).toContain('--- separator ---');
  });
  it('idempotent — re-running with identical content does not duplicate', () => {
    const initial = upsertBlock('', 'TEST', 'content');
    const again = upsertBlock(initial, 'TEST', 'content');
    // Same number of markers
    expect((again.match(/BEGIN TEST/g) ?? []).length).toBe(1);
    expect((again.match(/END TEST/g) ?? []).length).toBe(1);
  });
  it('updating bumps the HMAC to match the new content', () => {
    const first = upsertBlock('', 'TEST', 'first');
    const second = upsertBlock(first, 'TEST', 'second');
    const block = extractBlock(second, 'TEST')!;
    expect(block.content).toBe('second');
    expect(verifyBlock(block)).toBe(true);
    expect(block.declaredHmac).toBe(computeBlockHmac('second'));
  });
});
