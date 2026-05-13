import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('alias_registered telemetry', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let tmpHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    process.env.POSTHOG_API_KEY = 'phc_test';
    delete process.env.CTXLOOM_NO_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    vi.resetModules();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    delete process.env.POSTHOG_API_KEY;
  });

  it('alias_registered payload includes alias_length, was_collision, and UUID distinctId', async () => {
    const { track } = await import('@ctxloom/core');
    track('alias_registered', { alias_length: 5, was_collision: false });
    await new Promise(r => setImmediate(r));
    const phCalls = fetchSpy.mock.calls.filter(c =>
      typeof c[0] === 'string' && (c[0] as string).includes('posthog.com')
    );
    const call = phCalls.find(c => {
      const body = JSON.parse((c[1] as RequestInit).body as string);
      return body.event === 'alias_registered';
    });
    expect(call).toBeDefined();
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body.event).toBe('alias_registered');
    expect(body.distinct_id).toMatch(UUID_V4);
    expect(body.properties.alias_length).toBe(5);
    expect(body.properties.was_collision).toBe(false);
    expect(body.properties.release).toBeDefined();
  });
});
