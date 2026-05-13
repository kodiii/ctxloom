import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('project_evicted telemetry', () => {
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

  it('fires project_evicted when LRU evicts a state', async () => {
    const { ProjectStateManager } = await import('@ctxloom/core');
    const manager = new ProjectStateManager({ maxProjects: 2, onDispose: async () => {} });
    manager.get('/tmp/projA');
    manager.get('/tmp/projB');
    manager.get('/tmp/projC'); // forces eviction of projA
    await new Promise(r => setTimeout(r, 50));

    const posthogCalls = fetchSpy.mock.calls.filter(c =>
      typeof c[0] === 'string' && c[0].includes('posthog.com')
    );
    const evictionCall = posthogCalls.find(c => {
      const body = JSON.parse((c[1] as RequestInit).body as string);
      return body.event === 'project_evicted';
    });
    expect(evictionCall).toBeDefined();
    const body = JSON.parse((evictionCall![1] as RequestInit).body as string);
    expect(body.properties.project_id).toMatch(/^[0-9a-f]{16}$/);
    expect(body.properties.pinned_count).toBe(0);
    expect(body.properties.cap).toBe(2);
    expect(body.distinct_id).toMatch(UUID_V4);
  });
});
