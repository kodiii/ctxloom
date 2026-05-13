import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { shouldShowTelemetryNotice } from '@ctxloom/core';

describe('shouldShowTelemetryNotice', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-notice-'));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('returns true on first call (no marker present)', () => {
    expect(shouldShowTelemetryNotice(tmpHome)).toBe(true);
  });

  it('writes the marker file after the first call', () => {
    shouldShowTelemetryNotice(tmpHome);
    const marker = path.join(tmpHome, '.ctxloom', 'telemetry_notice_shown');
    expect(fs.existsSync(marker)).toBe(true);
  });

  it('marker file has mode 0o600 (unix only)', () => {
    if (process.platform === 'win32') return; // skip — POSIX-only assertion
    shouldShowTelemetryNotice(tmpHome);
    const marker = path.join(tmpHome, '.ctxloom', 'telemetry_notice_shown');
    const stat = fs.statSync(marker);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('returns false on subsequent calls (marker present)', () => {
    shouldShowTelemetryNotice(tmpHome);
    expect(shouldShowTelemetryNotice(tmpHome)).toBe(false);
    expect(shouldShowTelemetryNotice(tmpHome)).toBe(false);
  });

  it('marker contents are an ISO timestamp', () => {
    shouldShowTelemetryNotice(tmpHome);
    const marker = path.join(tmpHome, '.ctxloom', 'telemetry_notice_shown');
    const contents = fs.readFileSync(marker, 'utf8');
    expect(() => new Date(contents).toISOString()).not.toThrow();
    expect(new Date(contents).getTime()).toBeGreaterThan(0);
  });
});
