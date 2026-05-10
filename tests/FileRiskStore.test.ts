import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { loadFileRiskHistory } from '../packages/core/src/trends/FileRiskStore.js';

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'file-risk-store-'));
}

function writeJsonl(rootDir: string, lines: string[]): void {
  const dir = path.join(rootDir, '.ctxloom', 'trends');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'file-risks.jsonl'), lines.join('\n') + '\n');
}

describe('loadFileRiskHistory', () => {
  let rootDir: string;
  beforeEach(() => { rootDir = tmpRoot(); });
  afterEach(() => { fs.rmSync(rootDir, { recursive: true, force: true }); });

  it('returns empty when sidecar file is missing', async () => {
    const r = await loadFileRiskHistory({ rootDir, file: 'src/foo.ts' });
    expect(r.points).toEqual([]);
    expect(r.totalCount).toBe(0);
  });

  it('returns ascending points for the requested file only', async () => {
    writeJsonl(rootDir, [
      JSON.stringify({ unixSeconds: 200, file: 'src/a.ts', score: 0.30, label: 'medium' }),
      JSON.stringify({ unixSeconds: 100, file: 'src/a.ts', score: 0.20, label: 'low' }),
      JSON.stringify({ unixSeconds: 150, file: 'src/b.ts', score: 0.50, label: 'high' }),
      JSON.stringify({ unixSeconds: 300, file: 'src/a.ts', score: 0.85, label: 'critical' }),
    ]);
    const r = await loadFileRiskHistory({ rootDir, file: 'src/a.ts' });
    expect(r.points.map(p => p.unixSeconds)).toEqual([100, 200, 300]);
    expect(r.points[2].label).toBe('critical');
    expect(r.totalCount).toBe(3);
  });

  it('filters by sinceUnixSeconds', async () => {
    writeJsonl(rootDir, [
      JSON.stringify({ unixSeconds: 100, file: 'a.ts', score: 0.1, label: 'low' }),
      JSON.stringify({ unixSeconds: 200, file: 'a.ts', score: 0.3, label: 'medium' }),
      JSON.stringify({ unixSeconds: 300, file: 'a.ts', score: 0.6, label: 'high' }),
    ]);
    const r = await loadFileRiskHistory({ rootDir, file: 'a.ts', sinceUnixSeconds: 200 });
    expect(r.points.map(p => p.unixSeconds)).toEqual([200, 300]);
    expect(r.totalCount).toBe(3); // total ignores the time filter
  });

  it('skips malformed lines without throwing', async () => {
    writeJsonl(rootDir, [
      JSON.stringify({ unixSeconds: 100, file: 'a.ts', score: 0.5, label: 'high' }),
      'this is not json',
      JSON.stringify({ what: 'wrong shape' }),
      JSON.stringify({ unixSeconds: 200, file: 'a.ts', score: 0.6, label: 'high' }),
    ]);
    const r = await loadFileRiskHistory({ rootDir, file: 'a.ts' });
    expect(r.points).toHaveLength(2);
  });

  it('respects limit by returning the newest N points', async () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ unixSeconds: 100 + i, file: 'a.ts', score: i / 10, label: 'medium' }),
    );
    writeJsonl(rootDir, lines);
    const r = await loadFileRiskHistory({ rootDir, file: 'a.ts', limit: 3 });
    expect(r.points.map(p => p.unixSeconds)).toEqual([107, 108, 109]);
    expect(r.totalCount).toBe(10);
  });
});
