import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CapturedPostHogEvent {
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
}

function parsePostHogEvents(fetchSpy: ReturnType<typeof vi.spyOn>): CapturedPostHogEvent[] {
  return fetchSpy.mock.calls
    .filter(c => typeof c[0] === 'string' && (c[0] as string).includes('posthog.com'))
    .map(c => JSON.parse((c[1] as RequestInit).body as string) as CapturedPostHogEvent);
}

describe('multi-project telemetry integration', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let tmpHome: string;
  let originalHome: string | undefined;

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

  it('LRU eviction fires project_evicted with the expected payload shape', async () => {
    const { ProjectStateManager, hashProjectRoot } = await import('@ctxloom/core');
    const manager = new ProjectStateManager({ maxProjects: 2, onDispose: async () => {} });
    manager.get('/tmp/p1');
    manager.get('/tmp/p2');
    manager.get('/tmp/p3'); // evicts p1

    await new Promise(r => setTimeout(r, 50));

    const events = parsePostHogEvents(fetchSpy);
    const eviction = events.find(e => e.event === 'project_evicted');
    expect(eviction).toBeDefined();
    expect(eviction!.properties.project_id).toBe(hashProjectRoot('/tmp/p1'));
    expect(eviction!.properties.pinned_count).toBe(0);
    expect(eviction!.properties.cap).toBe(2);
    expect(eviction!.properties.release).toBeDefined();
    expect(eviction!.distinct_id).toMatch(UUID_V4);
  });

  it('every event includes properties.release', async () => {
    const { track } = await import('@ctxloom/core');
    track('project_first_touch', { project_id: 'abc', tier: 'graph', duration_ms: 100 });
    track('multi_project_active', { active_count: 2, cap: 5 });
    track('tool_dispatched', { project_id: 'abc', tool: 'ctx_search', duration_ms: 12 });
    await new Promise(r => setImmediate(r));
    const events = parsePostHogEvents(fetchSpy).filter(e => e.event !== '$create_alias');
    expect(events.length).toBeGreaterThanOrEqual(3);
    for (const e of events) {
      expect(e.properties.release).toBeDefined();
      expect(typeof e.properties.release).toBe('string');
    }
  });

  it('opt-out short-circuits both track and captureError', async () => {
    process.env.CTXLOOM_NO_TELEMETRY = '1';
    vi.resetModules();
    const { track, captureError } = await import('@ctxloom/core');
    track('project_resolved', { project_id: 'x', source: 'cwd', via_alias: false });
    captureError(new Error('test'), { phase: 'x' });
    await new Promise(r => setImmediate(r));
    const calls = fetchSpy.mock.calls;
    expect(calls.filter(c => typeof c[0] === 'string' && (c[0] as string).includes('posthog.com'))).toHaveLength(0);
    expect(calls.filter(c => typeof c[0] === 'string' && (c[0] as string).includes('sentry.io'))).toHaveLength(0);
    delete process.env.CTXLOOM_NO_TELEMETRY;
  });
});
