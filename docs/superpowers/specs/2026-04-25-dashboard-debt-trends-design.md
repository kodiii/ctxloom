# Dashboard Debt Trends — Design Spec

**Date:** 2026-04-25
**Status:** Approved for planning
**Predecessor:** Phase 1, tasks 1.1–1.3 of the ctxloom roadmap
**Depends on:** Completed `packages/core` extraction (spec 2026-04-24)

## Goal

Add a **Trends** page to the ctxloom dashboard showing how code-health metrics evolve over time: dead files, average bus factor, high-risk files, and weekly churn lines. Data updates continuously as a side-effect of normal indexing — no separate scheduler, no user action required.

## Non-Goals

- Cyclomatic complexity tracking (no complexity analyzer exists yet; out of scope for this phase).
- Historical backfill from git log (re-mining past commits is slow and brittle; YAGNI — trends start accumulating from the day this ships).
- Retention / pruning controls (JSONL growth is trivial; add `ctxloom trends prune` later if ever needed).
- Per-file trend drill-downs (aggregate-only in this phase).
- Export to CSV/PNG (YAGNI).

## Architecture

Three new modules with narrow responsibilities. Two live in `packages/core` (reusable + unit-testable without the dashboard), one in `apps/dashboard`:

```
packages/core/src/trends/
  ├─ TrendsRecorder.ts    ← write path: compute metrics + append/collapse to JSONL
  ├─ TrendsStore.ts       ← read path: stream-parse JSONL, bounded + sorted
  ├─ types.ts             ← TrendSnapshot, TrendSeries, TrendSource
  └─ index.ts             ← barrel

apps/dashboard/server/routes/
  └─ trends.ts            ← GET /api/trends → calls TrendsStore.loadTrendSeries()

apps/dashboard/client/src/
  ├─ pages/Trends.tsx                    ← 2×2 sparkline grid
  └─ components/SparklineCard.tsx        ← one card: label + value + delta badge + chart
  └─ components/TrendsRangePicker.tsx    ← 7d / 30d / 90d segment control
```

### Why this split?

- **Recorder vs Store.** The recorder runs as a side-effect of indexing (write). The store runs on every dashboard request (read). Separating them allows unit-testing recorder logic against a tmpdir without pulling in Express, and lets the MCP server later expose a `ctx_trends_query` tool without duplicating read logic.
- **Core vs dashboard.** The recorder composes `DependencyGraph + GitOverlayStore` — the same pattern `apps/dashboard/server/routes/overview.ts` already uses. Keeping it in core means any indexing entry point (watcher, MCP, CLI, dashboard-refresh) can record without taking a dashboard dependency.
- **Not inline in `DependencyGraph.saveSnapshot()`.** The graph layer shouldn't know about git overlay metrics. A dedicated recorder keeps composition clean.

### Public exports from `@ctxloom/core`

Added to `packages/core/src/index.ts`:

```typescript
export { recordTrendSnapshot } from './trends/TrendsRecorder.js';
export { loadTrendSeries } from './trends/TrendsStore.js';
export type { TrendSnapshot, TrendSeries, TrendSource } from './trends/types.js';
```

## Data model

### Storage

One append-only file: `.ctxloom/trends/snapshots.jsonl`. One JSON object per line. Sorted ascending by append order (≈ ascending by timestamp, modulo the collapse rule described below).

### Row schema

