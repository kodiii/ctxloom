import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('CTXLOOM_TELEMETRY_LEVEL granular controls', () => {
  let tmpHome: string;
  let originalHome: string | undefined;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    process.env.POSTHOG_API_KEY = 'phc_test';
    process.env.SENTRY_DSN = 'https://abc@o1.ingest.sentry.io/123';
    delete process.env.CTXLOOM_NO_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    delete process.env.CTXLOOM_TELEMETRY_LEVEL;
    fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.resetModules();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    delete process.env.POSTHOG_API_KEY;
    delete process.env.SENTRY_DSN;
    delete process.env.CTXLOOM_TELEMETRY_LEVEL;
  });

  function postsTo(host: string): unknown[] {
    return fetchSpy.mock.calls
      .filter(c => typeof c[0] === 'string' && (c[0] as string).includes(host))
      .map(c => JSON.parse((c[1] as RequestInit).body as string));
  }

  it('default (no env var) fires PostHog events AND Sentry errors', async () => {
    const { track, captureError, getTelemetryLevel } = await import('@ctxloom/core');
    expect(getTelemetryLevel()).toBe('all');
    track('project_evicted', { project_id: 'a', pinned_count: 0, cap: 2 });
    captureError(new Error('boom'));
    await new Promise(r => setImmediate(r));
    expect(postsTo('posthog.com').some((e: any) => e.event === 'project_evicted')).toBe(true);
    expect(postsTo('sentry.io').length).toBeGreaterThan(0);
  });

  it('level=error: Sentry fires, PostHog suppressed', async () => {
    process.env.CTXLOOM_TELEMETRY_LEVEL = 'error';
    const { track, captureError, getTelemetryLevel } = await import('@ctxloom/core');
    expect(getTelemetryLevel()).toBe('error');
    track('project_evicted', { project_id: 'a', pinned_count: 0, cap: 2 });
    captureError(new Error('boom'));
    await new Promise(r => setImmediate(r));
    expect(postsTo('posthog.com').length).toBe(0);
    expect(postsTo('sentry.io').length).toBeGreaterThan(0);
  });

  it('level=off: both backends silent', async () => {
    process.env.CTXLOOM_TELEMETRY_LEVEL = 'off';
    const { track, captureError, getTelemetryLevel } = await import('@ctxloom/core');
    expect(getTelemetryLevel()).toBe('off');
    track('project_evicted', { project_id: 'a', pinned_count: 0, cap: 2 });
    captureError(new Error('boom'));
    await new Promise(r => setImmediate(r));
    expect(postsTo('posthog.com').length).toBe(0);
    expect(postsTo('sentry.io').length).toBe(0);
  });

  it('CTXLOOM_NO_TELEMETRY=1 forces level=off regardless of CTXLOOM_TELEMETRY_LEVEL', async () => {
    process.env.CTXLOOM_NO_TELEMETRY = '1';
    process.env.CTXLOOM_TELEMETRY_LEVEL = 'all';
    const { track, captureError, getTelemetryLevel } = await import('@ctxloom/core');
    expect(getTelemetryLevel()).toBe('off');
    track('project_evicted', { project_id: 'a', pinned_count: 0, cap: 2 });
    captureError(new Error('boom'));
    await new Promise(r => setImmediate(r));
    expect(postsTo('posthog.com').length).toBe(0);
    expect(postsTo('sentry.io').length).toBe(0);
    delete process.env.CTXLOOM_NO_TELEMETRY;
  });

  it('DO_NOT_TRACK=1 forces level=off (universal opt-out)', async () => {
    process.env.DO_NOT_TRACK = '1';
    const { getTelemetryLevel } = await import('@ctxloom/core');
    expect(getTelemetryLevel()).toBe('off');
    delete process.env.DO_NOT_TRACK;
  });

  it('unrecognized CTXLOOM_TELEMETRY_LEVEL value falls back to default (all)', async () => {
    process.env.CTXLOOM_TELEMETRY_LEVEL = 'banana';
    const { getTelemetryLevel } = await import('@ctxloom/core');
    expect(getTelemetryLevel()).toBe('all');
  });
});
