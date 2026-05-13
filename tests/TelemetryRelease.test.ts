import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('telemetry release tag', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    process.env.POSTHOG_API_KEY = 'phc_test';
    process.env.SENTRY_DSN = 'https://abc@o1.ingest.sentry.io/123';
    delete process.env.CTXLOOM_NO_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.POSTHOG_API_KEY;
    delete process.env.SENTRY_DSN;
  });

  it('Sentry payload includes tags.release', async () => {
    const { captureError } = await import('@ctxloom/core');
    captureError(new Error('boom'), { phase: 'test' });
    await new Promise(r => setImmediate(r));
    expect(fetchSpy).toHaveBeenCalled();
    const sentryCall = fetchSpy.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('sentry.io')
    );
    expect(sentryCall).toBeDefined();
    const body = JSON.parse((sentryCall![1] as RequestInit).body as string);
    expect(body.tags.release).toBeDefined();
    expect(typeof body.tags.release).toBe('string');
    expect(body.tags.release.length).toBeGreaterThan(0);
  });

  it('PostHog payload includes properties.release', async () => {
    const { track } = await import('@ctxloom/core');
    track('trial_started', 'test-host', { email: 'x@y.z' });
    await new Promise(r => setImmediate(r));
    const posthogCall = fetchSpy.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('posthog.com')
    );
    expect(posthogCall).toBeDefined();
    const body = JSON.parse((posthogCall![1] as RequestInit).body as string);
    expect(body.properties.release).toBeDefined();
    expect(typeof body.properties.release).toBe('string');
  });
});
