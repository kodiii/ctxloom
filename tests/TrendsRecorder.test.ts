import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { recordTrendSnapshot } from '../packages/core/src/trends/TrendsRecorder.js';
import type { RecordOptions, TrendSource } from '../packages/core/src/trends/types.js';

interface FakeOverlayShape {
  ownership: { allNodes(): string[]; statsFor(node: string): { busFactor: number } | null };
  churn: { allNodes?(): string[]; statsFor(node: string): { churnLines: number; bugDensity: number; lastTouch: number; commits: number; bugCommits: number; authorEntropy: number } | null };
  coChange: { topFor(args: unknown): unknown[] };
}

function fakeGraph(opts: { files: string[]; edges?: number; importers?: Record<string, number>; imports?: Record<string, number> }): any {
  return {
    allFiles: () => opts.files,
    edgeCount: () => opts.edges ?? 0,
    getImporters: (f: string) => Array.from({ length: opts.importers?.[f] ?? 0 }, (_, i) => `imp${i}`),
    getImports: (f: string) => Array.from({ length: opts.imports?.[f] ?? 0 }, (_, i) => `dep${i}`),
  };
}

function fakeOverlay(opts: { ownership?: Record<string, number>; churn?: Record<string, { churnLines: number; bugDensity: number; lastTouch: number }>; coChange?: Record<string, number> } = {}): FakeOverlayShape {
  return {
    ownership: {
      allNodes: () => Object.keys(opts.ownership ?? {}),
      statsFor: (n: string) => (opts.ownership?.[n] === undefined ? null : { busFactor: opts.ownership[n] }),
    },
    churn: {
      allNodes: () => Object.keys(opts.churn ?? {}),
      statsFor: (n: string) => {
        const v = opts.churn?.[n];
        if (v === undefined) return null;
        return { ...v, commits: 0, bugCommits: 0, authorEntropy: 0 };
      },
    },
    coChange: { topFor: (q: any) => Array.from({ length: opts.coChange?.[q.node] ?? 0 }, () => ({})) },
  };
}

function makeTmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'trends-recorder-'));
}

function readJsonl(rootDir: string): string[] {
  const file = path.join(rootDir, '.ctxloom', 'trends', 'snapshots.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf-8').split('\n').filter(l => l.trim());
}

function makeOpts(overrides: Partial<RecordOptions> & { rootDir: string; source?: TrendSource }): RecordOptions {
  return {
    graph: overrides.graph ?? fakeGraph({ files: [] }),
    overlay: (overrides.overlay ?? fakeOverlay()) as any,
    gitEnabled: overrides.gitEnabled ?? false,
    rootDir: overrides.rootDir,
    source: overrides.source ?? 'cli',
    now: overrides.now,
  };
}

describe('recordTrendSnapshot — basic append', () => {
  let rootDir: string;
  beforeEach(() => { rootDir = makeTmpRoot(); });
  afterEach(() => { fs.rmSync(rootDir, { recursive: true, force: true }); });

  it('writes the first snapshot to a fresh directory', async () => {
    const result = await recordTrendSnapshot(makeOpts({
      rootDir,
      graph: fakeGraph({ files: ['a.ts'], edges: 1 }),
      now: () => 1_000_000_000_000,
    }));
    expect(result).not.toBeNull();
    const lines = readJsonl(rootDir);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.unixSeconds).toBe(1_000_000_000);
    expect(parsed.totalFiles).toBe(1);
    expect(parsed.totalEdges).toBe(1);
    expect(parsed.source).toBe('cli');
  });

  it('creates .ctxloom/trends/ when it does not exist', async () => {
    expect(fs.existsSync(path.join(rootDir, '.ctxloom', 'trends'))).toBe(false);
    await recordTrendSnapshot(makeOpts({ rootDir }));
    expect(fs.existsSync(path.join(rootDir, '.ctxloom', 'trends', 'snapshots.jsonl'))).toBe(true);
  });
});

