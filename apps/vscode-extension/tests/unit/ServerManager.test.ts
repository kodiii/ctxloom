import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { ServerManager } from '../../src/client/ServerManager.js';

interface FakeClient extends EventEmitter {
  callTool(args: { name: string; arguments: Record<string, unknown> }): Promise<{ content: unknown }>;
  close(): Promise<void>;
  __closed: boolean;
}

function makeFakeClient(): FakeClient {
  const c = new EventEmitter() as FakeClient;
  c.__closed = false;
  c.callTool = vi.fn(async ({ name }) => ({ content: { tool: name } }));
  c.close = vi.fn(async () => { c.__closed = true; });
  return c;
}

interface StubbedSpawnerHandle {
  fakeClient: FakeClient;
  spawnCalls: number;
  triggerCrash(reason?: string): void;
}

function makeStubbedSpawner(): { spawn: () => Promise<FakeClient>; handle: StubbedSpawnerHandle } {
  const handle: StubbedSpawnerHandle = {
    fakeClient: makeFakeClient(),
    spawnCalls: 0,
    triggerCrash(reason = 'crash') { handle.fakeClient.emit('error', new Error(reason)); },
  };
  const spawn = async () => {
    handle.spawnCalls++;
    const oldCallTool = handle.fakeClient.callTool;
    const newClient = makeFakeClient();
    newClient.callTool = oldCallTool;
    handle.fakeClient = newClient;
    return handle.fakeClient;
  };
  return { spawn, handle };
}

describe('ServerManager', () => {
  let logged: string[];
  beforeEach(() => { logged = []; });
  afterEach(() => { vi.useRealTimers(); });

  function logger() { return { info: (m: string) => logged.push('info: ' + m), warn: (m: string) => logged.push('warn: ' + m), error: (m: string) => logged.push('error: ' + m) }; }

  it('spawns the child on start() and exposes callTool', async () => {
    const { spawn, handle } = makeStubbedSpawner();
    const sm = new ServerManager({ spawner: spawn, logger: logger() });
    await sm.start();
    const result = await sm.callTool('ctx_status', {});
    expect(handle.spawnCalls).toBe(1);
    expect(result).toEqual({ content: { tool: 'ctx_status' } });
    await sm.dispose();
  });

  it('auto-restarts on child error up to 3 times within 60s', async () => {
    vi.useFakeTimers();
    const { spawn, handle } = makeStubbedSpawner();
    const sm = new ServerManager({ spawner: spawn, logger: logger() });
    await sm.start();
    handle.triggerCrash();
    await vi.advanceTimersByTimeAsync(50);
    handle.triggerCrash();
    await vi.advanceTimersByTimeAsync(50);
    handle.triggerCrash();
    await vi.advanceTimersByTimeAsync(50);
    expect(handle.spawnCalls).toBe(4); // initial + 3 restarts
    await sm.dispose();
  });

  it('stops restarting after 3 failures within 60s and reports unavailable', async () => {
    vi.useFakeTimers();
    const { spawn, handle } = makeStubbedSpawner();
    const sm = new ServerManager({ spawner: spawn, logger: logger() });
    await sm.start();
    for (let i = 0; i < 4; i++) {
      handle.triggerCrash();
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(handle.spawnCalls).toBe(4); // initial + only 3 restarts; the 4th crash is NOT restarted
    expect(sm.isAvailable()).toBe(false);
    await sm.dispose();
  });

  it('resets the restart counter after 30 seconds of stable uptime', async () => {
    vi.useFakeTimers();
    const { spawn, handle } = makeStubbedSpawner();
    const sm = new ServerManager({ spawner: spawn, logger: logger() });
    await sm.start();
    handle.triggerCrash(); await vi.advanceTimersByTimeAsync(30_001);
    handle.triggerCrash(); await vi.advanceTimersByTimeAsync(30_001);
    handle.triggerCrash(); await vi.advanceTimersByTimeAsync(30_001);
    handle.triggerCrash(); await vi.advanceTimersByTimeAsync(50);
    // Counter resets after each 30s stable window, so all 4 crashes get restarted
    expect(handle.spawnCalls).toBe(5);
    expect(sm.isAvailable()).toBe(true);
    await sm.dispose();
  });

  it('rejects callTool with timeout after 10 seconds', async () => {
    vi.useFakeTimers();
    const { spawn, handle } = makeStubbedSpawner();
    handle.fakeClient.callTool = vi.fn(() => new Promise<{ content: unknown }>(() => { /* never resolves */ }));
    const sm = new ServerManager({ spawner: spawn, logger: logger() });
    await sm.start();
    const promise = sm.callTool('ctx_status', {});
    await vi.advanceTimersByTimeAsync(10_001);
    await expect(promise).rejects.toThrow(/timeout/i);
    await sm.dispose();
  });

  it('dispose closes the underlying client exactly once', async () => {
    const { spawn, handle } = makeStubbedSpawner();
    const sm = new ServerManager({ spawner: spawn, logger: logger() });
    await sm.start();
    const client = handle.fakeClient;
    await sm.dispose();
    await sm.dispose(); // idempotent
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(client.__closed).toBe(true);
  });

  it('callTool after dispose rejects', async () => {
    const { spawn } = makeStubbedSpawner();
    const sm = new ServerManager({ spawner: spawn, logger: logger() });
    await sm.start();
    await sm.dispose();
    await expect(sm.callTool('ctx_status', {})).rejects.toThrow(/disposed/i);
  });

  it('logs each restart with the cause', async () => {
    vi.useFakeTimers();
    const { spawn, handle } = makeStubbedSpawner();
    const sm = new ServerManager({ spawner: spawn, logger: logger() });
    await sm.start();
    handle.triggerCrash('boom');
    await vi.advanceTimersByTimeAsync(50);
    expect(logged.some(l => l.includes('boom'))).toBe(true);
    await sm.dispose();
  });
});
