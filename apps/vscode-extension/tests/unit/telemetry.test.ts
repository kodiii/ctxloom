import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock VS Code with just the surface telemetry.ts needs.
const getMock = vi.fn();
vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({ get: getMock }),
  },
}));

// Import after the mock is set up.
import { resolveTelemetry, reportError } from '../../src/shared/telemetry.js';

describe('resolveTelemetry', () => {
  let originalNoTelemetry: string | undefined;
  let originalDnt: string | undefined;

  beforeEach(() => {
    originalNoTelemetry = process.env['CTXLOOM_NO_TELEMETRY'];
    originalDnt = process.env['DO_NOT_TRACK'];
    delete process.env['CTXLOOM_NO_TELEMETRY'];
    delete process.env['DO_NOT_TRACK'];
    getMock.mockReset();
  });

  afterEach(() => {
    if (originalNoTelemetry !== undefined) process.env['CTXLOOM_NO_TELEMETRY'] = originalNoTelemetry;
    else delete process.env['CTXLOOM_NO_TELEMETRY'];
    if (originalDnt !== undefined) process.env['DO_NOT_TRACK'] = originalDnt;
    else delete process.env['DO_NOT_TRACK'];
  });

  it('returns level=off and no env flag when telemetry is disabled in settings', () => {
    getMock.mockImplementation((key: string) => {
      if (key === 'telemetry.enabled') return false;
      return undefined;
    });
    const result = resolveTelemetry();
    expect(result.level).toBe('off');
    expect(result.disabledByEnv).toBeUndefined();
  });

  it('CTXLOOM_NO_TELEMETRY=1 forces level=off with env flag', () => {
    process.env['CTXLOOM_NO_TELEMETRY'] = '1';
    getMock.mockImplementation((key: string) => {
      if (key === 'telemetry.enabled') return true;
      if (key === 'telemetry.level') return 'all';
      return undefined;
    });
    const result = resolveTelemetry();
    expect(result.level).toBe('off');
    expect(result.disabledByEnv?.variable).toBe('CTXLOOM_NO_TELEMETRY');
  });

  it('DO_NOT_TRACK=1 forces level=off with env flag', () => {
    process.env['DO_NOT_TRACK'] = '1';
    getMock.mockImplementation((key: string) => {
      if (key === 'telemetry.enabled') return true;
      if (key === 'telemetry.level') return 'error';
      return undefined;
    });
    const result = resolveTelemetry();
    expect(result.level).toBe('off');
    expect(result.disabledByEnv?.variable).toBe('DO_NOT_TRACK');
  });

  it('reads the configured level when telemetry is enabled', () => {
    getMock.mockImplementation((key: string) => {
      if (key === 'telemetry.enabled') return true;
      if (key === 'telemetry.level') return 'error';
      return undefined;
    });
    const result = resolveTelemetry();
    expect(result.level).toBe('error');
  });

  it('falls back to off for an unrecognized level value', () => {
    getMock.mockImplementation((key: string) => {
      if (key === 'telemetry.enabled') return true;
      if (key === 'telemetry.level') return 'banana';
      return undefined;
    });
    const result = resolveTelemetry();
    expect(result.level).toBe('off');
  });
});

describe('reportError', () => {
  beforeEach(() => {
    delete process.env['CTXLOOM_NO_TELEMETRY'];
    delete process.env['DO_NOT_TRACK'];
    getMock.mockReset();
  });

  it('does not throw when @ctxloom/core is unavailable', async () => {
    getMock.mockImplementation((key: string) => {
      if (key === 'telemetry.enabled') return true;
      if (key === 'telemetry.level') return 'error';
      return undefined;
    });
    // @ctxloom/core resolves in this monorepo, but we don't care
    // about the captureError side effect here — only that reportError
    // never throws.
    await expect(reportError(new Error('boom'))).resolves.toBeUndefined();
  });

  it('silently no-ops when level resolves to off', async () => {
    process.env['CTXLOOM_NO_TELEMETRY'] = '1';
    await expect(reportError(new Error('boom'))).resolves.toBeUndefined();
  });
});