```typescript
// packages/core/src/trends/types.ts

export type TrendSource = 'watcher' | 'mcp' | 'cli' | 'dashboard' | 'manual';

export interface TrendSnapshot {
  /** ISO-8601 UTC, e.g. "2026-04-25T14:37:02.145Z" */
  timestamp: string;
  /** Unix seconds — redundant with timestamp, cheap to sort/filter by */
  unixSeconds: number;

  // graph-derived (always present)
  totalFiles: number;
  totalEdges: number;
  /** Files with zero importers AND not an entry point (matches knowledge-gaps.ts rule) */
  deadFiles: number;

  // git-derived (null when gitEnabled=false)
  /** Mean busFactor across all files with ≥1 commit */
  avgBusFactor: number | null;
  /** Files whose risk score > 0.6 (matches Overview.tsx thresholds) */
  highRiskFiles: number | null;
  /** Σ (added+deleted) across commits in the last 7 calendar days */
  churnLinesLast7d: number | null;

  // provenance
  /** What triggered this snapshot */
  source: TrendSource;
  /** Short-SHA of HEAD at record time, or null if not a git repo */
  gitSha: string | null;
}

export interface TrendSeries {
  /** Ascending by timestamp */
  snapshots: TrendSnapshot[];
  gitEnabled: boolean;
  /** Total rows on disk (may exceed snapshots.length if bounded by `limit`) */
  totalCount: number;
}
```

### Why these choices?

- **JSONL, not JSON.** Append-only writes never rewrite the file → safe under concurrent indexers. Reading is a single-pass line parse — no full-document materialisation.
- **`source` provenance.** Lets future tooling filter out watcher storms during debugging, or segment analytics by trigger type.
- **`gitSha`.** Enables annotating spikes with the HEAD commit ("this churn jump corresponds to abc1234"). Cheap — `simple-git` is already a dependency.
- **Nullable git fields.** Honest about state when git is disabled. Dashboard shows "git history disabled" rather than fabricating zeros.
- **No schema version field.** JSONL tolerates unknown fields; old readers simply ignore new keys. Breaking changes get a filename bump (`snapshots-v2.jsonl`).

### Example row

```json
{"timestamp":"2026-04-25T14:37:02.145Z","unixSeconds":1777073822,"totalFiles":412,"totalEdges":1823,"deadFiles":12,"avgBusFactor":2.4,"highRiskFiles":6,"churnLinesLast7d":8234,"source":"watcher","gitSha":"3f105dc"}
```

~240 bytes per row. One row per active minute after throttling ≈ 350 KB / year of heavy use.

## Recorder — write path

### Public surface

```typescript
// packages/core/src/trends/TrendsRecorder.ts

export interface RecordOptions {
  graph: DependencyGraph;
  overlay: GitOverlayStore;
  gitEnabled: boolean;
  rootDir: string;
  source: TrendSource;
  /** Override "now" for testing. Default: Date.now */
  now?: () => number;
}

/**
 * Compute current metrics and append (or collapse) a row in
 * `${rootDir}/.ctxloom/trends/snapshots.jsonl`.
 *
 * Returns the row that was persisted, or null on error.
 * Never throws — failures are logged and swallowed so indexing
 * is never broken by trend recording.
 */
export async function recordTrendSnapshot(
  opts: RecordOptions,
): Promise<TrendSnapshot | null>;
```

### Throttle rule (collapse rapid re-indexes)

```
IF last row exists AND
   (now - last.unixSeconds) < 300 seconds AND
   no metric differs from last by more than 1% (or by an absolute floor
   of 1 for small-integer metrics like deadFiles / highRiskFiles / totalFiles)
THEN overwrite last row with the new row (the last line of the file is replaced)
ELSE append a new row
```

Handles both common cases cleanly:

- Watcher fires 4× in 30 seconds while you save a file → single collapsed row.
- A file actually becomes dead (`deadFiles` 12 → 11) → always appended because the absolute-1 floor is breached.

### Overwrite mechanics

To replace the last line atomically on a plain JSONL file:

1. `fs.stat` to get file length.
2. Read the last ~4 KB (enough for one row).
3. Find the start of the last line (byte offset of the last `\n` before EOF, or 0).
4. `fs.truncate` to that offset + 1 (keep the `\n`).
5. `fs.appendFile` the replacement row.

This keeps the file strictly append-only from an external reader's perspective (no in-place edits of middle rows).

### Hook point

