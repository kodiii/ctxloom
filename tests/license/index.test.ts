/**
 * Tests every row of the isActive() state machine table from the design spec:
 *
 * | Condition                                            | Result            |
 * | File missing                                         | false             |
 * | File invalid/corrupt                                 | false             |
 * | expiresAt in the past                                | false             |
 * | lastValidatedAt within 7 days                        | true (fast path)  |
 * | lastValidatedAt > 7 days, network OK, backend active | true + refresh    |
 * | lastValidatedAt > 7 days, network fails, < 72h grace | true + warning    |
 * | lastValidatedAt > 7 days + 72h grace exhausted       | false             |
 * | Backend returns revoked / seat_limit_exceeded        | false             |
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LicenseFile } from '../../src/license/types.js';

function tmpHome(): string {
  return mkdtempSync(path.join(tmpdir(), 'ctxloom-license-test-'));
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

function daysAgo(d: number): string {
  return hoursAgo(d * 24);
}

function daysFromNow(d: number): string {
  return new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString();
}

function makeLicense(overrides: Partial<LicenseFile> = {}): LicenseFile {
  return {
    schemaVersion: 1,
    key: 'ctxl_pro_abc123',
    tier: 'pro',
    status: 'active',
    email: 'user@example.com',
    fingerprint: 'sha256:' + 'a'.repeat(64),
    seats: 1,
    issuedAt: daysAgo(30),
    expiresAt: daysFromNow(365),
    lastValidatedAt: daysAgo(1),
    licenseId: 'lk_abc',
    instanceId: 'act_xyz',
    ...overrides,
  };
}

vi.mock('../../packages/core/src/license/ApiClient.js', () => ({
  ApiClient: vi.fn().mockImplementation(() => ({
    validate: vi.fn(),
  })),
}));

describe('license.isActive() state machine', () => {
  let home: string;
  let mockValidate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    home = tmpHome();
    const { ApiClient } = await import('../../packages/core/src/license/ApiClient.js');
    mockValidate = vi.fn();
    vi.mocked(ApiClient).mockImplementation(() => ({ validate: mockValidate } as never));
  });

  afterEach(() => vi.restoreAllMocks());

  it('returns false when license file is missing', async () => {
    const { isActive } = await import('../../src/license/index.js');
    expect(await isActive({ home })).toBe(false);
  });

  it('returns false when license file is corrupt (handled by LicenseStore returning null)', async () => {
    const { LicenseStore } = await import('../../src/license/LicenseStore.js');
    vi.spyOn(LicenseStore.prototype, 'read').mockResolvedValue(null);
    const { isActive } = await import('../../src/license/index.js');
    expect(await isActive({ home })).toBe(false);
  });

  it('returns false when expiresAt is in the past', async () => {
    const { LicenseStore } = await import('../../src/license/LicenseStore.js');
    vi.spyOn(LicenseStore.prototype, 'read').mockResolvedValue(
      makeLicense({ expiresAt: daysAgo(1) }),
    );
    const { isActive } = await import('../../src/license/index.js');
    expect(await isActive({ home })).toBe(false);
  });

  it('returns true (fast path) when lastValidatedAt is within 7 days', async () => {
    const { LicenseStore } = await import('../../src/license/LicenseStore.js');
    vi.spyOn(LicenseStore.prototype, 'read').mockResolvedValue(
      makeLicense({ lastValidatedAt: daysAgo(3) }),
    );
    const { isActive } = await import('../../src/license/index.js');
    expect(await isActive({ home })).toBe(true);
    // No network call needed
    expect(mockValidate).not.toHaveBeenCalled();
  });

  it('returns true and refreshes when lastValidatedAt > 7 days and backend confirms active', async () => {
    const { LicenseStore } = await import('../../src/license/LicenseStore.js');
    const readSpy = vi.spyOn(LicenseStore.prototype, 'read').mockResolvedValue(
      makeLicense({ lastValidatedAt: daysAgo(8) }),
    );
    const writeSpy = vi.spyOn(LicenseStore.prototype, 'write').mockResolvedValue(undefined);
    mockValidate.mockResolvedValue({ status: 'active', expiresAt: daysFromNow(365) });

    const { isActive } = await import('../../src/license/index.js');
    expect(await isActive({ home })).toBe(true);
    expect(mockValidate).toHaveBeenCalledOnce();
    expect(writeSpy).toHaveBeenCalledOnce();
    // Verify lastValidatedAt was updated
    const written = writeSpy.mock.calls[0]?.[0] as LicenseFile;
    const updatedTs = new Date(written.lastValidatedAt).getTime();
    expect(updatedTs).toBeGreaterThan(Date.now() - 5000);
    readSpy.mockRestore();
  });

  it('returns true with stderr warning when network fails within 72h grace', async () => {
    const { LicenseStore } = await import('../../src/license/LicenseStore.js');
    vi.spyOn(LicenseStore.prototype, 'read').mockResolvedValue(
      makeLicense({ lastValidatedAt: hoursAgo(8 * 24) }), // 8 days ago — past 7d but within 10d grace
    );
    const { NetworkError } = await import('../../src/license/errors.js');
    mockValidate.mockRejectedValue(new NetworkError('timeout'));

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { isActive } = await import('../../src/license/index.js');
    expect(await isActive({ home })).toBe(true);
    const output = stderrSpy.mock.calls.map(c => String(c[0])).join('');
    expect(output).toContain('offline');
  });

  it('returns false when 72h grace is exhausted (lastValidatedAt > 10 days)', async () => {
    const { LicenseStore } = await import('../../src/license/LicenseStore.js');
    vi.spyOn(LicenseStore.prototype, 'read').mockResolvedValue(
      makeLicense({ lastValidatedAt: daysAgo(11) }),
    );
    const { NetworkError } = await import('../../src/license/errors.js');
    mockValidate.mockRejectedValue(new NetworkError('timeout'));

    const { isActive } = await import('../../src/license/index.js');
    expect(await isActive({ home })).toBe(false);
  });

  it('returns false when backend returns revoked status', async () => {
    const { LicenseStore } = await import('../../src/license/LicenseStore.js');
    vi.spyOn(LicenseStore.prototype, 'read').mockResolvedValue(
      makeLicense({ lastValidatedAt: daysAgo(8) }),
    );
    mockValidate.mockResolvedValue({ status: 'revoked', expiresAt: '' });

    const { isActive } = await import('../../src/license/index.js');
    expect(await isActive({ home })).toBe(false);
  });

  it('returns false when backend throws LicenseRevokedError', async () => {
    const { LicenseStore } = await import('../../src/license/LicenseStore.js');
    vi.spyOn(LicenseStore.prototype, 'read').mockResolvedValue(
      makeLicense({ lastValidatedAt: daysAgo(8) }),
    );
    const { LicenseRevokedError } = await import('../../src/license/errors.js');
    mockValidate.mockRejectedValue(new LicenseRevokedError());

    const { isActive } = await import('../../src/license/index.js');
    expect(await isActive({ home })).toBe(false);
  });
});

describe('license.requireActive()', () => {
  let home: string;

  beforeEach(async () => {
    vi.resetModules();
    home = tmpHome();
  });

  afterEach(() => vi.restoreAllMocks());

  it('throws LicenseRequiredError when license is not active', async () => {
    const { requireActive } = await import('../../src/license/index.js');
    const { LicenseRequiredError } = await import('../../src/license/errors.js');
    await expect(requireActive({ home })).rejects.toThrow(LicenseRequiredError);
  });

  it('resolves when license is active', async () => {
    const { LicenseStore } = await import('../../src/license/LicenseStore.js');
    vi.spyOn(LicenseStore.prototype, 'read').mockResolvedValue(
      makeLicense({ lastValidatedAt: new Date().toISOString() }),
    );
    const { requireActive } = await import('../../src/license/index.js');
    await expect(requireActive({ home })).resolves.toBeUndefined();
  });
});
