/**
 * Tests for FileWatcher — File system change detection.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileWatcher } from '../src/watcher/FileWatcher.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('FileWatcher', () => {
  let tempDir: string;
  let changes: Array<{ path: string; event: string }>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-watch-'));
    changes = [];
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should construct with root and callback', () => {
    const watcher = new FileWatcher(tempDir, () => {});
    expect(watcher.isRunning()).toBe(false);
  });

  it('should start and stop watching', () => {
    const watcher = new FileWatcher(tempDir, () => {});
    watcher.start();
    expect(watcher.isRunning()).toBe(true);
    watcher.stop();
    expect(watcher.isRunning()).toBe(false);
  });

  it('should detect file additions', async () => {
    const watcher = new FileWatcher(tempDir, (absPath, event) => {
      changes.push({ path: absPath, event });
    });
    watcher.start();

    // Wait for chokidar to finish its initial scan, then a short settling
    // buffer before writing.  On macOS/FSEvents there is a brief window after
    // 'ready' fires where the directory watch hasn't fully committed; without
    // this pause 'add' events fired immediately after ready are intermittently
    // missed.  All other async FileWatcher tests use the same 100ms buffer.
    await watcher.ready();
    await new Promise(r => setTimeout(r, 100));

    const newFile = path.join(tempDir, 'new-file.ts');
    fs.writeFileSync(newFile, 'export const x = 1;');

    // Wait for debounce (200ms) + chokidar processing buffer (extra headroom under load)
    await new Promise(r => setTimeout(r, 1500));

    watcher.stop();

    expect(changes.length).toBeGreaterThanOrEqual(1);
    expect(changes.some(c => c.event === 'add' && c.path === newFile)).toBe(true);
  });

  it('should detect file changes', async () => {
    const existingFile = path.join(tempDir, 'existing.ts');
    fs.writeFileSync(existingFile, 'export const x = 1;');

    const watcher = new FileWatcher(tempDir, (absPath, event) => {
      changes.push({ path: absPath, event });
    });
    watcher.start();

    await watcher.ready();
    // Small settling buffer after ready so chokidar commits initial file state
    await new Promise(r => setTimeout(r, 100));

    fs.writeFileSync(existingFile, 'export const x = 2;');

    await new Promise(r => setTimeout(r, 600));

    watcher.stop();

    expect(changes.some(c => c.event === 'change' && c.path === existingFile)).toBe(true);
  });

  it('should ignore non-source files', async () => {
    const watcher = new FileWatcher(tempDir, (absPath, event) => {
      changes.push({ path: absPath, event });
    });
    watcher.start();

    await watcher.ready();

    const binFile = path.join(tempDir, 'data.bin');
    fs.writeFileSync(binFile, Buffer.from([0, 1, 2, 3]));

    await new Promise(r => setTimeout(r, 600));

    watcher.stop();

    expect(changes.some(c => c.path === binFile)).toBe(false);
  });

  it('should detect file deletions (unlink)', async () => {
    const existingFile = path.join(tempDir, 'to-delete.ts');
    fs.writeFileSync(existingFile, 'export const x = 1;');

    const watcher = new FileWatcher(tempDir, (absPath, event) => {
      changes.push({ path: absPath, event });
    });
    watcher.start();

    await watcher.ready();
    // Small settling buffer after ready so chokidar commits initial file state
    await new Promise(r => setTimeout(r, 100));

    fs.unlinkSync(existingFile);

    await new Promise(r => setTimeout(r, 600));

    watcher.stop();

    expect(changes.some(c => c.event === 'unlink' && c.path === existingFile)).toBe(true);
  });

  it('should not be running after stop()', () => {
    const watcher = new FileWatcher(tempDir, () => {});
    watcher.start();
    watcher.stop();
    expect(watcher.isRunning()).toBe(false);
  });
});