In `packages/core/src/graph/DependencyGraph.ts:180`, `buildFromDirectory()` calls `this.saveSnapshot()`. We do **not** call the recorder directly from there — that would force `DependencyGraph` to know about `GitOverlayStore`.

Instead, add an optional callback parameter:

```typescript
interface BuildOptions {
  afterSave?: () => Promise<void>;
}

async buildFromDirectory(rootDir: string, options?: BuildOptions): Promise<void>;
```

Every indexing caller wires its own recorder invocation:

| Caller | Wires callback with source |
|---|---|
| `src/index.ts` (CLI entry, two call sites) | `'cli'` |
| `apps/dashboard/server/loader.ts` | `'dashboard'` |
| `src/server.ts` (MCP server initial build at startup) | `'mcp'` |
| `src/server.ts` (`FileWatcher` onChange callback) | `'watcher'` |

The MCP server and watcher share the same file (`src/server.ts`) — the initial `buildFromDirectory` at startup records with source `'mcp'`, and the watcher's `onChange` calls `recordTrendSnapshot({ source: 'watcher', ... })` after each incremental reindex. `apps/pr-bot/src/handlers/pullRequest.ts` deliberately does **not** record trends — PR bot runs are ephemeral per-PR and would pollute the series.

### Error handling

- File-append failure (disk full, permission denied): log via existing logger, return `null`, don't throw.
- Malformed pre-existing JSONL (user hand-edited the file): treat an unreadable last row as "no last row" and append fresh.
- `.ctxloom/trends/` directory missing: `mkdir -p` on first write.

### Concurrency

Multiple processes could attempt appends simultaneously (watcher + MCP + dashboard). POSIX `O_APPEND` writes of a single <4 KB line are atomic on local filesystems — parallel appends cannot interleave. The throttle's read-then-truncate-then-append path is the only race: worst case two processes both append instead of one collapsing, producing a harmless extra row. No locking in v1.

## Store — read path

### Public surface

```typescript
// packages/core/src/trends/TrendsStore.ts

export interface LoadOptions {
  rootDir: string;
  /** Only return rows with unixSeconds >= this. Default: now - 30 days. */
  sinceUnixSeconds?: number;
  /** Max rows to return (newest N if series is longer). Default: 500. */
  limit?: number;
}

export async function loadTrendSeries(opts: LoadOptions): Promise<TrendSeries>;
```

### Behavior

