import {
  NetworkError,
  SeatLimitError,
  InvalidKeyError,
  LicenseRevokedError,
  FingerprintAlreadyUsedError,
  EmailAlreadyUsedError,
  TrialUnavailableError,
} from './errors.js';
import type { ActivateResult, ValidateResult, TrialStartResult } from './types.js';

const API_BASE = process.env['CTXLOOM_API_BASE'] ?? 'https://api.ctxloom.com';

async function post<T>(url: string, body: unknown): Promise<T> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      const err = data['error'] as string | undefined;
      if (res.status === 409) {
        if (err === 'seat_limit_exceeded') throw new SeatLimitError();
        if (err === 'invalid_key') throw new InvalidKeyError();
        if (err === 'license_revoked') throw new LicenseRevokedError();
        if (err === 'fingerprint_already_used') throw new FingerprintAlreadyUsedError();
        if (err === 'email_already_used') throw new EmailAlreadyUsedError();
      }
      // 503 from /v1/trial/start means the trial backend (Polar) is down —
      // surface a distinct error so the CLI can guide the user to `activate` instead.
      if (res.status === 503 && url.endsWith('/v1/trial/start')) {
        throw new TrialUnavailableError();
      }
      throw new NetworkError(`HTTP ${res.status}: ${err ?? 'unknown error'}`);
    }
    return data as T;
  } catch (err) {
    if (
      err instanceof NetworkError ||
      err instanceof SeatLimitError ||
      err instanceof InvalidKeyError ||
      err instanceof LicenseRevokedError ||
      err instanceof FingerprintAlreadyUsedError ||
      err instanceof EmailAlreadyUsedError ||
      err instanceof TrialUnavailableError
    ) {
      throw err;
    }
    throw new NetworkError(err instanceof Error ? err.message : String(err));
  }
}

export class ApiClient {
  private readonly base: string;

  constructor(base: string = API_BASE) {
    this.base = base;
  }

  async activate(
    key: string,
    fingerprint: string,
    hostname: string,
    platform: string,
  ): Promise<ActivateResult> {
    const data = await post<{
      license_id: string;
      tier: string;
      seats_used: number;
      seats_total: number;
      expires_at: string;
      instance_id: string;
    }>(`${this.base}/v1/license/activate`, { key, fingerprint, hostname, platform });

    return {
      licenseId: data.license_id,
      tier: data.tier as ActivateResult['tier'],
      seatsUsed: data.seats_used,
      seatsTotal: data.seats_total,
      expiresAt: data.expires_at,
      instanceId: data.instance_id,
    };
  }

  async validate(key: string, instanceId: string): Promise<ValidateResult> {
    const data = await post<{ status: string; expires_at: string }>(
      `${this.base}/v1/license/validate`,
      { key, instance_id: instanceId },
    );
    return { status: data.status as ValidateResult['status'], expiresAt: data.expires_at };
  }

  async deactivate(key: string, instanceId: string): Promise<void> {
    await post(`${this.base}/v1/license/deactivate`, { key, instance_id: instanceId });
  }

  async startTrial(email: string, fingerprint: string): Promise<TrialStartResult> {
    const data = await post<{ checkout_url: string }>(
      `${this.base}/v1/trial/start`,
      { email, fingerprint },
    );
    return { checkoutUrl: data.checkout_url };
  }
}
