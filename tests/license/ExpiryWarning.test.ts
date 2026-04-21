import { describe, it, expect, vi, afterEach } from 'vitest';
import { maybePrintExpiryWarning } from '../../src/license/ExpiryWarning.js';

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

describe('ExpiryWarning', () => {
  afterEach(() => vi.restoreAllMocks());

  it('emits a warning when expiry is within 3 days', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    maybePrintExpiryWarning(daysFromNow(2));
    expect(spy).toHaveBeenCalled();
    const output = spy.mock.calls.map(c => String(c[0])).join('');
    expect(output).toContain('expires in');
  });

  it('emits a warning when expiry is within 7 days', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    maybePrintExpiryWarning(daysFromNow(5));
    expect(spy).toHaveBeenCalled();
    const output = spy.mock.calls.map(c => String(c[0])).join('');
    expect(output).toContain('expires in');
  });

  it('emits nothing when expiry is beyond 7 days', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    maybePrintExpiryWarning(daysFromNow(30));
    expect(spy).not.toHaveBeenCalled();
  });

  it('emits nothing for empty expiresAt', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    maybePrintExpiryWarning('');
    expect(spy).not.toHaveBeenCalled();
  });
});