describe('recordTrendSnapshot — collapse logic', () => {
  let rootDir: string;
  beforeEach(() => { rootDir = makeTmpRoot(); });
  afterEach(() => { fs.rmSync(rootDir, { recursive: true, force: true }); });

  it('collapses a second snapshot within 5 min and <1% delta', async () => {
    await recordTrendSnapshot(makeOpts({
      rootDir,
      graph: fakeGraph({ files: ['a.ts'], edges: 100 }),
      now: () => 1_000_000_000_000,
    }));
    await recordTrendSnapshot(makeOpts({
      rootDir,
      graph: fakeGraph({ files: ['a.ts'], edges: 100 }),
      now: () => 1_000_000_060_000,
    }));
    expect(readJsonl(rootDir)).toHaveLength(1);
  });

  it('appends when more than 5 minutes elapsed regardless of delta', async () => {
    await recordTrendSnapshot(makeOpts({
      rootDir,
      graph: fakeGraph({ files: ['a.ts'], edges: 100 }),
      now: () => 1_000_000_000_000,
    }));
    await recordTrendSnapshot(makeOpts({
      rootDir,
      graph: fakeGraph({ files: ['a.ts'], edges: 100 }),
      now: () => 1_000_000_000_000 + 301 * 1000,
    }));
    expect(readJsonl(rootDir)).toHaveLength(2);
  });

  it('appends within 5 min when an integer metric changes by ≥ 1', async () => {
    await recordTrendSnapshot(makeOpts({
      rootDir,
      graph: fakeGraph({ files: ['a.ts'], edges: 100 }),
      now: () => 1_000_000_000_000,
    }));
    await recordTrendSnapshot(makeOpts({
      rootDir,
      graph: fakeGraph({ files: ['a.ts', 'b.ts'], edges: 100 }),
      now: () => 1_000_000_060_000,
    }));
    expect(readJsonl(rootDir)).toHaveLength(2);
  });

  it('appends within 5 min when a numeric metric changes by > 1%', async () => {
    await recordTrendSnapshot(makeOpts({
      rootDir,
      graph: fakeGraph({ files: ['a.ts'], edges: 100 }),
      now: () => 1_000_000_000_000,
    }));
    await recordTrendSnapshot(makeOpts({
      rootDir,
      graph: fakeGraph({ files: ['a.ts'], edges: 102 }),
      now: () => 1_000_000_060_000,
    }));
    expect(readJsonl(rootDir)).toHaveLength(2);
  });

  it('appends when avgBusFactor flips between number and null', async () => {
    await recordTrendSnapshot(makeOpts({
      rootDir,
      graph: fakeGraph({ files: ['a.ts'], edges: 100 }),
      overlay: fakeOverlay({ ownership: { 'a.ts': 2 } }),
      gitEnabled: true,
      now: () => 1_000_000_000_000,
    }));
    await recordTrendSnapshot(makeOpts({
      rootDir,
      graph: fakeGraph({ files: ['a.ts'], edges: 100 }),
      gitEnabled: false,
      now: () => 1_000_000_060_000,
    }));
    expect(readJsonl(rootDir)).toHaveLength(2);
  });
});

describe('recordTrendSnapshot — git-disabled and error paths', () => {
  let rootDir: string;
  beforeEach(() => { rootDir = makeTmpRoot(); });
  afterEach(() => { fs.rmSync(rootDir, { recursive: true, force: true }); });

  it('records null git fields when gitEnabled=false', async () => {
    const result = await recordTrendSnapshot(makeOpts({
      rootDir,
      graph: fakeGraph({ files: ['a.ts'] }),
      gitEnabled: false,
    }));
    expect(result).not.toBeNull();
    expect(result!.avgBusFactor).toBeNull();
    expect(result!.highRiskFiles).toBeNull();
    expect(result!.churnLinesLast7d).toBeNull();
  });

  it('returns null and does not throw when the filesystem rejects writes', async () => {
    // Use a path that cannot be created (regular file segment in the middle).
    const blocker = path.join(rootDir, 'blocker');
    fs.writeFileSync(blocker, 'not a directory');
    const insideBlocker = path.join(blocker, 'cannot-create-here');
    const result = await recordTrendSnapshot(makeOpts({
      rootDir: insideBlocker,
      graph: fakeGraph({ files: [] }),
    }));
    expect(result).toBeNull();
  });
});
