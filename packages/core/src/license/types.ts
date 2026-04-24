import { z } from 'zod';

export const FINGERPRINT_RE = /^sha256:[0-9a-f]{64}$/;

export const LicenseFileSchema = z.object({
  schemaVersion: z.literal(1),
  key: z.string().min(1),
  tier: z.enum(['pro', 'team', 'enterprise', 'trial']),
  status: z.enum(['active', 'trialing', 'expired']),
  email: z.string().email(),
  fingerprint: z.string().regex(FINGERPRINT_RE),
  seats: z.number().int().positive(),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  lastValidatedAt: z.string().datetime(),
  licenseId: z.string().min(1),
  instanceId: z.string().min(1),
});

export type LicenseFile = z.infer<typeof LicenseFileSchema>;

export type Tier = LicenseFile['tier'];
export type LicenseStatus = LicenseFile['status'];

export interface ActivateResult {
  licenseId: string;
  instanceId: string;
  tier: Tier;
  seatsUsed: number;
  seatsTotal: number;
  expiresAt: string;
}

export interface ValidateResult {
  status: 'active' | 'revoked' | 'expired';
  expiresAt: string;
}

export interface TrialStartResult {
  checkoutUrl: string;
}
