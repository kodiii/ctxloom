import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function tmpHome(): string {
  return mkdtempSync(path.join(tmpdir(), 'ctxloom-test-'));
}

const validLicense = {
  schemaVersion: 1 as const,
  key: 'ctxl_pro_abc123',
  tier: 'pro' as const,
  status: 'active' as const,
  email: 'user@example.com',
  fingerprint: 'sha256:' + 'a'.repeat(64),
  seats: 1,
  issuedAt: '2026-04-20T12:00:00.000Z',
  expiresAt: '2027-04-20T12:00:00.000Z',
  lastValidatedAt: '2026-04-20T12:00:00.000Z',
  licenseId: 'lk_abc',
  instanceId: 'act_xyz',
};

describe('LicenseStore', () => {
  let home: string;

  beforeEach(() => {
    home = tmpHome();
  });

  it('returns null when license file does not exist', async () => {
    const { LicenseStore } = await import('../../src/license/LicenseStore.js');
    const store = new LicenseStore(home);
    expect(await store.read()).toBeNull();
  });

  it('round-trips a valid license file', async () => {
    const { LicenseStore } = await import('../../src/license/LicenseStore.js');
    const store = new LicenseStore(home);
    await store.write(validLicense);
    const result = await store.read();
    expect(result).toEqual(validLicense);
  });

  it('returns null for a corrupt (non-JSON) license file', async () => {
    const { LicenseStore } = await import('../../src/license/LicenseStore.js');
    const store = new LicenseStore(home);
    await store.write(validLicense);

    // corrupt it
    const { writeFileSync } = await import('node:fs');
    const { licenseFilePath } = await import('../../src/license/LicenseStore.js');
    writeFileSync(licenseFilePath(home), 'this is not json');

    expect(await store.read()).toBeNull();
  });

  it('returns null for a structurally invalid license file', async () => {
    const { LicenseStore } = await import('../../src/license/LicenseStore.js');
    const store = new LicenseStore(home);

    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { licenseFilePath } = await import('../../src/license/LicenseStore.js');
    mkdirSync(path.dirname(licenseFilePath(home)), { recursive: true });
    writeFileSync(licenseFilePath(home), JSON.stringify({ key: 'only_key' }));

    expect(await store.read()).toBeNull();
  });

  it('clears the license file', async () => {
    const { LicenseStore } = await import('../../src/license/LicenseStore.js');
    const store = new LicenseStore(home);
    await store.write(validLicense);
    await store.clear();
    expect(await store.read()).toBeNull();
  });

  it('sets 0600 permissions on Unix', async () => {
    if (process.platform === 'win32') return;
    const { LicenseStore } = await import('../../src/license/LicenseStore.js');
    const store = new LicenseStore(home);
    await store.write(validLicense);

    const { statSync } = await import('node:fs');
    const { licenseFilePath } = await import('../../src/license/LicenseStore.js');
    const mode = statSync(licenseFilePath(home)).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
