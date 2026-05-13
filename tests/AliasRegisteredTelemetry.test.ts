import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';

describe('alias_registered telemetry', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.POSTHOG_API_KEY = 'phc_test';
    delete process.env.CTXLOOM_NO_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.POSTHOG_API_KEY;
  });

  it('alias_registered payload includes alias_length, was_collision, and hostname distinctId', async () => {
    const { track } = await import('@ctxloom/core');
    track('alias_registered', os.hostname(), { alias_length: 5, was_collision: false });
    await new Promise(r => setImmediate(r));
    const call = fetchSpy.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('posthog.com')
    );
    expect(call).toBeDefined();
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body.event).toBe('alias_registered');
    expect(body.distinct_id).toBe(os.hostname());
    expect(body.properties.alias_length).toBe(5);
    expect(body.properties.was_collision).toBe(false);
    expect(body.properties.release).toBeDefined();
  });
});
