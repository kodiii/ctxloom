# Dashboard Debt Trends Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Trends page to the ctxloom dashboard that charts dead files, average bus factor, high-risk files, and weekly churn over time. Recording is hooked into the existing indexing pipeline so trends stay continuously fresh without a separate scheduler.

**Architecture:** New `packages/core/src/trends/` module exposes `recordTrendSnapshot` (write path) and `loadTrendSeries` (read path). Recording runs as a side-effect of every indexing event (CLI, MCP, dashboard, watcher) and writes append-only JSONL to `.ctxloom/trends/snapshots.jsonl`. Dashboard reads via a new `/api/trends` route and renders a 2×2 grid of sparkline cards.

**Tech Stack:** TypeScript 5.7, Node 20+, ESM, vitest, Express, React 18, recharts (already a dependency), supertest, @testing-library/react.

**Spec:** [docs/superpowers/specs/2026-04-25-dashboard-debt-trends-design.md](../specs/2026-04-25-dashboard-debt-trends-design.md)

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `packages/core/src/trends/types.ts` | Public types: `TrendSnapshot`, `TrendSeries`, `TrendSource`, `RecordOptions`, `LoadOptions` |
| `packages/core/src/trends/TrendsRecorder.ts` | `recordTrendSnapshot()` — compute metrics, append/collapse to JSONL |
| `packages/core/src/trends/TrendsStore.ts` | `loadTrendSeries()` — stream-parse JSONL, bounded + sorted |
| `packages/core/src/trends/index.ts` | Barrel re-exporting public surface |
| `tests/TrendsRecorder.test.ts` | Unit tests for recorder (~8 tests) |
| `tests/TrendsStore.test.ts` | Unit tests for store (~6 tests) |
| `tests/TrendsIntegration.test.ts` | End-to-end smoke test that pipeline records a row |
| `apps/dashboard/server/routes/trends.ts` | Express router for `GET /api/trends` |
| `apps/dashboard/tests/routes.trends.test.ts` | Route tests (~4 tests) |
| `apps/dashboard/client/src/lib/trendDelta.ts` | `computeDelta()` helper for delta-badge rendering |
| `apps/dashboard/tests/trendDelta.test.ts` | Unit tests for the delta helper (~5 tests) |
| `apps/dashboard/client/src/components/SparklineCard.tsx` | One trend card (label, value, badge, sparkline) |
| `apps/dashboard/client/src/components/TrendsRangePicker.tsx` | 7d / 30d / 90d segment control |
| `apps/dashboard/client/src/pages/Trends.tsx` | The /trends page composing 4 cards + range picker |
| `apps/dashboard/tests/Trends.test.tsx` | Component tests (~4 tests) |

### Modified files

| Path | Change |
|---|---|
| `packages/core/src/graph/DependencyGraph.ts` | Extend `buildFromDirectory(rootDir, options?)` with optional `afterReady` callback. Fire it on both snapshot-load and full-build success paths. |
| `packages/core/src/index.ts` | Add exports: `recordTrendSnapshot`, `loadTrendSeries`, `TrendSnapshot`, `TrendSeries`, `TrendSource` |
| `src/index.ts` | Wire `afterReady` callback at both `buildFromDirectory` call sites (lines 342, 669) with `source: 'cli'` |
| `src/server.ts` | Wire `afterReady` callback in `getGraph()` factory with `source: 'mcp'`. Add `recordTrendSnapshot` call after watcher's `updateFile` with `source: 'watcher'` |
| `apps/dashboard/server/loader.ts` | Wire `afterReady` callback in `loadContext` and `reloadContext` with `source: 'dashboard'` |
| `apps/dashboard/server/index.ts` | Mount `/api/trends` router |
| `apps/dashboard/server/types.ts` | Add `TrendsResponse` interface |
| `apps/dashboard/client/src/lib/api.ts` | Add `trends(range)` method |
| `apps/dashboard/client/src/App.tsx` | Add `<Route path="trends" element={<Trends />} />` |
| `apps/dashboard/client/src/components/Layout.tsx` | Insert `{ to: '/trends', label: 'Trends', icon: '⤴' }` between Risk and Communities |

---

## Task 1: Trends types and module skeleton

**Files:**
- Create: `packages/core/src/trends/types.ts`
- Create: `packages/core/src/trends/TrendsRecorder.ts` (skeleton only)
- Create: `packages/core/src/trends/TrendsStore.ts` (skeleton only)
- Create: `packages/core/src/trends/index.ts`

- [ ] **Step 1: Create types.ts with the full public type surface**

Write `packages/core/src/trends/types.ts`:

```typescript
/**
 * Public types for the trends subsystem.
 *
 * A TrendSnapshot is a single point in time capturing code-health metrics.
 * The recorder emits these into an append-only JSONL file as a side-effect
 * of every indexing event; the store reads them back for the dashboard.
 */

import type { DependencyGraph, GitOverlayStore } from '../index.js';

export type TrendSource = 'watcher' | 'mcp' | 'cli' | 'dashboard' | 'manual';

export interface TrendSnapshot {
  /** ISO-8601 UTC, e.g. "2026-04-25T14:37:02.145Z" */
  timestamp: string;
  /** Unix seconds — redundant with timestamp, cheap to sort/filter by. */
  unixSeconds: number;

  // graph-derived (always present)
  totalFiles: number;
  totalEdges: number;
  /** Files with zero importers AND not an entry point. */
  deadFiles: number;

  // git-derived (null when gitEnabled=false)
  /** Mean busFactor across all files with ≥1 commit. */
  avgBusFactor: number | null;
  /** Files whose risk score > 0.6. */
  highRiskFiles: number | null;
  /** Σ (added+deleted) across commits in the last 7 calendar days. */
  churnLinesLast7d: number | null;

  // provenance
  source: TrendSource;
  /** Short-SHA of HEAD at record time, or null if not a git repo. */
  gitSha: string | null;
}

export interface TrendSeries {
  /** Ascending by timestamp. */
  snapshots: TrendSnapshot[];
  gitEnabled: boolean;
  /** Total rows on disk (may exceed snapshots.length when bounded by limit). */
  totalCount: number;
}

export interface RecordOptions {
  graph: DependencyGraph;
  overlay: GitOverlayStore;
  gitEnabled: boolean;
  rootDir: string;
  source: TrendSource;
  /** Override "now" for testing. Default: Date.now */
  now?: () => number;
}

export interface LoadOptions {
  rootDir: string;
  /** Only return rows with unixSeconds >= this. Default: now - 30 days. */
  sinceUnixSeconds?: number;
  /** Max rows to return (newest N if series is longer). Default: 500. */
  limit?: number;
}
```

- [ ] **Step 2: Create skeleton TrendsRecorder.ts**

Write `packages/core/src/trends/TrendsRecorder.ts`:

```typescript
import type { RecordOptions, TrendSnapshot } from './types.js';

/**
 * Compute the current metrics and append (or collapse) a row in
 * `${rootDir}/.ctxloom/trends/snapshots.jsonl`.
 *
 * Returns the row that was persisted, or null on error.
 * Never throws — failures are logged and swallowed so the caller's
 * indexing pipeline is never broken by trend recording.
 */
export async function recordTrendSnapshot(
  _opts: RecordOptions,
): Promise<TrendSnapshot | null> {
  throw new Error('not implemented');
}
```

- [ ] **Step 3: Create skeleton TrendsStore.ts**

Write `packages/core/src/trends/TrendsStore.ts`:

