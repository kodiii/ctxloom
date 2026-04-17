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

/**
 * Validates that PRIVATE_KEY is available in the environment.
 *
 * Throws at startup if the variable is absent so misconfigured deployments
 * fail fast rather than producing confusing runtime errors.
 */
export function requirePrivateKey(): string {
  const key = process.env['PRIVATE_KEY'];
  if (!key || key.trim() === '') {
    throw new Error(
      'PRIVATE_KEY environment variable is required but was not set. ' +
        'Provide the GitHub App private key via the PRIVATE_KEY env var.',
    );
  }
  return key;
}
