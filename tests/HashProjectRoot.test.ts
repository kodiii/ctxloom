import { describe, it, expect } from 'vitest';
import { hashProjectRoot } from '@ctxloom/core';

describe('hashProjectRoot', () => {
  it('returns a 16-character lowercase hex string', () => {
    const hash = hashProjectRoot('/Users/foo/project');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('produces the same hash for the same path', () => {
    expect(hashProjectRoot('/Users/foo/project')).toBe(hashProjectRoot('/Users/foo/project'));
  });

  it('produces different hashes for different paths', () => {
    expect(hashProjectRoot('/Users/foo/projectA')).not.toBe(hashProjectRoot('/Users/foo/projectB'));
  });

  it('normalizes trailing slashes', () => {
    expect(hashProjectRoot('/Users/foo/project/')).toBe(hashProjectRoot('/Users/foo/project'));
  });

  it('normalizes relative segments via path.resolve', () => {
    expect(hashProjectRoot('/Users/foo/project/./')).toBe(hashProjectRoot('/Users/foo/project'));
  });
});