```typescript
import type { LoadOptions, TrendSeries } from './types.js';

/**
 * Read-side counterpart to TrendsRecorder. Stream-parses
 * `${rootDir}/.ctxloom/trends/snapshots.jsonl`, applies range/limit,
 * and returns a sorted ascending TrendSeries.
 *
 * Tolerant to missing files, partial writes, and malformed lines.
 */
export async function loadTrendSeries(
  _opts: LoadOptions,
): Promise<TrendSeries> {
  throw new Error('not implemented');
}
```

- [ ] **Step 4: Create barrel export**

Write `packages/core/src/trends/index.ts`:

```typescript
export type {
  TrendSnapshot,
  TrendSeries,
  TrendSource,
  RecordOptions,
  LoadOptions,
} from './types.js';
export { recordTrendSnapshot } from './TrendsRecorder.js';
export { loadTrendSeries } from './TrendsStore.js';
```

- [ ] **Step 5: Verify the module compiles**

Run: `npm run lint`
Expected: `tsc --noEmit` passes with exit code 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/trends/
git commit -m "feat(core): scaffold trends module — types and skeletons"
```

---

## Task 2: TrendsStore — TDD the read path

**Files:**
- Modify: `packages/core/src/trends/TrendsStore.ts`
- Test: `tests/TrendsStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `tests/TrendsStore.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/TrendsStore.test.ts`
Expected: All 7 tests fail with `not implemented`.

- [ ] **Step 3: Implement loadTrendSeries**

Replace `packages/core/src/trends/TrendsStore.ts` with:

```typescript
import path from 'node:path';
import fs from 'node:fs/promises';
import { logger } from '../utils/logger.js';
import type { LoadOptions, TrendSeries, TrendSnapshot } from './types.js';

const FILE_SUBPATH = path.join('.ctxloom', 'trends', 'snapshots.jsonl');
const DEFAULT_LIMIT = 500;
const DEFAULT_RANGE_SECONDS = 30 * 24 * 3600;

function isCompleteSnapshot(value: unknown): value is TrendSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.timestamp === 'string' &&
    typeof v.unixSeconds === 'number' &&
    typeof v.totalFiles === 'number' &&
    typeof v.totalEdges === 'number' &&
    typeof v.deadFiles === 'number' &&
    (v.avgBusFactor === null || typeof v.avgBusFactor === 'number') &&
    (v.highRiskFiles === null || typeof v.highRiskFiles === 'number') &&
    (v.churnLinesLast7d === null || typeof v.churnLinesLast7d === 'number') &&
    typeof v.source === 'string' &&
    (v.gitSha === null || typeof v.gitSha === 'string')
  );
}

export async function loadTrendSeries(opts: LoadOptions): Promise<TrendSeries> {
  const filePath = path.join(opts.rootDir, FILE_SUBPATH);
  const sinceUnixSeconds =
    opts.sinceUnixSeconds ?? Math.floor(Date.now() / 1000) - DEFAULT_RANGE_SECONDS;
  const limit = opts.limit ?? DEFAULT_LIMIT;

  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch {
    return { snapshots: [], gitEnabled: false, totalCount: 0 };
  }

  const parsed: TrendSnapshot[] = [];
  let totalCount = 0;
  let malformed = 0;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    totalCount++;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      malformed++;
      continue;
    }
    if (!isCompleteSnapshot(value)) {
      malformed++;
      continue;
    }
    parsed.push(value);
  }

  if (malformed > 0) {
    logger.warn('Skipped malformed trend rows', { file: filePath, count: malformed });
  }

  parsed.sort((a, b) => a.unixSeconds - b.unixSeconds);

  const filtered = parsed.filter(s => s.unixSeconds >= sinceUnixSeconds);
  const tail = filtered.length > limit ? filtered.slice(filtered.length - limit) : filtered;

  const newest = tail[tail.length - 1];
  const gitEnabled =
    newest !== undefined &&
    (newest.avgBusFactor !== null ||
      newest.highRiskFiles !== null ||
      newest.churnLinesLast7d !== null);

  return { snapshots: tail, gitEnabled, totalCount };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/TrendsStore.test.ts`
Expected: All 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/trends/TrendsStore.ts tests/TrendsStore.test.ts
git commit -m "feat(core): implement TrendsStore.loadTrendSeries"
```

---

## Task 3: TrendsRecorder — basic append

**Files:**
- Modify: `packages/core/src/trends/TrendsRecorder.ts`
- Test: `tests/TrendsRecorder.test.ts`

- [ ] **Step 1: Write the failing test**

Write `tests/TrendsRecorder.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/TrendsRecorder.test.ts`
Expected: Both tests fail with `not implemented`.

- [ ] **Step 3: Implement basic append**

Replace `packages/core/src/trends/TrendsRecorder.ts` with:

```typescript
import path from 'node:path';
import fs from 'node:fs/promises';
import { logger } from '../utils/logger.js';
import type { RecordOptions, TrendSnapshot } from './types.js';

const FILE_SUBPATH = path.join('.ctxloom', 'trends', 'snapshots.jsonl');
const ENTRY_PATTERN = /(^|\/)(index|main|server|app|cli)\.[^/]+$/;
const SEVEN_DAYS_SECONDS = 7 * 24 * 3600;

