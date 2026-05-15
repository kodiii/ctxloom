import os from 'node:os';
import { LicenseStore } from './LicenseStore.js';
import { ApiClient } from './ApiClient.js';
import { Fingerprint } from './Fingerprint.js';
import { maybePrintExpiryWarning } from './ExpiryWarning.js';
import { LicenseRequiredError, NetworkError, LicenseRevokedError } from './errors.js';
import { track } from './telemetry.js';
import type { LicenseFile } from './types.js';

export * from './errors.js';
export * from './types.js';
export { LicenseStore } from './LicenseStore.js';
export { ApiClient } from './ApiClient.js';
export { Fingerprint } from './Fingerprint.js';
export { maybePrintExpiryWarning } from './ExpiryWarning.js';
export { shouldEmitInstallCompleted, shouldEmitFirstReviewRun } from './FunnelMilestones.js';

const REVALIDATION_DAYS = 7;
const GRACE_HOURS = 72;

interface LicenseOptions {
  home?: string;
  apiBase?: string;
}

function defaultHome(): string {
  return os.homedir();
}

export async function isActive(opts: LicenseOptions = {}): Promise<boolean> {
  const home = opts.home ?? defaultHome();
  const store = new LicenseStore(home);
  const license = await store.read();

  // Rows 1 & 2: missing or corrupt file
  if (!license) return false;

  // Row 3: expiresAt in the past
  if (new Date(license.expiresAt).getTime() <= Date.now()) return false;

  const lastValidated = new Date(license.lastValidatedAt).getTime();
  const msSinceValidation = Date.now() - lastValidated;
  const revalidationMs = REVALIDATION_DAYS * 24 * 60 * 60 * 1000;

  // Row 4: fast path — validated within revalidation window
  if (msSinceValidation <= revalidationMs) {
    maybePrintExpiryWarning(license.expiresAt);
    return true;
  }

  // Rows 5-8: past revalidation window — must check with backend
  const client = new ApiClient(opts.apiBase);
  try {
    const result = await client.validate(license.key, license.instanceId);

    // Row 8: backend says revoked/expired
    if (result.status === 'revoked' || result.status === 'expired') return false;

    // Row 5: backend confirms active — refresh lastValidatedAt
    const refreshed: LicenseFile = {
      ...license,
      lastValidatedAt: new Date().toISOString(),
      expiresAt: result.expiresAt || license.expiresAt,
    };
    await store.write(refreshed);
    // Fire renewal when the backend has extended the expiry (subscription
    // auto-renewed, manual renewal, plan upgrade). Same-expiry validations
    // are routine revalidations — not funnel events.
    if (result.expiresAt && result.expiresAt !== license.expiresAt) {
      track('renewal', {
        tier: license.tier,
        previousExpiresAt: license.expiresAt,
        newExpiresAt: result.expiresAt,
      });
    }
    maybePrintExpiryWarning(refreshed.expiresAt);
    return true;
  } catch (err) {
    // Row 8b: LicenseRevokedError or similar hard errors
    if (err instanceof LicenseRevokedError) return false;

    // Rows 6 & 7: network failure — check grace window
    if (err instanceof NetworkError || err instanceof TypeError) {
      const graceMs = GRACE_HOURS * 60 * 60 * 1000;
      if (msSinceValidation <= revalidationMs + graceMs) {
        // Row 6: within grace — allow with warning
        process.stderr.write(
          `⚠ ctxloom is running offline. License will be reverified when network is available.\n\n`,
        );
        maybePrintExpiryWarning(license.expiresAt);
        return true;
      }
      // Row 7: grace exhausted
      return false;
    }
    // Unknown error — fail closed
    return false;
  }
}

export async function requireActive(opts: LicenseOptions = {}): Promise<void> {
  const active = await isActive(opts);
  if (!active) throw new LicenseRequiredError();
}

export async function getLicenseInfo(opts: LicenseOptions = {}): Promise<LicenseFile | null> {
  const home = opts.home ?? defaultHome();
  const store = new LicenseStore(home);
  return store.read();
}

export async function activateLicense(
  key: string,
  opts: LicenseOptions = {},
): Promise<LicenseFile> {
  const home = opts.home ?? defaultHome();
  const fingerprint = await Fingerprint.compute();
  const hostname = os.hostname();
  const platform = `${os.platform()}-${os.arch()}`;

  const client = new ApiClient(opts.apiBase);
  const result = await client.activate(key, fingerprint, hostname, platform);

  const license: LicenseFile = {
    schemaVersion: 1,
    key,
    tier: result.tier,
    status: 'active',
    fingerprint,
    seats: result.seatsTotal,
    issuedAt: new Date().toISOString(),
    expiresAt: result.expiresAt,
    lastValidatedAt: new Date().toISOString(),
    licenseId: result.licenseId,
    instanceId: result.instanceId,
  };

  const store = new LicenseStore(home);
  await store.write(license);
  return license;
}

export async function deactivateLicense(opts: LicenseOptions = {}): Promise<void> {
  const home = opts.home ?? defaultHome();
  const store = new LicenseStore(home);
  const license = await store.read();
  if (!license) return;

  const client = new ApiClient(opts.apiBase);
  await client.deactivate(license.key, license.instanceId);
  await store.clear();
}

export async function startTrial(
  email: string,
  opts: LicenseOptions = {},
): Promise<{ checkoutUrl: string }> {
  const home = opts.home ?? defaultHome();
  const fingerprint = await Fingerprint.compute();
  const client = new ApiClient(opts.apiBase);
  const result = await client.startTrial(email, fingerprint);
  // Trial license is emailed by Polar — return checkout URL for the browser
  void home; // no local state written until user runs `activate <KEY>`
  return result;
}
