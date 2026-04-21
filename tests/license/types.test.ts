import { describe, it, expect } from 'vitest';
import { LicenseFileSchema } from '../../src/license/types.js';

describe('LicenseFileSchema', () => {
  it('parses a valid license file', () => {
    const valid = {
      schemaVersion: 1,
      key: 'ctxl_pro_abc123',
      tier: 'pro',
      status: 'active',
      email: 'user@example.com',
      fingerprint: 'sha256:' + 'a'.repeat(64),
      seats: 1,
      issuedAt: '2026-04-20T12:00:00Z',
      expiresAt: '2027-04-20T12:00:00Z',
      lastValidatedAt: '2026-04-20T12:00:00Z',
      licenseId: 'lk_abc',
      instanceId: 'act_xyz',
    };
    expect(() => LicenseFileSchema.parse(valid)).not.toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => LicenseFileSchema.parse({ key: 'ctxl_pro_abc' })).toThrow();
  });

  it('rejects invalid tier', () => {
    const bad = {
      schemaVersion: 1,
      key: 'ctxl_pro_abc123',
      tier: 'invalid_tier',
      status: 'active',
      email: 'user@example.com',
      fingerprint: 'sha256:' + 'a'.repeat(64),
      seats: 1,
      issuedAt: '2026-04-20T12:00:00Z',
      expiresAt: '2027-04-20T12:00:00Z',
      lastValidatedAt: '2026-04-20T12:00:00Z',
      licenseId: 'lk_abc',
      instanceId: 'act_xyz',
    };
    expect(() => LicenseFileSchema.parse(bad)).toThrow();
  });

  it('rejects invalid fingerprint format', () => {
    const bad = {
      schemaVersion: 1,
      key: 'ctxl_pro_abc123',
      tier: 'pro',
      status: 'active',
      email: 'user@example.com',
      fingerprint: 'notafingerprint',
      seats: 1,
      issuedAt: '2026-04-20T12:00:00Z',
      expiresAt: '2027-04-20T12:00:00Z',
      lastValidatedAt: '2026-04-20T12:00:00Z',
      licenseId: 'lk_abc',
      instanceId: 'act_xyz',
    };
    expect(() => LicenseFileSchema.parse(bad)).toThrow();
  });

  it('accepts all valid tiers', () => {
    const base = {
      schemaVersion: 1,
      key: 'ctxl_pro_abc123',
      status: 'active',
      email: 'user@example.com',
      fingerprint: 'sha256:' + 'a'.repeat(64),
      seats: 1,
      issuedAt: '2026-04-20T12:00:00Z',
      expiresAt: '2027-04-20T12:00:00Z',
      lastValidatedAt: '2026-04-20T12:00:00Z',
      licenseId: 'lk_abc',
      instanceId: 'act_xyz',
    };
    for (const tier of ['pro', 'team', 'enterprise', 'trial']) {
      expect(() => LicenseFileSchema.parse({ ...base, tier })).not.toThrow();
    }
  });
});