- If `.ctxloom/trends/snapshots.jsonl` doesn't exist → return `{ snapshots: [], gitEnabled: false, totalCount: 0 }`.
- Stream-parse line by line; skip malformed lines (log at `warn`, don't throw).
- Apply `sinceUnixSeconds` filter, then keep the tail `limit` rows, sorted ascending.
- `gitEnabled` is derived from the newest retained row: true iff any git-derived field is non-null.

## API route

### `GET /api/trends`

Mounted in `apps/dashboard/server/index.ts` next to the other routes.

**Query parameters:**

| Param | Values | Default |
|---|---|---|
| `range` | `7d` \| `30d` \| `90d` \| `all` | `30d` |
| `limit` | integer 1-5000 | `500` |

**Response:** `TrendsResponse` — added to `apps/dashboard/server/types.ts`:

```typescript
export interface TrendsResponse {
  snapshots: TrendSnapshot[];   // ascending by timestamp
  gitEnabled: boolean;
  totalCount: number;           // rows on disk
  range: '7d' | '30d' | '90d' | 'all';
}
```

**Client:** Added to `apps/dashboard/client/src/lib/api.ts`:

```typescript
trends: (range: '7d' | '30d' | '90d' | 'all' = '30d') =>
  get<TrendsResponse>(`/trends?range=${range}`),
```

Handler implementation: ~30 lines — parse + validate query, call `loadTrendSeries`, echo into response.

## Client — Trends page

### Layout (from brainstorming visual companion — Option B)

A 2×2 grid of sparkline cards matching the existing `grid-cols-2 gap-4 lg:grid-cols-4` rhythm.

```
┌────────────────┬────────────────┐
│  Dead files    │  Avg bus factor│
│     12 ↓ 3     │    2.4 → stable│
│  ▁▂▃▅█▅         │  ▃▄▅▄▃         │
├────────────────┼────────────────┤
│  High-risk     │  Churn lines/wk│
│    6 ↓ 25%     │    8.2k ↑ 12%  │
│  ▅▆▅▄▂          │  ▂▃▅▆█          │
└────────────────┴────────────────┘
```

Range picker above the grid: `7d / 30d / 90d`. Default `30d`.

### New components

**`SparklineCard.tsx`** — pure presentation:

```typescript
interface SparklineCardProps {
  label: string;
  /** Latest non-null value, or null if series is empty */
  currentValue: number | null;
  /** Full series values for the chart (may contain nulls) */
  series: Array<{ t: number; v: number | null }>;
  /** "down" means lower is better (deadFiles); "up" means higher is better (busFactor) */
  goodDirection: 'up' | 'down';
  /** How to render the current value: '12 files', '2.4', '8.2k lines' */
  format: (v: number) => string;
  /** Shown when gitEnabled=false and this card depends on git */
  gitRequired?: boolean;
  gitEnabled: boolean;
}
```

**`TrendsRangePicker.tsx`** — three-segment control:

```typescript
interface TrendsRangePickerProps {
  value: '7d' | '30d' | '90d';
  onChange: (next: '7d' | '30d' | '90d') => void;
}
```

### Reused infrastructure

- `recharts` (already a dep) for the sparkline — `<LineChart>` with no axes, no grid, just a stroke.
- `useApi` hook for fetching.
- `ErrorBanner` for error state.
- Color tokens from `Overview.tsx`: `#603dc6` / `#a78bfa` (purple primary), `#22c55e` (green = improving), `#ef4444` (red = worsening), `#fff4` through `#fff6` for muted text.

### Delta-badge helper

```typescript
// apps/dashboard/client/src/lib/trendDelta.ts

export function computeDelta(
  earliest: number,
  latest: number,
  goodDirection: 'up' | 'down',
): { label: string; tone: 'good' | 'bad' | 'neutral' } {
  if (earliest === 0) {
    if (latest === 0) return { label: '→ stable', tone: 'neutral' };
    return goodDirection === 'up'
      ? { label: '↑ new', tone: 'good' }
      : { label: '↑ new', tone: 'bad' };
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

### States

| State | Behavior |
|---|---|
| Loading | `<ErrorBanner>`-sibling spinner (same pattern as Overview) |
| Error | `<ErrorBanner>` with retry |
| Empty (0–1 snapshots) | Card-level "Collecting data — edit some files or run `ctxloom index` to populate trends" |
| Git disabled | Dead-files card renders normally; the three git-dependent cards show a dimmed "Git history disabled" placeholder |
| Populated | Standard render |

### Nav integration

- `App.tsx`: add `<Route path="trends" element={<Trends />} />`
- `Layout.tsx` `NAV` array: insert `{ to: '/trends', label: 'Trends', icon: '⤴' }` between Risk and Communities

## Testing strategy

TDD throughout. Layered to match module boundaries.

### 1. Recorder (unit) — `packages/core/tests/trends/TrendsRecorder.test.ts`

~8 tests, uses tmpdir + injected `now()`:

- appends a first snapshot to a fresh directory
- creates `.ctxloom/trends/` if missing
- collapses a second snapshot within 5 min with <1% delta (1 row on disk)
- appends when any metric exceeds 1% delta within 5 min (2 rows on disk)
- appends when more than 5 min elapsed regardless of delta
- appends when integer metric delta ≥ 1 absolute (deadFiles 1→2 always recorded)
- records null git fields when `gitEnabled=false`
- returns `null` and does not throw when write fails (mocked `fs` rejection)

### 2. Store (unit) — `packages/core/tests/trends/TrendsStore.test.ts`

~6 tests:

- returns empty series when file does not exist
- parses a well-formed JSONL file
- filters by `sinceUnixSeconds`
- applies `limit` by returning the newest N rows
- skips malformed lines and emits a single `warn`
- reports `gitEnabled=false` when newest retained row has null git fields

### 3. API route (integration) — `apps/dashboard/tests/routes/trends.test.ts`

~4 tests using `supertest` (already a dep):

- `GET /api/trends` returns 200 with default range
- `GET /api/trends?range=7d` filters correctly
- `GET /api/trends?range=all` includes all rows
- returns empty array when no snapshots file exists

### 4. Trends page (component) — `apps/dashboard/tests/pages/Trends.test.tsx`

~4 tests using `@testing-library/react` + `jsdom` (already deps):

- renders 4 sparkline cards when data is present
- renders empty-state copy when `snapshots.length < 2`
- shows "Git history disabled" on git-dependent cards when `gitEnabled=false`
- range picker updates the fetched URL

### 5. Delta helper (unit) — `apps/dashboard/tests/lib/trendDelta.test.ts`

~5 tests: zero-baseline edge case, stable within 1%, good-direction match, bad-direction, correct arrow selection.

### 6. Pipeline smoke — `tests/TrendsIntegration.test.ts`

One test: `buildFromDirectory`'s `afterSave` callback is invoked and records a row — boots a tiny fixture repo, runs `buildFromDirectory` with the recorder wired, asserts `.ctxloom/trends/snapshots.jsonl` has one well-formed row.

### Out of scope for tests

- **Watcher → recorder end-to-end** (chokidar races): wiring is two lines; unit-tested recorder + smoke test is sufficient. Flaky watcher tests cost more than they prevent.
- **Visual regression of recharts output**: `recharts` is already trusted; delta-badge logic is isolated and unit-tested.

### Coverage target

≥80% on the three new logic modules: `TrendsRecorder` + `TrendsStore` (both in `packages/core`) and `computeDelta` (in `apps/dashboard`). The Trends page itself is mostly composition — four component tests is sufficient.

## Implementation order (preview for the plan)

1. Types + empty module scaffold in `packages/core/src/trends/`
2. `TrendsStore` + its tests (pure read, no side-effects — easiest to TDD first)
3. `TrendsRecorder` + its tests
4. `recordTrendSnapshot` export wired into `packages/core/src/index.ts`
5. `afterSave` callback on `DependencyGraph.buildFromDirectory` + pipeline smoke test
6. Wiring in CLI entry, dashboard loader, MCP tool, watcher
7. `/api/trends` route + route test
8. `computeDelta` helper + its test
9. `SparklineCard` + `TrendsRangePicker` + Trends page + component tests
10. Nav integration in `App.tsx` and `Layout.tsx`

## Migration & backwards compatibility

- **Existing installs:** `.ctxloom/trends/snapshots.jsonl` doesn't exist on first run after upgrade. The store returns an empty series; the UI shows the empty state; the recorder begins appending on the next index. Zero user action required.
- **Existing snapshot files:** Untouched. `graph-snapshot.json`, `call-graph-snapshot.json`, `git-overlay.json` remain unchanged.
- **Published `ctxloom-pro` binary:** The new exports from `@ctxloom/core` are bundled via `tsup noExternal` (already in place), so the published binary carries recorder + store without any extra build work.
- **`.gitignore`:** `.ctxloom/` is already ignored; the `trends/` subdirectory inherits.

## Success criteria

- Dashboard `/trends` renders 4 sparkline cards with real data after a short period of indexing activity.
- Metrics update within ≤2 seconds of a code edit (watcher re-index + file-change auto-reload are already that fast).
- No regressions in the existing 553 tests.
- ≥80% coverage on the three new core modules.
- Zero disk/runtime cost when the dashboard is not used (recorder writes are O(1)).
