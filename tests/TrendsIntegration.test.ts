/**
 * Trends pipeline smoke test — verifies that recordTrendSnapshot is called
 * from buildFromDirectory's afterReady callback and records a row correctly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { DependencyGraph, GitOverlayStore, recordTrendSnapshot } from '../packages/core/src/index.js';

describe('Trends pipeline smoke', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trends-smoke-'));
    fs.writeFileSync(path.join(rootDir, 'a.ts'), 'export const a = 1;');
    fs.writeFileSync(path.join(rootDir, 'b.ts'), "import { a } from './a.js'; export const b = a;");
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('records a row when buildFromDirectory afterReady fires', async () => {
    const graph = new DependencyGraph();
    const overlay = new GitOverlayStore(rootDir);
    const gitEnabled = await overlay.loadSnapshot();

    await graph.buildFromDirectory(rootDir, {
      afterReady: async () => {
        await recordTrendSnapshot({
          graph,
          overlay,
          gitEnabled,
          rootDir,
          source: 'cli',
        });
      },
    });

    const file = path.join(rootDir, '.ctxloom', 'trends', 'snapshots.jsonl');
    expect(fs.existsSync(file)).toBe(true);
    const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(l => l.trim());
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.source).toBe('cli');
    expect(parsed.totalFiles).toBeGreaterThanOrEqual(2);
    expect(typeof parsed.timestamp).toBe('string');
    expect(typeof parsed.unixSeconds).toBe('number');
  });
});
