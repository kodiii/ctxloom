import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LicenseGate, type LicenseInfo } from '../../src/license/LicenseGate.js';

function info(overrides: Partial<LicenseInfo> = {}): LicenseInfo {
  return {
    tier: 'pro',
    status: 'active',
    expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    fingerprint: 'abc123',
    ...overrides,
  };
}

describe('LicenseGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports NO_LICENSE when getLicenseInfo returns null', async () => {
    const gate = new LicenseGate({ getInfo: async () => null, recheckMs: 60_000 });
    const state = await gate.evaluate();
    expect(state.kind).toBe('NO_LICENSE');
  });

  it('reports LICENSED when status is active and not expiring soon', async () => {
    const gate = new LicenseGate({ getInfo: async () => info(), recheckMs: 60_000 });
    const state = await gate.evaluate();
    expect(state.kind).toBe('LICENSED');
    if (state.kind === 'LICENSED') expect(state.tier).toBe('pro');
  });

  it('reports TRIALING when tier is trial and status is trialing', async () => {
    const gate = new LicenseGate({ getInfo: async () => info({ tier: 'trial', status: 'trialing', expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString() }), recheckMs: 60_000 });
    const state = await gate.evaluate();
    expect(state.kind).toBe('TRIALING');
    if (state.kind === 'TRIALING') expect(state.daysLeft).toBeGreaterThanOrEqual(4);
  });

  it('reports EXPIRED when expiresAt is in the past', async () => {
    const gate = new LicenseGate({ getInfo: async () => info({ status: 'expired', expiresAt: new Date(Date.now() - 1).toISOString() }), recheckMs: 60_000 });
    const state = await gate.evaluate();
    expect(state.kind).toBe('EXPIRED');
  });

  it('emits a state change when re-check finds a different state', async () => {
    let current: LicenseInfo | null = null;
    const gate = new LicenseGate({ getInfo: async () => current, recheckMs: 60_000 });
    const observed: string[] = [];
    gate.onStateChange(s => observed.push(s.kind));
    await gate.evaluate();
    gate.startRechecking();
    current = info();
    await vi.advanceTimersByTimeAsync(60_001);
    expect(observed).toContain('LICENSED');
    gate.dispose();
  });

  it('does NOT emit when re-check finds the same state', async () => {
    const fixedExpiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const gate = new LicenseGate({ getInfo: async () => info({ expiresAt: fixedExpiresAt }), recheckMs: 60_000 });
    const observed: string[] = [];
    await gate.evaluate();
    gate.onStateChange(s => observed.push(s.kind));
    gate.startRechecking();
    await vi.advanceTimersByTimeAsync(60_001);
    expect(observed).toHaveLength(0);
    gate.dispose();
  });

  it('dispose() stops the recheck timer', async () => {
    const getInfo = vi.fn(async () => info());
    const gate = new LicenseGate({ getInfo, recheckMs: 60_000 });
    await gate.evaluate();
    gate.startRechecking();
    gate.dispose();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(getInfo).toHaveBeenCalledTimes(1);
  });
});
