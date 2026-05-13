import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('telemetry distinct_id UUID', () => {
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
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    vi.resetModules();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    delete process.env.POSTHOG_API_KEY;
    delete process.env.SENTRY_DSN;
  });

  it('track() uses a v4 UUID as distinct_id, not the hostname', async () => {
    const { track } = await import('@ctxloom/core');
    track('project_evicted', { project_id: 'abc', pinned_count: 0, cap: 2 });
    await new Promise(r => setImmediate(r));
    const phCall = fetchSpy.mock.calls.find(c => typeof c[0] === 'string' && (c[0] as string).includes('posthog.com') && JSON.parse((c[1] as RequestInit).body as string).event === 'project_evicted');
    expect(phCall).toBeDefined();
    const body = JSON.parse((phCall![1] as RequestInit).body as string);
    expect(body.distinct_id).toMatch(UUID_V4);
    expect(body.distinct_id).not.toBe(os.hostname());
  });

  it('first track() also fires $create_alias with hostname as the alias', async () => {
    const { track } = await import('@ctxloom/core');
    track('project_evicted', { project_id: 'abc', pinned_count: 0, cap: 2 });
    await new Promise(r => setImmediate(r));
    const phCalls = fetchSpy.mock.calls
      .filter(c => typeof c[0] === 'string' && (c[0] as string).includes('posthog.com'))
      .map(c => JSON.parse((c[1] as RequestInit).body as string));
    const aliasEvent = phCalls.find(e => e.event === '$create_alias');
    expect(aliasEvent).toBeDefined();
    expect(aliasEvent.properties.alias).toBe(os.hostname());
    expect(aliasEvent.distinct_id).toMatch(UUID_V4);
    const eventCall = phCalls.find(e => e.event === 'project_evicted');
    expect(eventCall).toBeDefined();
    expect(eventCall.distinct_id).toBe(aliasEvent.distinct_id);
  });

  it('second track() does NOT re-fire $create_alias', async () => {
    const { track } = await import('@ctxloom/core');
    track('project_evicted', { project_id: 'abc', pinned_count: 0, cap: 2 });
    await new Promise(r => setImmediate(r));
    fetchSpy.mockClear();
    track('tool_dispatched', { project_id: 'abc', tool: 'ctx_search', duration_ms: 5 });
    await new Promise(r => setImmediate(r));
    const phCalls = fetchSpy.mock.calls
      .filter(c => typeof c[0] === 'string' && (c[0] as string).includes('posthog.com'))
      .map(c => JSON.parse((c[1] as RequestInit).body as string));
    const aliasEvent = phCalls.find(e => e.event === '$create_alias');
    expect(aliasEvent).toBeUndefined();
  });

  it('captureError includes distinct_id in Sentry extra context', async () => {
    const { captureError } = await import('@ctxloom/core');
    captureError(new Error('boom'), { phase: 'test' });
    await new Promise(r => setImmediate(r));
    const sentryCall = fetchSpy.mock.calls.find(c => typeof c[0] === 'string' && (c[0] as string).includes('sentry.io'));
    expect(sentryCall).toBeDefined();
    const body = JSON.parse((sentryCall![1] as RequestInit).body as string);
    expect(body.extra.distinct_id).toMatch(UUID_V4);
  });
});
