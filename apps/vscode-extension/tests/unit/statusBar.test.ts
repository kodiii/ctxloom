import { describe, it, expect } from 'vitest';
import { renderStatusBar, type StatusBarInputs } from '../../src/license/statusBar.js';

function input(overrides: Partial<StatusBarInputs> = {}): StatusBarInputs {
  return {
    licenseState: { kind: 'LICENSED', tier: 'pro', expiresAt: '' },
    riskScore: null,
    ...overrides,
  };
}

describe('renderStatusBar', () => {
  it('shows risk score and "ctxloom" mark when licensed', () => {
    const r = renderStatusBar(input({ riskScore: 0.42 }));
    expect(r.text).toBe('⚠ 0.42 · ctxloom');
    expect(r.tooltip).toContain('Risk');
    expect(r.color).toBeUndefined();
  });

  it('falls back to "ctxloom" alone when risk is null', () => {
    const r = renderStatusBar(input({ riskScore: null }));
    expect(r.text).toBe('ctxloom');
  });

  it('shows "trial Nd left" when trialing with > 2 days left', () => {
    const r = renderStatusBar(input({ licenseState: { kind: 'TRIALING', tier: 'trial', daysLeft: 5, expiresAt: '' }, riskScore: 0.30 }));
    expect(r.text).toBe('⚠ 0.30 · trial 5d');
    expect(r.color).toBeUndefined();
  });

  it('switches to orange and "trial ends Sat"-style text when ≤ 2 days', () => {
    const exp = new Date(Date.now() + 1.5 * 86_400_000).toISOString();
    const r = renderStatusBar(input({ licenseState: { kind: 'TRIALING', tier: 'trial', daysLeft: 1, expiresAt: exp }, riskScore: 0.30 }));
    expect(r.text).toMatch(/^⚠ 0\.30 · trial ends /);
    expect(r.color).toBe('statusBarItem.warningForeground');
  });

  it('shows red expired marker when license expired', () => {
    const r = renderStatusBar(input({ licenseState: { kind: 'EXPIRED', expiresAt: '' }, riskScore: 0.50 }));
    expect(r.text).toBe('ctxloom expired');
    expect(r.color).toBe('statusBarItem.errorForeground');
  });

  it('shows licensed without trial countdown when tier is pro', () => {
    const r = renderStatusBar(input({ licenseState: { kind: 'LICENSED', tier: 'pro', expiresAt: '' }, riskScore: 0.10 }));
    expect(r.text).toBe('⚠ 0.10 · ctxloom');
  });
});

describe('renderStatusBar — CLI install states', () => {
  it('shows installing state', () => {
    const r = renderStatusBar({ licenseState: { kind: 'NO_LICENSE' }, riskScore: null, cliInstallState: 'installing' });
    expect(r.text).toMatch(/installing/i);
  });

  it('shows setup-needed with click hint', () => {
    const r = renderStatusBar({ licenseState: { kind: 'NO_LICENSE' }, riskScore: null, cliInstallState: 'setup-needed' });
    expect(r.text).toMatch(/setup needed/i);
    expect(r.tooltip).toMatch(/click/i);
  });

  it('shows failed in error color', () => {
    const r = renderStatusBar({ licenseState: { kind: 'NO_LICENSE' }, riskScore: null, cliInstallState: 'failed' });
    expect(r.text).toMatch(/setup failed/i);
    expect(r.color).toBe('statusBarItem.errorForeground');
  });

  it('shows windows-unsupported state', () => {
    const r = renderStatusBar({ licenseState: { kind: 'NO_LICENSE' }, riskScore: null, cliInstallState: 'windows-unsupported' });
    expect(r.text).toMatch(/windows.*v1\.2/i);
  });

  it('falls through to the v1 license/risk display when no cliInstallState', () => {
    const r = renderStatusBar({ licenseState: { kind: 'LICENSED', tier: 'pro', expiresAt: '' }, riskScore: 0.42 });
    expect(r.text).toBe('⚠ 0.42 · ctxloom');
  });
});
