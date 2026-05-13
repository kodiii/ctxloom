import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { onInstallationDeleted } from '../src/handlers/installationDeleted.js';

interface MockContext {
  payload: { installation: { id: number } };
  log: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
}

function makeContext(installationId: number): MockContext {
  return {
    payload: { installation: { id: installationId } },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe('onInstallationDeleted', () => {
  let tmpDir: string;
  let originalCacheDir: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctxloom-bot-'));
    originalCacheDir = process.env['CTXLOOM_CACHE_DIR'];
    process.env['CTXLOOM_CACHE_DIR'] = tmpDir;
  });

  afterEach(async () => {
    if (originalCacheDir !== undefined) process.env['CTXLOOM_CACHE_DIR'] = originalCacheDir;
    else delete process.env['CTXLOOM_CACHE_DIR'];
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('removes the installation directory when it exists', async () => {
    const installId = 12345;
    const installDir = path.join(tmpDir, String(installId));
    await fs.mkdir(path.join(installDir, 'repo-1', 'abc'), { recursive: true });
    await fs.writeFile(path.join(installDir, 'repo-1', 'abc', 'graph.json'), '{}');

    const context = makeContext(installId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await onInstallationDeleted(context as any);

    await expect(fs.access(installDir)).rejects.toThrow();
  });

  it('does not throw when the installation directory never existed', async () => {
    // ENOENT is swallowed by `fs.rm` with force: true. The handler should
    // log success and return cleanly — uninstall events on installations
    // we never received a webhook for should be a no-op, not a crash.
    const context = makeContext(99999);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(onInstallationDeleted(context as any)).resolves.toBeUndefined();
    expect(context.log.info).toHaveBeenCalledTimes(2); // start + complete
  });

  it('honors CTXLOOM_CACHE_DIR override', async () => {
    const customDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctxloom-bot-custom-'));
    process.env['CTXLOOM_CACHE_DIR'] = customDir;
    const installId = 555;
    const installDir = path.join(customDir, String(installId));
    await fs.mkdir(installDir, { recursive: true });

    const context = makeContext(installId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await onInstallationDeleted(context as any);

    await expect(fs.access(installDir)).rejects.toThrow();
    await fs.rm(customDir, { recursive: true, force: true });
  });
});
