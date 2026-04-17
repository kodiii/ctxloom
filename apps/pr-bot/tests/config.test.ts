import { describe, it, expect } from 'vitest';
import { parseRepoConfig, DEFAULT_CONFIG } from '../src/config.js';

describe('parseRepoConfig', () => {
  it('parses valid YAML-derived object and applies defaults', () => {
    const result = parseRepoConfig({ risk_threshold: 0.5, inline_comments: false });
    expect(result.risk_threshold).toBe(0.5);
    expect(result.inline_comments).toBe(false);
    // defaults applied for missing keys
    expect(result.suggested_reviewers).toBe(true);
    expect(result.check_run).toBe(false);
    expect(result.excluded_paths).toEqual([]);
    expect(result.max_inline_per_pr).toBe(10);
  });

  it('rejects unknown keys (strict schema)', () => {
    expect(() => parseRepoConfig({ unknown_key: true })).toThrow();
  });

  it('returns all defaults when config is missing (undefined)', () => {
    const result = parseRepoConfig(undefined);
    expect(result).toEqual(DEFAULT_CONFIG);
    expect(result.risk_threshold).toBe(0.7);
    expect(result.inline_comments).toBe(true);
    expect(result.suggested_reviewers).toBe(true);
    expect(result.check_run).toBe(false);
    expect(result.excluded_paths).toEqual([]);
    expect(result.max_inline_per_pr).toBe(10);
  });

  it('returns all defaults when config is null', () => {
    const result = parseRepoConfig(null);
    expect(result).toEqual(DEFAULT_CONFIG);
  });

  it('rejects risk_threshold: 1.5 (out of range)', () => {
    expect(() => parseRepoConfig({ risk_threshold: 1.5 })).toThrow();
  });

  it('rejects risk_threshold: -0.1 (out of range)', () => {
    expect(() => parseRepoConfig({ risk_threshold: -0.1 })).toThrow();
  });
});