function computeMetrics(opts: RecordOptions, unixSeconds: number): Pick<TrendSnapshot, 'totalFiles' | 'totalEdges' | 'deadFiles' | 'avgBusFactor' | 'highRiskFiles' | 'churnLinesLast7d'> {
  const { graph, overlay, gitEnabled } = opts;
  const files = graph.allFiles();

  let deadFiles = 0;
  for (const f of files) {
    const importers = graph.getImporters(f).length;
    if (importers === 0 && !ENTRY_PATTERN.test(f)) deadFiles++;
  }

  if (!gitEnabled) {
    return {
      totalFiles: files.length,
      totalEdges: graph.edgeCount(),
      deadFiles,
      avgBusFactor: null,
      highRiskFiles: null,
      churnLinesLast7d: null,
    };
  }

  let busSum = 0;
  let busCount = 0;
  for (const f of overlay.ownership.allNodes()) {
    const stats = overlay.ownership.statsFor(f);
    if (stats !== null) {
      busSum += stats.busFactor;
      busCount++;
    }
  }
  const avgBusFactor = busCount > 0 ? busSum / busCount : 0;

  let highRiskFiles = 0;
  let churnLinesLast7d = 0;
  const sevenDaysAgo = unixSeconds - SEVEN_DAYS_SECONDS;
  for (const f of files) {
    const churn = overlay.churn.statsFor(f);
    const ownership = overlay.ownership.statsFor(f);
    const coupled = overlay.coChange.topFor({ node: f, limit: 100, minConfidence: 0.1 });
    const churnLines = churn?.churnLines ?? 0;
    const bugDensity = churn?.bugDensity ?? 0;
    const busFactor = ownership?.busFactor ?? 1;
    const churnPart = Math.min(1, churnLines / 1000);
    const bugPart = Math.min(1, bugDensity * 2);
    const busPart = busFactor <= 1 ? 1 : busFactor <= 2 ? 0.5 : 0;
    const couplingPart = Math.min(1, coupled.length / 10);
    const score = churnPart * 0.3 + bugPart * 0.3 + busPart * 0.2 + couplingPart * 0.2;
    if (score > 0.6) highRiskFiles++;
    if (churn && churn.lastTouch >= sevenDaysAgo) {
      churnLinesLast7d += churn.churnLines;
    }
  }

  return {
    totalFiles: files.length,
    totalEdges: graph.edgeCount(),
    deadFiles,
    avgBusFactor: Math.round(avgBusFactor * 100) / 100,
    highRiskFiles,
    churnLinesLast7d,
  };
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function recordTrendSnapshot(opts: RecordOptions): Promise<TrendSnapshot | null> {
  const now = opts.now ?? Date.now;
  const ms = now();
  const unixSeconds = Math.floor(ms / 1000);
  const timestamp = new Date(ms).toISOString();

  const filePath = path.join(opts.rootDir, FILE_SUBPATH);

  try {
    const metrics = computeMetrics(opts, unixSeconds);
    const snapshot: TrendSnapshot = {
      timestamp,
      unixSeconds,
      ...metrics,
      source: opts.source,
      gitSha: null,
    };

    await ensureDir(path.dirname(filePath));
    await fs.appendFile(filePath, JSON.stringify(snapshot) + '\n');

    return snapshot;
  } catch (err) {
    logger.warn('Failed to record trend snapshot', {
      file: filePath,
      detail: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/TrendsRecorder.test.ts`
Expected: Both tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/trends/TrendsRecorder.ts tests/TrendsRecorder.test.ts
git commit -m "feat(core): TrendsRecorder — first-snapshot append"
```

---

## Task 4: TrendsRecorder — collapse logic

**Files:**
- Modify: `packages/core/src/trends/TrendsRecorder.ts`
- Modify: `tests/TrendsRecorder.test.ts` (append new describe block)

- [ ] **Step 1: Append failing tests for collapse logic**

Append to `tests/TrendsRecorder.test.ts`:

```typescript
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
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run tests/TrendsRecorder.test.ts`
Expected: New tests fail (multiple-row assertions fail because the recorder always appends).

- [ ] **Step 3: Implement collapse logic in TrendsRecorder**

Replace the body of `recordTrendSnapshot` in `packages/core/src/trends/TrendsRecorder.ts`. Add helpers above and rewrite the main function:

```typescript
const COLLAPSE_WINDOW_SECONDS = 300;
const PERCENT_THRESHOLD = 0.01;
const INTEGER_FLOOR_FIELDS: ReadonlyArray<keyof TrendSnapshot> = [
  'totalFiles',
  'totalEdges',
  'deadFiles',
  'highRiskFiles',
];

async function readLastLine(filePath: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(filePath);
    if (buf.length === 0) return null;
    const text = buf.toString('utf-8').replace(/\n+$/, '');
    const idx = text.lastIndexOf('\n');
    return idx >= 0 ? text.slice(idx + 1) : text;
  } catch {
    return null;
  }
}

async function readLastSnapshot(filePath: string): Promise<TrendSnapshot | null> {
  const line = await readLastLine(filePath);
  if (line === null || line.trim() === '') return null;
  try {
    return JSON.parse(line) as TrendSnapshot;
  } catch {
    return null;
  }
}

function shouldCollapse(prev: TrendSnapshot, next: TrendSnapshot): boolean {
  if (next.unixSeconds - prev.unixSeconds >= COLLAPSE_WINDOW_SECONDS) return false;

  for (const key of INTEGER_FLOOR_FIELDS) {
    const a = prev[key];
    const b = next[key];
    if (typeof a === 'number' && typeof b === 'number' && Math.abs(b - a) >= 1) {
      return false;
    }
  }

  const numericKeys: ReadonlyArray<keyof TrendSnapshot> = [
    'totalFiles', 'totalEdges', 'deadFiles', 'avgBusFactor', 'highRiskFiles', 'churnLinesLast7d',
  ];
  for (const key of numericKeys) {
    const a = prev[key];
    const b = next[key];
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    if (a === 0) {
      if (b !== 0) return false;
      continue;
    }
    if (Math.abs((b - a) / a) > PERCENT_THRESHOLD) return false;
  }

  return true;
}

async function overwriteLastLine(filePath: string, replacement: string): Promise<void> {
  const buf = await fs.readFile(filePath);
  const text = buf.toString('utf-8');
  const trimmed = text.replace(/\n+$/, '');
  const idx = trimmed.lastIndexOf('\n');
  const head = idx >= 0 ? trimmed.slice(0, idx + 1) : '';
  await fs.writeFile(filePath, head + replacement + '\n');
}

export async function recordTrendSnapshot(opts: RecordOptions): Promise<TrendSnapshot | null> {
  const now = opts.now ?? Date.now;
  const ms = now();
  const unixSeconds = Math.floor(ms / 1000);
  const timestamp = new Date(ms).toISOString();

  const filePath = path.join(opts.rootDir, FILE_SUBPATH);

  try {
    const metrics = computeMetrics(opts, unixSeconds);
    const snapshot: TrendSnapshot = {
      timestamp,
      unixSeconds,
      ...metrics,
      source: opts.source,
      gitSha: null,
    };

    await ensureDir(path.dirname(filePath));

    const prev = await readLastSnapshot(filePath);
    if (prev !== null && shouldCollapse(prev, snapshot)) {
      await overwriteLastLine(filePath, JSON.stringify(snapshot));
    } else {
      await fs.appendFile(filePath, JSON.stringify(snapshot) + '\n');
    }

    return snapshot;
  } catch (err) {
    logger.warn('Failed to record trend snapshot', {
      file: filePath,
      detail: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/TrendsRecorder.test.ts`
Expected: All 6 tests pass (2 from Task 3 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/trends/TrendsRecorder.ts tests/TrendsRecorder.test.ts
git commit -m "feat(core): TrendsRecorder — 5min/1% collapse logic"
```

---

## Task 5: TrendsRecorder — git-disabled and error-swallow paths

**Files:**
- Modify: `tests/TrendsRecorder.test.ts` (append)
- Existing implementation already handles both — no implementation change required.

- [ ] **Step 1: Append remaining tests**

Append to `tests/TrendsRecorder.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/TrendsRecorder.test.ts`
Expected: All 8 tests pass (already-implemented behavior covers these cases).

- [ ] **Step 3: Commit**

```bash
git add tests/TrendsRecorder.test.ts
git commit -m "test(core): TrendsRecorder — git-disabled and error-swallow tests"
```

---

## Task 6: Public exports from @ctxloom/core

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add the new exports**

Open `packages/core/src/index.ts`. After the existing `// ─── Git overlay ───` block (around line 35), add a new section:

```typescript
// ─── Trends ──────────────────────────────────────────────────────────────────
export type {
  TrendSnapshot,
  TrendSeries,
  TrendSource,
  RecordOptions as TrendRecordOptions,
  LoadOptions as TrendLoadOptions,
} from './trends/types.js';
export { recordTrendSnapshot } from './trends/TrendsRecorder.js';
export { loadTrendSeries } from './trends/TrendsStore.js';
```

- [ ] **Step 2: Verify lint**

Run: `npm run lint`
Expected: `tsc --noEmit` exits 0.

- [ ] **Step 3: Verify exports are reachable from a consumer-style import**

Run: `node -e "import('./packages/core/src/index.ts').catch(e => { console.error(e); process.exit(1); })" 2>&1` is not meaningful with TypeScript source. Instead, verify the existing dashboard import-smoke test still passes (it confirms `@ctxloom/core` resolves):

Run: `npx vitest run apps/dashboard/tests/core-import-smoke.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export trends recorder, store, and types"
```

---

## Task 7: DependencyGraph — afterReady callback

**Files:**
- Modify: `packages/core/src/graph/DependencyGraph.ts`
- Modify: `tests/DependencyGraph.test.ts` (append)

- [ ] **Step 1: Read the existing buildFromDirectory signature**

Open `packages/core/src/graph/DependencyGraph.ts` and locate `buildFromDirectory` (around line 59). Note the two return paths:
- Line 68: `if (await this.loadSnapshot(files.length))` returns after a successful snapshot load
- Line 180 (end of method): falls through after a full build + saveSnapshot

Both paths must invoke the new callback.

- [ ] **Step 2: Append a failing test for the callback**

Append to `tests/DependencyGraph.test.ts`:

```typescript
describe('buildFromDirectory afterReady callback', () => {
  it('fires the afterReady callback after a fresh build', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-after-'));
    fs.writeFileSync(path.join(tmp, 'a.ts'), 'export const a = 1;');
    const graph = new DependencyGraph();
    const calls: number[] = [];
    await graph.buildFromDirectory(tmp, { afterReady: async () => { calls.push(Date.now()); } });
    expect(calls).toHaveLength(1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('fires the afterReady callback when hydrating from snapshot', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-after-snap-'));
    fs.writeFileSync(path.join(tmp, 'a.ts'), 'export const a = 1;');
    // First build to create the snapshot
    const g1 = new DependencyGraph();
    await g1.buildFromDirectory(tmp);
    // Second build should hydrate from snapshot
    const g2 = new DependencyGraph();
    const calls: number[] = [];
    await g2.buildFromDirectory(tmp, { afterReady: async () => { calls.push(Date.now()); } });
    expect(calls).toHaveLength(1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
```

Make sure these imports exist at the top of `tests/DependencyGraph.test.ts` (add any missing):
```typescript
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { DependencyGraph } from '../packages/core/src/graph/DependencyGraph.js';
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/DependencyGraph.test.ts -t "afterReady callback"`
Expected: Tests fail because `afterReady` is unknown / not invoked.

- [ ] **Step 4: Modify buildFromDirectory to accept and invoke the callback**

In `packages/core/src/graph/DependencyGraph.ts`, replace the existing signature:

```typescript
async buildFromDirectory(rootDir: string): Promise<void> {
```

with:

```typescript
async buildFromDirectory(
  rootDir: string,
  options?: { afterReady?: () => Promise<void> },
): Promise<void> {
```

In the snapshot-load early-return block (currently `if (await this.loadSnapshot(files.length)) { logger.info(...); return; }`), replace with:

```typescript
if (await this.loadSnapshot(files.length)) {
  logger.info('Loaded graph from snapshot', { edges: this.edgeCount() });
  if (options?.afterReady) {
    try { await options.afterReady(); }
    catch (err) { logger.warn('afterReady callback threw', { detail: String(err) }); }
  }
  return;
}
```

At the bottom of `buildFromDirectory`, immediately after the existing `await this.saveSnapshot(); logger.info('Graph built', ...)`, append:

```typescript
if (options?.afterReady) {
  try { await options.afterReady(); }
  catch (err) { logger.warn('afterReady callback threw', { detail: String(err) }); }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/DependencyGraph.test.ts -t "afterReady callback"`
Expected: Both new tests pass.

- [ ] **Step 6: Run the full DependencyGraph test file to ensure no regressions**

Run: `npx vitest run tests/DependencyGraph.test.ts`
Expected: All 23 tests pass (21 existing + 2 new).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/graph/DependencyGraph.ts tests/DependencyGraph.test.ts
git commit -m "feat(core): DependencyGraph.buildFromDirectory afterReady callback"
```

---

## Task 8: Wire the recorder into the CLI entry (src/index.ts)

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Inspect the existing call sites**

Open `src/index.ts`. The two `buildFromDirectory` calls live at lines 342 and 669. The CLI commands that hit these paths are `index` and `repos`. Both should record with `source: 'cli'`.

- [ ] **Step 2: Add the import**

Near the top of `src/index.ts`, add to the existing `@ctxloom/core` import block:

```typescript
import { recordTrendSnapshot, GitOverlayStore } from '@ctxloom/core';
```

(Confirm `GitOverlayStore` isn't already imported — it likely is. If so, just add `recordTrendSnapshot` to the existing list. Verify the existing import statement and merge accordingly.)

- [ ] **Step 3: Wire the first call site (around line 342)**

Locate the block that currently reads:

```typescript
const graph = new DependencyGraph();
// ... possibly some setup ...
await graph.buildFromDirectory(root);
```

Wrap the call with the callback. Replace just the `await graph.buildFromDirectory(root);` line with:

```typescript
const overlay = new GitOverlayStore(root);
const gitEnabled = await overlay.loadSnapshot();
await graph.buildFromDirectory(root, {
  afterReady: async () => {
    await recordTrendSnapshot({ graph, overlay, gitEnabled, rootDir: root, source: 'cli' });
  },
});
```

If a local `overlay` and `gitEnabled` already exist near this call site, reuse them — don't shadow.

- [ ] **Step 4: Wire the second call site (around line 669)**

Apply the same change to the second `buildFromDirectory` call. Reuse any existing `overlay`/`gitEnabled` in scope.

- [ ] **Step 5: Verify lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Verify the CLI smoke runs**

Run: `node dist/index.js --help 2>&1 | head -5` (after `npm run build`):

```bash
npm run build
node dist/index.js --help 2>&1 | head -5
```

Expected: Help text prints; no runtime error.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts
git commit -m "feat(cli): record trend snapshots after every CLI index"
```

---

## Task 9: Wire the recorder into MCP server + watcher (src/server.ts)

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Add imports**

Near the top of `src/server.ts`, add to the existing `@ctxloom/core` import block:

```typescript
import { recordTrendSnapshot } from '@ctxloom/core';
```

- [ ] **Step 2: Locate the getGraph factory (around line 79-90) and wire afterReady**

Replace the body of `getGraph()`:

```typescript
getGraph() {
  if (!_graphPromise) {
    _graphPromise = (async () => {
      const parser = await ctx.getParser();
      const graph = new DependencyGraph();
      graph.setParser(parser);
      await graph.buildFromDirectory(PROJECT_ROOT, {
        afterReady: async () => {
          const overlay = ctx.overlay;
          if (overlay) {
            await recordTrendSnapshot({
              graph,
              overlay,
              gitEnabled: true,
              rootDir: PROJECT_ROOT,
              source: 'mcp',
            });
          }
        },
      });
      return graph;
    })();
  }
  return _graphPromise;
},
```

Note: if `ctx.overlay` is not yet populated when the graph is first built, the callback will skip recording — that's fine, the watcher path will pick up the next change.

- [ ] **Step 3: Locate the FileWatcher onChange callback (around line 168)**

After the watcher's existing graph update line (`try { await (await ctx.getGraph()).updateFile(absPath, PROJECT_ROOT); } catch { /* ok */ }`), and after the debounced overlay refresh block, append a final block that records a watcher-source snapshot. The final structure of the onChange handler should end with:

```typescript
    try { await (await ctx.getGraph()).updateFile(absPath, PROJECT_ROOT); } catch { /* ok */ }

    // Debounced incremental git overlay refresh (30 s after last file change)
    if (ctx.overlay) {
      // ... existing debounce block ...
    }

    // Record a trend snapshot after every watcher-driven reindex.
    // The recorder's own throttle collapses rapid successive saves.
    if (ctx.overlay && ctx.isGraphInitialized()) {
      try {
        const graph = await ctx.getGraph();
        await recordTrendSnapshot({
          graph,
          overlay: ctx.overlay,
          gitEnabled: true,
          rootDir: PROJECT_ROOT,
          source: 'watcher',
        });
      } catch (err) {
        logger.warn('watcher trend record failed', { detail: String(err) });
      }
    }
  });
```

(Keep the existing debounce block exactly as-is — only add the final `if (ctx.overlay && ctx.isGraphInitialized())` block.)

- [ ] **Step 4: Verify lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Verify build still produces a working binary**

Run: `npm run build && node dist/index.js --help 2>&1 | head -5`
Expected: Help text prints; no runtime error.

- [ ] **Step 6: Commit**

```bash
git add src/server.ts
git commit -m "feat(mcp): record trend snapshots from MCP startup and file watcher"
```

---

## Task 10: Wire the recorder into the dashboard loader

**Files:**
- Modify: `apps/dashboard/server/loader.ts`

- [ ] **Step 1: Update loadContext to wire afterReady**

Replace the contents of `apps/dashboard/server/loader.ts` with:

```typescript
import path from 'node:path';
import { DependencyGraph, GitOverlayStore, recordTrendSnapshot } from '@ctxloom/core';

export interface DashboardContext {
  root: string;
  graph: DependencyGraph;
  overlay: GitOverlayStore;
  gitEnabled: boolean;
  lastIndexed: Date;
}

export async function loadContext(root: string): Promise<DashboardContext> {
  const absRoot = path.resolve(root);

  const overlay = new GitOverlayStore(absRoot);
  const gitEnabled = await overlay.loadSnapshot();

  const graph = new DependencyGraph();
  await graph.buildFromDirectory(absRoot, {
    afterReady: async () => {
      await recordTrendSnapshot({
        graph,
        overlay,
        gitEnabled,
        rootDir: absRoot,
        source: 'dashboard',
      });
    },
  });

  return { root: absRoot, graph, overlay, gitEnabled, lastIndexed: new Date() };
}

export async function reloadContext(ctx: DashboardContext): Promise<void> {
  const fresh = await loadContext(ctx.root);
  ctx.graph = fresh.graph;
  ctx.overlay = fresh.overlay;
  ctx.gitEnabled = fresh.gitEnabled;
  ctx.lastIndexed = fresh.lastIndexed;
}
```

- [ ] **Step 2: Verify the dashboard loader test still passes**

Run: `npx vitest run apps/dashboard/tests/loader.test.ts --config apps/dashboard/vitest.config.ts`
Expected: PASS.

- [ ] **Step 3: Verify lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/server/loader.ts
git commit -m "feat(dashboard): record trend snapshots on dashboard load and refresh"
```

---

## Task 11: Pipeline smoke test

**Files:**
- Test: `tests/TrendsIntegration.test.ts`

- [ ] **Step 1: Write the smoke test**

Write `tests/TrendsIntegration.test.ts`:

```typescript
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
  afterEach(() => { fs.rmSync(rootDir, { recursive: true, force: true }); });

  it('records a row when buildFromDirectory afterReady fires', async () => {
    const graph = new DependencyGraph();
    const overlay = new GitOverlayStore(rootDir);
    const gitEnabled = await overlay.loadSnapshot();

    await graph.buildFromDirectory(rootDir, {
      afterReady: async () => {
        await recordTrendSnapshot({
          graph, overlay, gitEnabled,
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
```

- [ ] **Step 2: Run the smoke test**

Run: `npx vitest run tests/TrendsIntegration.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the full root test suite to confirm no regressions**

Run: `npm test`
Expected: All ≥553 tests pass (553 baseline + new tests added in tasks 2, 3, 4, 5, 7, 11).

- [ ] **Step 4: Commit**

```bash
git add tests/TrendsIntegration.test.ts
git commit -m "test(core): trend pipeline smoke — afterReady records a row"
```

---

## Task 12: /api/trends route

**Files:**
- Modify: `apps/dashboard/server/types.ts`
- Modify: `apps/dashboard/client/src/lib/api.ts`
- Create: `apps/dashboard/server/routes/trends.ts`
- Modify: `apps/dashboard/server/index.ts`
- Test: `apps/dashboard/tests/routes.trends.test.ts`

- [ ] **Step 1: Append TrendsResponse to dashboard server types**

Append to `apps/dashboard/server/types.ts`:

```typescript
import type { TrendSnapshot } from '@ctxloom/core';

export type TrendRange = '7d' | '30d' | '90d' | 'all';

export interface TrendsResponse {
  snapshots: TrendSnapshot[];
  gitEnabled: boolean;
  totalCount: number;
  range: TrendRange;
}
```

- [ ] **Step 2: Write the failing route test**

Write `apps/dashboard/tests/routes.trends.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { buildTrendsRouter } from '../server/routes/trends.js';
import type { DashboardContext } from '../server/loader.js';

function makeCtx(root: string): DashboardContext {
  return {
    root,
    graph: {} as any,
    overlay: {} as any,
    gitEnabled: false,
    lastIndexed: new Date(),
  };
}

function row(unixSeconds: number, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    timestamp: new Date(unixSeconds * 1000).toISOString(),
    unixSeconds,
    totalFiles: 100,
    totalEdges: 200,
    deadFiles: 5,
    avgBusFactor: 2,
    highRiskFiles: 3,
    churnLinesLast7d: 1000,
    source: 'cli',
    gitSha: 'abc',
    ...overrides,
  });
}

describe('GET /api/trends', () => {
  let rootDir: string;
  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trends-route-'));
    const dir = path.join(rootDir, '.ctxloom', 'trends');
    fs.mkdirSync(dir, { recursive: true });
  });
  afterEach(() => { fs.rmSync(rootDir, { recursive: true, force: true }); });

  function writeRows(rows: string[]): void {
    fs.writeFileSync(path.join(rootDir, '.ctxloom', 'trends', 'snapshots.jsonl'), rows.join('\n') + '\n');
  }

  it('returns 200 with default 30d range', async () => {
    const now = Math.floor(Date.now() / 1000);
    writeRows([row(now - 100), row(now)]);
    const app = express();
    app.use('/api/trends', buildTrendsRouter(makeCtx(rootDir)));
    const res = await request(app).get('/api/trends');
    expect(res.status).toBe(200);
    expect(res.body.range).toBe('30d');
    expect(res.body.snapshots).toHaveLength(2);
  });

  it('range=7d filters out older rows', async () => {
    const now = Math.floor(Date.now() / 1000);
    const eightDaysAgo = now - 8 * 24 * 3600;
    writeRows([row(eightDaysAgo), row(now)]);
    const app = express();
    app.use('/api/trends', buildTrendsRouter(makeCtx(rootDir)));
    const res = await request(app).get('/api/trends?range=7d');
    expect(res.status).toBe(200);
    expect(res.body.snapshots).toHaveLength(1);
    expect(res.body.snapshots[0].unixSeconds).toBe(now);
  });

  it('range=all includes all rows', async () => {
    writeRows([row(1000), row(2000), row(Math.floor(Date.now() / 1000))]);
    const app = express();
    app.use('/api/trends', buildTrendsRouter(makeCtx(rootDir)));
    const res = await request(app).get('/api/trends?range=all');
    expect(res.status).toBe(200);
    expect(res.body.snapshots).toHaveLength(3);
  });

  it('returns empty snapshots when file is missing', async () => {
    const app = express();
    app.use('/api/trends', buildTrendsRouter(makeCtx(rootDir)));
    const res = await request(app).get('/api/trends');
    expect(res.status).toBe(200);
    expect(res.body.snapshots).toEqual([]);
    expect(res.body.totalCount).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run: `npx vitest run apps/dashboard/tests/routes.trends.test.ts --config apps/dashboard/vitest.config.ts`
Expected: All 4 tests fail — `buildTrendsRouter` does not exist.

- [ ] **Step 4: Implement the route**

Write `apps/dashboard/server/routes/trends.ts`:

```typescript
import { Router } from 'express';
import { loadTrendSeries } from '@ctxloom/core';
import type { DashboardContext } from '../loader.js';
import type { TrendsResponse, TrendRange } from '../types.js';

const RANGE_TO_SECONDS: Record<Exclude<TrendRange, 'all'>, number> = {
  '7d': 7 * 24 * 3600,
  '30d': 30 * 24 * 3600,
  '90d': 90 * 24 * 3600,
};

function parseRange(raw: unknown): TrendRange {
  if (raw === '7d' || raw === '30d' || raw === '90d' || raw === 'all') return raw;
  return '30d';
}

function parseLimit(raw: unknown): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < 1) return 500;
  return Math.min(n, 5000);
}

export function buildTrendsRouter(ctx: DashboardContext): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const range = parseRange(req.query.range);
    const limit = parseLimit(req.query.limit);
    const sinceUnixSeconds =
      range === 'all' ? 0 : Math.floor(Date.now() / 1000) - RANGE_TO_SECONDS[range];

    const series = await loadTrendSeries({ rootDir: ctx.root, sinceUnixSeconds, limit });

    const body: TrendsResponse = {
      snapshots: series.snapshots,
      gitEnabled: series.gitEnabled,
      totalCount: series.totalCount,
      range,
    };
    res.json(body);
  });

  return router;
}
```

- [ ] **Step 5: Mount the route in dashboard server**

Open `apps/dashboard/server/index.ts`. Add the import next to the other route imports:

```typescript
import { buildTrendsRouter } from './routes/trends.js';
```

After `app.use('/api/tokens', buildTokensRouter(ctx));`, add:

```typescript
app.use('/api/trends', buildTrendsRouter(ctx));
```

- [ ] **Step 6: Add the client API method**

Open `apps/dashboard/client/src/lib/api.ts`. Add to the type imports:

```typescript
import type { TrendsResponse, TrendRange } from '../../../server/types.js';
```

Add to the `api` object (anywhere logical — keep consistent with neighbours):

```typescript
trends: (range: TrendRange = '30d') => get<TrendsResponse>(`/trends?range=${range}`),
```

- [ ] **Step 7: Run the route tests**

Run: `npx vitest run apps/dashboard/tests/routes.trends.test.ts --config apps/dashboard/vitest.config.ts`
Expected: All 4 tests pass.

- [ ] **Step 8: Run the full dashboard test suite**

Run: `cd apps/dashboard && npx vitest run`
Expected: All existing dashboard tests + 4 new pass.

- [ ] **Step 9: Verify lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/dashboard/server/types.ts apps/dashboard/server/routes/trends.ts apps/dashboard/server/index.ts apps/dashboard/client/src/lib/api.ts apps/dashboard/tests/routes.trends.test.ts
git commit -m "feat(dashboard): GET /api/trends route with range filtering"
```

---

## Task 13: computeDelta helper

**Files:**
- Create: `apps/dashboard/client/src/lib/trendDelta.ts`
- Test: `apps/dashboard/tests/trendDelta.test.ts`

- [ ] **Step 1: Write the failing test**

Write `apps/dashboard/tests/trendDelta.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeDelta } from '../client/src/lib/trendDelta.js';

describe('computeDelta', () => {
  it('returns "stable" when change is under 1%', () => {
    const r = computeDelta(100, 100.5, 'down');
    expect(r.label).toBe('→ stable');
    expect(r.tone).toBe('neutral');
  });

  it('returns good tone when metric improves in goodDirection=down', () => {
    const r = computeDelta(100, 80, 'down');
    expect(r.label).toBe('↓ 20%');
    expect(r.tone).toBe('good');
  });

  it('returns bad tone when metric worsens in goodDirection=down', () => {
    const r = computeDelta(100, 120, 'down');
    expect(r.label).toBe('↑ 20%');
    expect(r.tone).toBe('bad');
  });

  it('returns good tone when metric rises in goodDirection=up', () => {
    const r = computeDelta(2.0, 2.4, 'up');
    expect(r.label).toBe('↑ 20%');
    expect(r.tone).toBe('good');
  });

  it('handles zero baseline without crashing', () => {
    const r = computeDelta(0, 5, 'up');
    expect(r.label).toBe('↑ new');
    expect(r.tone).toBe('good');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run apps/dashboard/tests/trendDelta.test.ts --config apps/dashboard/vitest.config.ts`
Expected: All 5 tests fail — module does not exist.

- [ ] **Step 3: Implement the helper**

Write `apps/dashboard/client/src/lib/trendDelta.ts`:

```typescript
export type DeltaTone = 'good' | 'bad' | 'neutral';

export interface DeltaResult {
  label: string;
  tone: DeltaTone;
}

export function computeDelta(
  earliest: number,
  latest: number,
  goodDirection: 'up' | 'down',
): DeltaResult {
  if (earliest === 0) {
    if (latest === 0) return { label: '→ stable', tone: 'neutral' };
    const rising = latest > 0;
    const isGood = (goodDirection === 'up') === rising;
    return { label: '↑ new', tone: isGood ? 'good' : 'bad' };
  }
  const pct = (latest - earliest) / earliest;
  const absPct = Math.abs(pct);
  if (absPct < 0.01) return { label: '→ stable', tone: 'neutral' };
  const arrow = pct > 0 ? '↑' : '↓';
  const rising = pct > 0;
  const isGood = (goodDirection === 'up') === rising;
  return {
    label: `${arrow} ${(absPct * 100).toFixed(0)}%`,
    tone: isGood ? 'good' : 'bad',
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/dashboard/tests/trendDelta.test.ts --config apps/dashboard/vitest.config.ts`
Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/client/src/lib/trendDelta.ts apps/dashboard/tests/trendDelta.test.ts
git commit -m "feat(dashboard): computeDelta helper for trend badges"
```

---

## Task 14: SparklineCard component

**Files:**
- Create: `apps/dashboard/client/src/components/SparklineCard.tsx`

- [ ] **Step 1: Implement the component**

Write `apps/dashboard/client/src/components/SparklineCard.tsx`:

```tsx
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import { computeDelta, type DeltaTone } from '../lib/trendDelta.js';

interface SeriesPoint {
  t: number;
  v: number | null;
}

interface SparklineCardProps {
  label: string;
  currentValue: number | null;
  series: SeriesPoint[];
  goodDirection: 'up' | 'down';
  format: (v: number) => string;
  gitRequired?: boolean;
  gitEnabled: boolean;
}

const TONE_COLOR: Record<DeltaTone, string> = {
  good: '#22c55e',
  bad: '#ef4444',
  neutral: '#a1a1aa',
};

const STROKE_COLOR = '#a78bfa';

export function SparklineCard({
  label,
  currentValue,
  series,
  goodDirection,
  format,
  gitRequired = false,
  gitEnabled,
}: SparklineCardProps) {
  if (gitRequired && !gitEnabled) {
    return (
      <div className="bg-[#1e1d2a] border border-white/10 rounded-xl p-5">
        <h2 className="text-white/40 text-xs uppercase tracking-wider mb-2">{label}</h2>
        <p className="text-white/30 text-sm">Git history disabled</p>
      </div>
    );
  }

  const numericPoints = series.filter(p => typeof p.v === 'number') as Array<{ t: number; v: number }>;

  if (numericPoints.length < 2 || currentValue === null) {
    return (
      <div className="bg-[#1e1d2a] border border-white/10 rounded-xl p-5">
        <h2 className="text-white/40 text-xs uppercase tracking-wider mb-2">{label}</h2>
        <p className="text-white/30 text-sm">Collecting data — edit some files or run <code className="text-white/50">ctxloom index</code></p>
      </div>
    );
  }

  const earliest = numericPoints[0].v;
  const latest = numericPoints[numericPoints.length - 1].v;
  const delta = computeDelta(earliest, latest, goodDirection);

  return (
    <div className="bg-[#1e1d2a] border border-white/10 rounded-xl p-5">
      <h2 className="text-white/40 text-xs uppercase tracking-wider mb-2">{label}</h2>
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-white text-2xl font-semibold">{format(currentValue)}</span>
        <span className="text-xs font-medium" style={{ color: TONE_COLOR[delta.tone] }}>
          {delta.label}
        </span>
      </div>
      <div className="h-12">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={numericPoints} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <YAxis hide domain={['auto', 'auto']} />
            <Line
              type="monotone"
              dataKey="v"
              stroke={STROKE_COLOR}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/client/src/components/SparklineCard.tsx
git commit -m "feat(dashboard): SparklineCard component"
```

---

## Task 15: TrendsRangePicker component

**Files:**
- Create: `apps/dashboard/client/src/components/TrendsRangePicker.tsx`

- [ ] **Step 1: Implement the component**

Write `apps/dashboard/client/src/components/TrendsRangePicker.tsx`:

```tsx
type Range = '7d' | '30d' | '90d';

interface TrendsRangePickerProps {
  value: Range;
  onChange: (next: Range) => void;
}

const OPTIONS: ReadonlyArray<{ value: Range; label: string }> = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
];

export function TrendsRangePicker({ value, onChange }: TrendsRangePickerProps) {
  return (
    <div className="inline-flex rounded-md bg-[#131220] border border-white/10 p-0.5">
      {OPTIONS.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={`px-3 py-1 text-xs font-medium rounded ${
            value === opt.value
              ? 'bg-[#603dc6]/20 text-[#a78bfa]'
              : 'text-white/40 hover:text-white/70'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/client/src/components/TrendsRangePicker.tsx
git commit -m "feat(dashboard): TrendsRangePicker component"
```

---

## Task 16: Trends page + nav integration + component tests

**Files:**
- Create: `apps/dashboard/client/src/pages/Trends.tsx`
- Modify: `apps/dashboard/client/src/App.tsx`
- Modify: `apps/dashboard/client/src/components/Layout.tsx`
- Test: `apps/dashboard/tests/Trends.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Write `apps/dashboard/tests/Trends.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { Trends } from '../client/src/pages/Trends.js';
import type { TrendsResponse } from '../server/types.js';

function setApiResponse(body: TrendsResponse): void {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

function row(unixSeconds: number, overrides: Partial<TrendsResponse['snapshots'][number]> = {}) {
  return {
    timestamp: new Date(unixSeconds * 1000).toISOString(),
    unixSeconds,
    totalFiles: 100,
    totalEdges: 200,
    deadFiles: 10,
    avgBusFactor: 2.0,
    highRiskFiles: 5,
    churnLinesLast7d: 1000,
    source: 'cli' as const,
    gitSha: 'abc',
    ...overrides,
  };
}

describe('Trends page', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders 4 sparkline cards when data is present', async () => {
    setApiResponse({
      snapshots: [row(1000), row(2000), row(3000)],
      gitEnabled: true,
      totalCount: 3,
      range: '30d',
    });
    render(<MemoryRouter><Trends /></MemoryRouter>);
    expect(await screen.findByText('Dead files')).toBeInTheDocument();
    expect(await screen.findByText('Avg bus factor')).toBeInTheDocument();
    expect(await screen.findByText('High-risk files')).toBeInTheDocument();
    expect(await screen.findByText('Churn lines / week')).toBeInTheDocument();
  });

  it('shows empty-state copy when there are fewer than 2 snapshots', async () => {
    setApiResponse({
      snapshots: [row(1000)],
      gitEnabled: true,
      totalCount: 1,
      range: '30d',
    });
    render(<MemoryRouter><Trends /></MemoryRouter>);
    expect(await screen.findAllByText(/Collecting data/i)).not.toHaveLength(0);
  });

  it('shows "Git history disabled" placeholders for git-dependent cards', async () => {
    setApiResponse({
      snapshots: [
        row(1000, { avgBusFactor: null, highRiskFiles: null, churnLinesLast7d: null }),
        row(2000, { avgBusFactor: null, highRiskFiles: null, churnLinesLast7d: null }),
      ],
      gitEnabled: false,
      totalCount: 2,
      range: '30d',
    });
    render(<MemoryRouter><Trends /></MemoryRouter>);
    const placeholders = await screen.findAllByText(/Git history disabled/i);
    expect(placeholders).toHaveLength(3);
  });

  it('range picker fetches a different URL when clicked', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ snapshots: [], gitEnabled: false, totalCount: 0, range: '30d' }),
    } as unknown as Response);
    global.fetch = fetchMock;
    const user = (await import('@testing-library/user-event')).default.setup();
    render(<MemoryRouter><Trends /></MemoryRouter>);
    await screen.findByText('30d');
    await user.click(screen.getByText('7d'));
    const calls = fetchMock.mock.calls.map(c => String(c[0]));
    expect(calls.some(u => u.includes('range=7d'))).toBe(true);
  });
});
```

- [ ] **Step 2: Verify required test deps are present**

Run:
```bash
cd apps/dashboard && npm ls @testing-library/user-event 2>&1 | head -5
```
If `@testing-library/user-event` is missing, install it:
```bash
cd apps/dashboard && npm install --save-dev @testing-library/user-event
```
Expected after install: appears in `apps/dashboard/package.json` devDependencies.

- [ ] **Step 3: Run tests to verify failure**

Run: `npx vitest run apps/dashboard/tests/Trends.test.tsx --config apps/dashboard/vitest.config.ts`
Expected: All 4 tests fail — `Trends` does not exist.

- [ ] **Step 4: Implement the Trends page**

Write `apps/dashboard/client/src/pages/Trends.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { SparklineCard } from '../components/SparklineCard.js';
import { TrendsRangePicker } from '../components/TrendsRangePicker.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import type { TrendsResponse } from '../../../server/types.js';
import type { TrendSnapshot } from '@ctxloom/core';

type Range = '7d' | '30d' | '90d';

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: TrendsResponse };

function fmtCount(n: number): string { return String(Math.round(n)); }
function fmtBus(n: number): string { return n.toFixed(1); }
function fmtChurn(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function pick(snapshots: TrendSnapshot[], key: keyof TrendSnapshot) {
  return snapshots.map(s => ({ t: s.unixSeconds, v: (s[key] ?? null) as number | null }));
}

function lastNonNull(snapshots: TrendSnapshot[], key: keyof TrendSnapshot): number | null {
  for (let i = snapshots.length - 1; i >= 0; i--) {
    const v = snapshots[i][key];
    if (typeof v === 'number') return v;
  }
  return null;
}

export function Trends() {
  const [range, setRange] = useState<Range>('30d');
  const [state, setState] = useState<FetchState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetch(`/api/trends?range=${range}`)
      .then(async r => {
        if (!r.ok) throw new Error(`API failed: ${r.status}`);
        return r.json() as Promise<TrendsResponse>;
      })
      .then(data => { if (!cancelled) setState({ status: 'success', data }); })
      .catch(err => { if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) }); });
    return () => { cancelled = true; };
  }, [range]);

  if (state.status === 'loading') return <div className="text-white/40 text-sm">Loading...</div>;
  if (state.status === 'error') return <ErrorBanner message={state.message} />;

  const { snapshots, gitEnabled } = state.data;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-white text-xl font-semibold">Trends</h1>
        <TrendsRangePicker value={range} onChange={setRange} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <SparklineCard
          label="Dead files"
          currentValue={lastNonNull(snapshots, 'deadFiles')}
          series={pick(snapshots, 'deadFiles')}
          goodDirection="down"
          format={fmtCount}
          gitEnabled={gitEnabled}
        />
        <SparklineCard
          label="Avg bus factor"
          currentValue={lastNonNull(snapshots, 'avgBusFactor')}
          series={pick(snapshots, 'avgBusFactor')}
          goodDirection="up"
          format={fmtBus}
          gitRequired
          gitEnabled={gitEnabled}
        />
        <SparklineCard
          label="High-risk files"
          currentValue={lastNonNull(snapshots, 'highRiskFiles')}
          series={pick(snapshots, 'highRiskFiles')}
          goodDirection="down"
          format={fmtCount}
          gitRequired
          gitEnabled={gitEnabled}
        />
        <SparklineCard
          label="Churn lines / week"
          currentValue={lastNonNull(snapshots, 'churnLinesLast7d')}
          series={pick(snapshots, 'churnLinesLast7d')}
          goodDirection="down"
          format={fmtChurn}
          gitRequired
          gitEnabled={gitEnabled}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire the route**

Open `apps/dashboard/client/src/App.tsx`. Add the import:

```tsx
import { Trends } from './pages/Trends.tsx';
```

Add the route inside the Layout `<Route>`:

```tsx
<Route path="trends" element={<Trends />} />
```

So the final block looks like (with surrounding routes preserved):

```tsx
<Route element={<Layout />}>
  <Route index element={<Overview />} />
  <Route path="graph" element={<GraphView />} />
  <Route path="risk" element={<RiskTable />} />
  <Route path="trends" element={<Trends />} />
  <Route path="communities" element={<Communities />} />
  <Route path="ownership" element={<Ownership />} />
  <Route path="guide" element={<Guide />} />
</Route>
```

- [ ] **Step 6: Add nav entry**

Open `apps/dashboard/client/src/components/Layout.tsx`. Update the `NAV` array — insert the trends entry between `'/risk'` and `'/communities'`:

```tsx
const NAV = [
  { to: '/', label: 'Overview', icon: '◈' },
  { to: '/graph', label: 'Graph', icon: '⬡' },
  { to: '/risk', label: 'Risk', icon: '⚠' },
  { to: '/trends', label: 'Trends', icon: '⤴' },
  { to: '/communities', label: 'Communities', icon: '⬡⬡' },
  { to: '/ownership', label: 'Ownership', icon: '◎' },
  { to: '/guide', label: 'Guide', icon: '◉' },
];
```

- [ ] **Step 7: Run the component tests**

Run: `npx vitest run apps/dashboard/tests/Trends.test.tsx --config apps/dashboard/vitest.config.ts`
Expected: All 4 tests pass.

- [ ] **Step 8: Run the full dashboard test suite**

Run: `cd apps/dashboard && npx vitest run`
Expected: All dashboard tests pass.

- [ ] **Step 9: Run the root test suite**

Run: `npm test`
Expected: All ≥553 + new tests pass.

- [ ] **Step 10: Verify lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 11: Manual UI smoke test**

Run:
```bash
cd apps/dashboard && npm run dev:client &
cd apps/dashboard && CTXLOOM_ROOT=$(git rev-parse --show-toplevel) npm run dev:server &
```
Open `http://localhost:5173/trends` in a browser.

Expected:
- Page loads with the title "Trends"
- 4 cards visible (with empty-state copy if no snapshots accumulated yet)
- Range picker showing 7d / 30d / 90d
- Clicking a different range triggers a new fetch (visible in DevTools Network tab)
- Nav sidebar has "⤴ Trends" between Risk and Communities

Stop the dev servers when done.

- [ ] **Step 12: Commit**

```bash
git add apps/dashboard/client/src/pages/Trends.tsx apps/dashboard/client/src/App.tsx apps/dashboard/client/src/components/Layout.tsx apps/dashboard/tests/Trends.test.tsx apps/dashboard/package.json apps/dashboard/package-lock.json
git commit -m "feat(dashboard): add Trends page with 2x2 sparkline grid and range picker"
```

---

## Final verification

- [ ] **Run the entire test suite**

```bash
npm test
cd apps/dashboard && npx vitest run
```

Expected: all green.

- [ ] **Verify TypeScript compiles cleanly**

```bash
npm run lint
```

Expected: exit code 0.

- [ ] **Verify production build still works**

```bash
npm run build
```

Expected: completes; `dist/index.js` exists; no `@ctxloom/core` runtime resolution errors at startup.

- [ ] **Open a PR**

```bash
git push -u origin feat/dashboard-debt-trends
gh pr create --title "feat(dashboard): debt trends page" --body "$(cat <<'EOF'
## Summary
- Adds a `/trends` page to the ctxloom dashboard with a 2×2 grid of sparkline cards: dead files, avg bus factor, high-risk files, and weekly churn lines.
- Recording is hooked into the existing indexing pipeline (CLI, MCP, file watcher, dashboard refresh) so trends update continuously without a separate scheduler.
- New `packages/core/src/trends/` module: `recordTrendSnapshot` (write) + `loadTrendSeries` (read), backed by an append-only JSONL file at `.ctxloom/trends/snapshots.jsonl`.
- 5-minute / 1% throttle collapses rapid re-indexes into a single point so the file stays small.

## Test plan
- [ ] `npm test` — all root tests green (553 baseline + ~16 new)
- [ ] `cd apps/dashboard && npx vitest run` — dashboard tests green
- [ ] `npm run lint` — `tsc --noEmit` clean
- [ ] `npm run build` — production build still works
- [ ] Manual: open `/trends` in dev mode, verify 4 cards render and range picker triggers fresh fetches
EOF
)"
```

---

## Spec coverage check

| Spec section | Tasks |
|---|---|
| Architecture & module split | 1, 6, 12 |
| Data model (TrendSnapshot, TrendSeries, TrendSource) | 1 |
| Storage path `.ctxloom/trends/snapshots.jsonl` | 3, 4 |
| Recorder public surface | 3, 4, 5 |
| Throttle (5 min / 1% / integer-floor) | 4 |
| Hook point: `afterReady` callback | 7 |
| Hook wiring (CLI / MCP / dashboard / watcher) | 8, 9, 10 |
| Error handling (swallow + return null) | 5 |
| Concurrency (POSIX append) | 3 (implementation choice) |
| Store public surface + filtering + limit | 2 |
| Malformed-line tolerance | 2 |
| `gitEnabled` derivation | 2 |
| `GET /api/trends` route + range mapping | 12 |
| `TrendsResponse` type | 12 |
| Client `api.trends` method | 12 |
| `computeDelta` helper | 13 |
| `SparklineCard` component (states: empty, git-disabled, populated) | 14, 16 |
| `TrendsRangePicker` component | 15 |
| Trends page layout (2×2) | 16 |
| Nav integration in `App.tsx` and `Layout.tsx` | 16 |
| Pipeline smoke test | 11 |
| All testing layers (recorder, store, route, delta, page) | 2, 3, 4, 5, 11, 12, 13, 16 |
