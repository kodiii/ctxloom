/**
 * Installation token manager.
 *
 * Caches GitHub App installation tokens and refreshes them 5 minutes before
 * expiry using the `expires_at` timestamp returned by GitHub.  Tokens are
 * never written to logs.
 *
 * PRIVATE_KEY must be supplied via the PRIVATE_KEY environment variable — no
 * file-path fallback is accepted.
 */

import type { Logger } from 'pino';

/** Five minutes expressed in milliseconds. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

interface CacheEntry {
  readonly token: string;
  /** Unix timestamp (ms) after which the token must be refreshed. */
  readonly refreshAfterMs: number;
}

export interface TokenResponse {
  token: string;
  /** ISO-8601 datetime string, e.g. "2024-01-15T12:00:00Z" */
  expires_at: string;
}

export type FetchTokenFn = (installationId: number) => Promise<TokenResponse>;

export class InstallationTokenManager {
  readonly #cache = new Map<number, CacheEntry>();
  readonly #fetchToken: FetchTokenFn;
  readonly #logger: Logger;

  constructor(fetchToken: FetchTokenFn, logger: Logger) {
    this.#fetchToken = fetchToken;
    this.#logger = logger;
  }

  /**
   * Returns a valid installation token, refreshing the cache if the token is
   * within 5 minutes of expiry or has not been fetched yet.
   */
  async getToken(installationId: number): Promise<string> {
    const entry = this.#cache.get(installationId);
    const now = Date.now();

    if (entry !== undefined && now < entry.refreshAfterMs) {
      return entry.token;
    }

    this.#logger.info({ installationId }, 'Fetching new installation token');

    const response = await this.#fetchToken(installationId);
    const expiresAtMs = new Date(response.expires_at).getTime();
    if (Number.isNaN(expiresAtMs)) {
      throw new Error(
        `Invalid expires_at value received from GitHub: "${response.expires_at}"`,
      );
    }
    const refreshAfterMs = expiresAtMs - REFRESH_MARGIN_MS;

    const newEntry: CacheEntry = {
      token: response.token,
      refreshAfterMs,
    };

    this.#cache.set(installationId, newEntry);

    // NOTE: response.token is intentionally not logged here.
    this.#logger.info(
      { installationId, expiresAt: response.expires_at },
      'Installation token cached',
    );

    return newEntry.token;
  }

  /**
   * Removes the cached entry for the given installation.  Call this when an
   * `installation.deleted` event is received to prevent stale entries from
   * accumulating.
   */
  evict(installationId: number): void {
    this.#cache.delete(installationId);
    this.#logger.info({ installationId }, 'Installation token evicted from cache');
  }
}

const PEM_HEADER = /^-----BEGIN (?:RSA )?PRIVATE KEY-----/;
const BASE64_ONLY = /^[A-Za-z0-9+/=\s]+$/;

/**
 * Validates that PRIVATE_KEY is available in the environment and is in
 * a recognized format. Returns the **normalized PEM string** and also
 * mutates `process.env.PRIVATE_KEY` to the same normalized value, so
 * Probot's own constructor (which reads the env var directly) sees a
 * single canonical format.
 *
 * Why this exists: the README historically said "PRIVATE_KEY can be PEM
 * or base64 for convenience". Dual-mode is a footgun — a partially
 * base64-encoded value (whitespace, BOM, accidental wrapping) can match
 * one detector and silently fail signature generation later. Pick a
 * format, normalize aggressively, and fail loudly on anything else.
 *
 * Accepted inputs:
 *   1. Raw PEM, starting with `-----BEGIN [RSA ]PRIVATE KEY-----`
 *   2. Base64 of (1), explicitly opted into via PRIVATE_KEY_BASE64=1
 *
 * Anything else throws with a message that tells the operator exactly
 * which mode it tried and how to fix it.
 */
export function requirePrivateKey(): string {
  const raw = process.env['PRIVATE_KEY'];
  if (!raw || raw.trim() === '') {
    throw new Error(
      'PRIVATE_KEY environment variable is required but was not set. ' +
        'Provide the GitHub App private key (PEM format) via PRIVATE_KEY.',
    );
  }

  const trimmed = raw.trim();
  const wantsBase64 = process.env['PRIVATE_KEY_BASE64'] === '1';

  if (PEM_HEADER.test(trimmed)) {
    if (wantsBase64) {
      throw new Error(
        'PRIVATE_KEY_BASE64=1 is set but PRIVATE_KEY is already a raw PEM. ' +
          'Either drop the flag or supply the base64-encoded PEM.',
      );
    }
    process.env['PRIVATE_KEY'] = trimmed;
    return trimmed;
  }

  if (wantsBase64) {
    if (!BASE64_ONLY.test(trimmed)) {
      throw new Error(
        'PRIVATE_KEY_BASE64=1 is set but PRIVATE_KEY contains characters ' +
          'outside the base64 alphabet. Re-encode with `base64 -w0 key.pem`.',
      );
    }
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8').trim();
    if (!PEM_HEADER.test(decoded)) {
      throw new Error(
        'PRIVATE_KEY_BASE64=1 decoded successfully but the result is not a ' +
          'PEM key (no `-----BEGIN PRIVATE KEY-----` header). Verify the ' +
          'original file is a GitHub App private key in PEM format.',
      );
    }
    process.env['PRIVATE_KEY'] = decoded;
    return decoded;
  }

  // No PEM header and no PRIVATE_KEY_BASE64 opt-in. Could be base64 the
  // user forgot to flag — point them at the explicit env var.
  if (BASE64_ONLY.test(trimmed)) {
    throw new Error(
      'PRIVATE_KEY looks base64-encoded but PRIVATE_KEY_BASE64=1 is not set. ' +
        'Set PRIVATE_KEY_BASE64=1 to decode it, or supply the raw PEM directly.',
    );
  }

  throw new Error(
    'PRIVATE_KEY is set but is neither a recognizable PEM nor a clean base64 ' +
      'blob. Expected `-----BEGIN [RSA ]PRIVATE KEY-----` at the start, or a ' +
      'pure-base64 value with PRIVATE_KEY_BASE64=1.',
  );
}
