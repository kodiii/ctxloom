import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'node:os';

vi.mock('node:os');

describe('Fingerprint', () => {
  beforeEach(() => {
    vi.mocked(os.hostname).mockReturnValue('test-machine');
    vi.mocked(os.userInfo).mockReturnValue({ username: 'testuser', uid: 1000, gid: 1000, shell: '/bin/zsh', homedir: '/home/testuser' });
    vi.mocked(os.platform).mockReturnValue('linux');
  });

  it('returns a string matching sha256:<64 hex chars>', async () => {
    const { Fingerprint } = await import('../../src/license/Fingerprint.js');
    const fp = await Fingerprint.compute();
    expect(fp).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('is stable across multiple calls with same inputs', async () => {
    const { Fingerprint } = await import('../../src/license/Fingerprint.js');
    const a = await Fingerprint.compute();
    const b = await Fingerprint.compute();
    expect(a).toBe(b);
  });

  it('differs when hostname changes', async () => {
    const { Fingerprint } = await import('../../src/license/Fingerprint.js');
    vi.mocked(os.hostname).mockReturnValue('machine-A');
    const a = await Fingerprint.compute();
    vi.mocked(os.hostname).mockReturnValue('machine-B');
    vi.resetModules();
    const { Fingerprint: Fingerprint2 } = await import('../../src/license/Fingerprint.js');
    const b = await Fingerprint2.compute();
    expect(a).not.toBe(b);
  });
});
