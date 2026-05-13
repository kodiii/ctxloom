import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Sentry stack-frame scrubbing', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    process.env.SENTRY_DSN = 'https://abc@o1.ingest.sentry.io/123';
    delete process.env.CTXLOOM_NO_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.SENTRY_DSN;
  });

  async function captureWithStack(stack: string): Promise<Record<string, unknown>[]> {
    const { captureError } = await import('@ctxloom/core');
    const err = new Error('test');
    err.stack = `Error: test\n${stack}`;
    captureError(err);
    await new Promise(r => setImmediate(r));
    const call = fetchSpy.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('sentry.io')
    );
    const body = JSON.parse((call![1] as RequestInit).body as string);
    return body.exception.values[0].stacktrace.frames;
  }

  it('scrubs /Users/<username>/ to /Users/~/', async () => {
    const frames = await captureWithStack('    at foo (/Users/alice/code/proj/src/x.ts:10:5)');
    expect(frames[0].filename).toBe('/Users/~/code/proj/src/x.ts');
  });

  it('scrubs /home/<username>/ to /home/~/', async () => {
    const frames = await captureWithStack('    at foo (/home/bob/code/proj/src/x.ts:10:5)');
    expect(frames[0].filename).toBe('/home/~/code/proj/src/x.ts');
  });

  it('scrubs C:\\\\Users\\\\<username>\\\\ to C:\\\\Users\\\\~\\\\', async () => {
    const frames = await captureWithStack('    at foo (C:\\\\Users\\\\carol\\\\code\\\\proj\\\\x.ts:10:5)');
    expect(frames[0].filename).toBe('C:\\\\Users\\\\~\\\\code\\\\proj\\\\x.ts');
  });

  it('leaves non-matching paths unchanged', async () => {
    const frames = await captureWithStack('    at foo (/var/lib/node/x.ts:10:5)');
    expect(frames[0].filename).toBe('/var/lib/node/x.ts');
  });
});
