import { describe, it, expect, beforeEach } from 'vitest';
import {
  allowSlashCommand,
  _resetRateLimitForTests,
} from '../src/util/slashCommandRateLimit.js';

describe('slash command rate limit', () => {
  beforeEach(() => {
    _resetRateLimitForTests();
  });

  it('allows the first refresh up to capacity (3)', () => {
    const t0 = 1_700_000_000_000;
    expect(allowSlashCommand(42, 'refresh', t0)).toBe(true);
    expect(allowSlashCommand(42, 'refresh', t0)).toBe(true);
    expect(allowSlashCommand(42, 'refresh', t0)).toBe(true);
  });

  it('blocks the 4th refresh in the same instant', () => {
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 3; i++) allowSlashCommand(42, 'refresh', t0);
    expect(allowSlashCommand(42, 'refresh', t0)).toBe(false);
  });

  it('refills at 1 token per minute for refresh', () => {
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 3; i++) allowSlashCommand(42, 'refresh', t0);
    expect(allowSlashCommand(42, 'refresh', t0)).toBe(false);
    // 1 minute later: 1 token refilled.
    expect(allowSlashCommand(42, 'refresh', t0 + 60_000)).toBe(true);
    expect(allowSlashCommand(42, 'refresh', t0 + 60_000)).toBe(false);
  });

  it('isolates buckets per (installation, command)', () => {
    const t0 = 1_700_000_000_000;
    // Drain installation 42 / refresh
    for (let i = 0; i < 3; i++) allowSlashCommand(42, 'refresh', t0);
    expect(allowSlashCommand(42, 'refresh', t0)).toBe(false);
    // Installation 99 still has full capacity for refresh.
    expect(allowSlashCommand(99, 'refresh', t0)).toBe(true);
    // Installation 42 still has full capacity for `explain` (different bucket).
    expect(allowSlashCommand(42, 'explain', t0)).toBe(true);
  });

  it('caps refills at the configured capacity (no infinite accumulation)', () => {
    const t0 = 1_700_000_000_000;
    allowSlashCommand(42, 'refresh', t0); // 2 tokens left
    // Jump forward 10 minutes — would refill 10 tokens, but capacity is 3.
    // After this call (consuming 1), we should have at most 2 left.
    expect(allowSlashCommand(42, 'refresh', t0 + 10 * 60_000)).toBe(true);
    expect(allowSlashCommand(42, 'refresh', t0 + 10 * 60_000)).toBe(true);
    expect(allowSlashCommand(42, 'refresh', t0 + 10 * 60_000)).toBe(true);
    expect(allowSlashCommand(42, 'refresh', t0 + 10 * 60_000)).toBe(false);
  });

  it('uses a generous bucket for explain (capacity 10)', () => {
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 10; i++) {
      expect(allowSlashCommand(7, 'explain', t0)).toBe(true);
    }
    expect(allowSlashCommand(7, 'explain', t0)).toBe(false);
  });
});
