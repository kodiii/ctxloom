import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * End-to-end migration flow: cold install → first event fires $create_alias and
 * persists the new identity → on-disk `alias_pending` is cleared after the alias
 * call succeeds → subsequent events reuse the cached UUID with no re-alias.
 *
 * This complements `tests/TelemetryDistinctId.test.ts` (which mocks the fetch
 * layer) by asserting on the on-disk file state — i.e. that `markAliasSent`
 * is actually being called after a 2xx response from the alias endpoint.
 */
describe('distinct_id migration — on-disk state', () => {
  let tmpHome: string;
  let originalHome: string | undefined;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-mig-'));
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

  it('cold install → first track() persists UUID and clears alias_pending after $create_alias succeeds', async () => {
    const distinctIdPath = path.join(tmpHome, '.ctxloom', 'distinct_id');
    expect(fs.existsSync(distinctIdPath)).toBe(false);

    const { track } = await import('@ctxloom/core');
    track('project_evicted', { project_id: 'abc', pinned_count: 0, cap: 2 });

    // Two awaits: one for sendPostHog (event), one for sendAlias.
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));

    const phCalls = fetchSpy.mock.calls
      .filter(c => typeof c[0] === 'string' && (c[0] as string).includes('posthog.com'))
      .map(c => JSON.parse((c[1] as RequestInit).body as string));
    const aliasEvent = phCalls.find(e => e.event === '$create_alias');
    const evictedEvent = phCalls.find(e => e.event === 'project_evicted');
    expect(aliasEvent).toBeDefined();
    expect(evictedEvent).toBeDefined();
    expect(aliasEvent.properties.alias).toBe(os.hostname());

    // On-disk file: id is a v4 UUID; alias_pending field is gone.
    expect(fs.existsSync(distinctIdPath)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(distinctIdPath, 'utf8'));
    expect(onDisk.id).toMatch(UUID_V4);
    expect(onDisk.id).toBe(aliasEvent.distinct_id);
    expect(onDisk.alias_pending).toBeUndefined();
  });

  it('second track() in the same process does not re-read the file or re-alias', async () => {
    const { track } = await import('@ctxloom/core');
    track('project_evicted', { project_id: 'abc', pinned_count: 0, cap: 2 });
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    fetchSpy.mockClear();

    track('tool_dispatched', { project_id: 'abc', tool: 'ctx_search', duration_ms: 5 });
    await new Promise(r => setImmediate(r));

    const phCalls = fetchSpy.mock.calls
      .filter(c => typeof c[0] === 'string' && (c[0] as string).includes('posthog.com'))
      .map(c => JSON.parse((c[1] as RequestInit).body as string));
    expect(phCalls).toHaveLength(1);
    expect(phCalls[0].event).toBe('tool_dispatched');
  });

  it('failed $create_alias leaves alias_pending on disk so the next track() retries', async () => {
    // First call: alias request fails with 500, event still goes through.
    fetchSpy.mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('posthog.com')) {
        // We can't reliably distinguish event vs alias by URL alone (same /capture/
        // endpoint), so fail every PostHog call this round.
        return Promise.resolve(new Response(null, { status: 500 }));
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    const { track } = await import('@ctxloom/core');
    track('project_evicted', { project_id: 'abc', pinned_count: 0, cap: 2 });
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));

    const distinctIdPath = path.join(tmpHome, '.ctxloom', 'distinct_id');
    const onDisk = JSON.parse(fs.readFileSync(distinctIdPath, 'utf8'));
    expect(onDisk.alias_pending).toBe(os.hostname());
  });
});
