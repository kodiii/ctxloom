import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { loadTrendSeries } from '../packages/core/src/trends/TrendsStore.js';

function makeTmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'trends-store-'));
}

function writeJsonl(rootDir: string, lines: string[]): void {
  const dir = path.join(rootDir, '.ctxloom', 'trends');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'snapshots.jsonl'), lines.join('\n') + '\n');
}

function row(unixSeconds: number, overrides: Record<string, unknown> = {}): string {
  const base = {
    timestamp: new Date(unixSeconds * 1000).toISOString(),
    unixSeconds,
    totalFiles: 100,
    totalEdges: 200,
    deadFiles: 5,
    avgBusFactor: 2.0,
    highRiskFiles: 3,
    churnLinesLast7d: 1000,
    source: 'cli',
    gitSha: 'abc1234',
    ...overrides,
  };
  return JSON.stringify(base);
}

describe('loadTrendSeries', () => {
  let rootDir: string;
  beforeEach(() => { rootDir = makeTmpRoot(); });
  afterEach(() => { fs.rmSync(rootDir, { recursive: true, force: true }); });

  it('returns empty series when the file does not exist', async () => {
    const result = await loadTrendSeries({ rootDir });
    expect(result).toEqual({ snapshots: [], gitEnabled: false, totalCount: 0 });
  });

  it('parses a well-formed JSONL file and sorts ascending', async () => {
    writeJsonl(rootDir, [row(2000), row(1000), row(3000)]);
    const result = await loadTrendSeries({ rootDir, sinceUnixSeconds: 0 });
    expect(result.snapshots.map(s => s.unixSeconds)).toEqual([1000, 2000, 3000]);
    expect(result.totalCount).toBe(3);
  });

  it('filters by sinceUnixSeconds', async () => {
    writeJsonl(rootDir, [row(1000), row(2000), row(3000)]);
    const result = await loadTrendSeries({ rootDir, sinceUnixSeconds: 1500 });
    expect(result.snapshots.map(s => s.unixSeconds)).toEqual([2000, 3000]);
    expect(result.totalCount).toBe(3);
  });

  it('returns the newest N rows when limit < series length', async () => {
    writeJsonl(rootDir, [row(1000), row(2000), row(3000), row(4000)]);
    const result = await loadTrendSeries({ rootDir, sinceUnixSeconds: 0, limit: 2 });
    expect(result.snapshots.map(s => s.unixSeconds)).toEqual([3000, 4000]);
    expect(result.totalCount).toBe(4);
  });

  it('skips malformed lines without throwing', async () => {
    writeJsonl(rootDir, [row(1000), 'not json', '{"missing":"fields"}', row(2000)]);
    const result = await loadTrendSeries({ rootDir, sinceUnixSeconds: 0 });
    expect(result.snapshots.map(s => s.unixSeconds)).toEqual([1000, 2000]);
  });

  it('reports gitEnabled=false when newest retained row has null git fields', async () => {
    writeJsonl(rootDir, [row(1000, { avgBusFactor: null, highRiskFiles: null, churnLinesLast7d: null, gitSha: null })]);
    const result = await loadTrendSeries({ rootDir, sinceUnixSeconds: 0 });
    expect(result.gitEnabled).toBe(false);
  });

  it('reports gitEnabled=true when newest retained row has any non-null git field', async () => {
    writeJsonl(rootDir, [row(1000, { avgBusFactor: 1.5 })]);
    const result = await loadTrendSeries({ rootDir, sinceUnixSeconds: 0 });
    expect(result.gitEnabled).toBe(true);
  });
});
