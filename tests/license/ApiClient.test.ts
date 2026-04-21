import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from '../../src/license/ApiClient.js';
import { SeatLimitError, InvalidKeyError, NetworkError } from '../../src/license/errors.js';

const VALID_FINGERPRINT = 'sha256:' + 'a'.repeat(64);

describe('ApiClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  describe('activate', () => {
    it('returns normalized result on 200', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          license_id: 'lk_abc',
          tier: 'pro',
          seats_used: 1,
          seats_total: 1,
          expires_at: '2027-04-20T12:00:00Z',
          instance_id: 'act_xyz',
        }),
      });

      const client = new ApiClient('https://api.ctxloom.com');
      const result = await client.activate('ctxl_pro_abc', VALID_FINGERPRINT, 'myhost', 'darwin-arm64');
      expect(result.licenseId).toBe('lk_abc');
      expect(result.tier).toBe('pro');
      expect(result.instanceId).toBe('act_xyz');
    });

    it('throws SeatLimitError on 409 seat_limit_exceeded', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: 'seat_limit_exceeded' }),
      });

      const client = new ApiClient('https://api.ctxloom.com');
      await expect(client.activate('ctxl_pro_abc', VALID_FINGERPRINT, 'h', 'p')).rejects.toThrow(SeatLimitError);
    });

    it('throws InvalidKeyError on 409 invalid_key', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: 'invalid_key' }),
      });

      const client = new ApiClient('https://api.ctxloom.com');
      await expect(client.activate('ctxl_pro_abc', VALID_FINGERPRINT, 'h', 'p')).rejects.toThrow(InvalidKeyError);
    });

    it('throws NetworkError on fetch failure', async () => {
      fetchMock.mockRejectedValue(new Error('connection refused'));

      const client = new ApiClient('https://api.ctxloom.com');
      await expect(client.activate('ctxl_pro_abc', VALID_FINGERPRINT, 'h', 'p')).rejects.toThrow(NetworkError);
    });
  });

  describe('validate', () => {
    it('returns active status on 200', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'active', expires_at: '2027-04-20T12:00:00Z' }),
      });

      const client = new ApiClient('https://api.ctxloom.com');
      const result = await client.validate('ctxl_pro_abc', 'act_xyz');
      expect(result.status).toBe('active');
      expect(result.expiresAt).toBe('2027-04-20T12:00:00Z');
    });

    it('throws NetworkError on 503', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: 'upstream_error' }),
      });

      const client = new ApiClient('https://api.ctxloom.com');
      await expect(client.validate('ctxl_pro_abc', 'act_xyz')).rejects.toThrow(NetworkError);
    });

    it('throws NetworkError on fetch failure', async () => {
      fetchMock.mockRejectedValue(new TypeError('network timeout'));

      const client = new ApiClient('https://api.ctxloom.com');
      await expect(client.validate('ctxl_pro_abc', 'act_xyz')).rejects.toThrow(NetworkError);
    });
  });

  describe('deactivate', () => {
    it('resolves on 200', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'deactivated' }),
      });

      const client = new ApiClient('https://api.ctxloom.com');
      await expect(client.deactivate('ctxl_pro_abc', 'act_xyz')).resolves.toBeUndefined();
    });

    it('throws NetworkError on 503', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });

      const client = new ApiClient('https://api.ctxloom.com');
      await expect(client.deactivate('ctxl_pro_abc', 'act_xyz')).rejects.toThrow(NetworkError);
    });
  });

  describe('startTrial', () => {
    it('returns checkout_url on 200', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ checkout_url: 'https://sandbox.polar.sh/checkout/abc' }),
      });

      const client = new ApiClient('https://api.ctxloom.com');
      const result = await client.startTrial('user@example.com', VALID_FINGERPRINT);
      expect(result.checkoutUrl).toBe('https://sandbox.polar.sh/checkout/abc');
    });

    it('throws FingerprintAlreadyUsedError on 409 fingerprint_already_used', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: 'fingerprint_already_used' }),
      });

      const { FingerprintAlreadyUsedError } = await import('../../src/license/errors.js');
      const client = new ApiClient('https://api.ctxloom.com');
      await expect(client.startTrial('user@example.com', VALID_FINGERPRINT)).rejects.toThrow(FingerprintAlreadyUsedError);
    });

    it('throws EmailAlreadyUsedError on 409 email_already_used', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: 'email_already_used' }),
      });

      const { EmailAlreadyUsedError } = await import('../../src/license/errors.js');
      const client = new ApiClient('https://api.ctxloom.com');
      await expect(client.startTrial('user@example.com', VALID_FINGERPRINT)).rejects.toThrow(EmailAlreadyUsedError);
    });
  });
});
