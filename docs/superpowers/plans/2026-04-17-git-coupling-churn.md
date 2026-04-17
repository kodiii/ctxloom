# ctxloom — Git-History Coupling & Risk Overlay

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn ctxloom's static graph into a *risk map* by fusing git history — co-change coupling, churn, bug-fix density, and blame-weighted ownership — onto the AST/call graph. Adds two new MCP tools (`ctx_git_coupling`, `ctx_risk_overlay`), enriches `ctx_detect_changes` with a `risk` block, and adds a `historicalCoupling` section to `ctx_blast_radius` surfacing nodes that co-change historically but aren't reachable via imports.

**Architecture:** A `GitHistoryMiner` streams `git log --numstat` events into three in-memory indices: `CoChangeIndex` (sparse pair matrix persisted to LanceDB table `cochange`), `ChurnIndex`, and `OwnershipIndex` (compact JSON sidecar at `.ctxloom/git-overlay.json`). File-level attribution for v1 (a commit touching file F contributes to every function node in F). Recency decay is applied at query time, not write time, so incremental updates only append. Incremental refresh tracks `lastCommitScanned` SHA in `.ctxloom/graph-snapshot.json`.

**Tech Stack:** TypeScript/ESM, `simple-git` v3.x, existing LanceDB dependency, vitest. One new npm dependency.

---

## File Map

### Created
| File | Responsibility |
|------|---------------|
| `src/git/GitHistoryMiner.ts` | Streams `git log` events (SHA, author, timestamp, files changed, +/- lines, message) |
| `src/git/CoChangeIndex.ts` | Sparse pair matrix, Jaccard + recency-decayed confidence, LanceDB persistence |
| `src/git/ChurnIndex.ts` | Per-node churn + bug-fix density + author entropy |
| `src/git/OwnershipIndex.ts` | Blame-weighted ownership, staleness, bus-factor |
| `src/git/GitOverlayStore.ts` | Loads/saves `.ctxloom/git-overlay.json` sidecar; coordinates the three indices |
| `src/tools/git-coupling.ts` | `ctx_git_coupling` tool |
| `src/tools/risk-overlay.ts` | `ctx_risk_overlay` tool |
| `tests/GitHistoryMiner.test.ts` | Unit tests with a synthetic git fixture |
| `tests/CoChangeIndex.test.ts` | Scoring, decay, noise filter |
| `tests/ChurnIndex.test.ts` | Accumulation + bug regex |
| `tests/OwnershipIndex.test.ts` | Blame weighting + entropy |
| `tests/GitOverlayStore.test.ts` | Incremental update, snapshot persistence |
| `tests/GitCouplingTool.test.ts` | End-to-end tool test |
| `tests/RiskOverlayTool.test.ts` | End-to-end tool test |

### Modified
| File | What changes |
|------|-------------|
| `src/tools/detect-changes.ts` | Enrich each changed file with `risk: { churn, bugDensity, coupledNodes[], owners[] }` |
| `src/tools/blast-radius.ts` | Add `historicalCoupling` section listing co-changed but not statically-reachable nodes |
| `src/tools/index.ts` | Register `git_coupling`, `risk_overlay` |
| `src/tools/context.ts` | Expose `GitOverlayStore` on `ServerContext` |
| `src/index.ts` | Add 2 new tools to `--help`; wire overlay store bootstrap into indexer |
| `src/indexer/` (startup) | After graph build, ensure overlay is current (incremental mine) |
| `package.json` | Add `simple-git` dependency |
| `.ctxloom/graph-snapshot.json` schema | Add `git: { lastCommitScanned, commits, windowDays }` |

---

## Task 1 — GitHistoryMiner

Stream `git log --numstat` and expose a typed event stream. No scoring yet — just parsing.

**Files:**
- Create: `src/git/GitHistoryMiner.ts`
- Create: `tests/GitHistoryMiner.test.ts`
- Modify: `package.json`

- [ ] **Step 1.1: Install simple-git**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npm install simple-git
```

Expected: `package.json` now lists `"simple-git": "^3.x"` in `dependencies`.

- [ ] **Step 1.2: Write failing GitHistoryMiner tests**

Create `tests/GitHistoryMiner.test.ts` that (a) initializes a temp git repo in a `tmp/` directory, (b) creates 3 commits touching overlapping file sets, (c) calls `miner.stream({ sinceDays: 365 })` and asserts events are emitted in reverse-chronological order with `{ sha, author, timestamp, files: Array<{ path, added, deleted }>, message, isMerge }`, (d) asserts merge commits are filtered out, (e) asserts commits touching >50 files (bulk) are flagged with `isBulk: true`.

- [ ] **Step 1.3: Implement GitHistoryMiner**

Public API:

```typescript
export interface GitCommitEvent {
  sha: string;
  author: string;
  authorEmail: string;
  timestamp: number; // unix seconds
  message: string;
  files: Array<{ path: string; added: number; deleted: number }>;
  isMerge: boolean;
  isBulk: boolean;
}

export interface MinerOptions {
  sinceDays?: number; // default 365
  sinceSha?: string;  // if set, overrides sinceDays (incremental)
  bulkThreshold?: number; // default 50
  excludePaths?: string[]; // default ['node_modules/', 'dist/', '.ctxloom/']
}

export class GitHistoryMiner {
  constructor(private repoRoot: string) {}
  async *stream(opts?: MinerOptions): AsyncIterable<GitCommitEvent>;
  async headSha(): Promise<string>;
}
```

Use `simple-git`'s `raw(['log', '--numstat', '--format=…'])` for deterministic output. Parse in chunks; don't buffer the whole log.

- [ ] **Step 1.4: Run tests**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npm test -- GitHistoryMiner
```

Expected: all GitHistoryMiner tests pass.

---

## Task 2 — CoChangeIndex

Sparse pair matrix with Jaccard + recency-decayed confidence. File-level only (node attribution happens in a later task via file→nodes lookup).

**Files:**
- Create: `src/git/CoChangeIndex.ts`
- Create: `tests/CoChangeIndex.test.ts`

- [ ] **Step 2.1: Write failing CoChangeIndex tests**

Assertions:
- Pair `(A, B)` with 10 shared commits out of `|A|=12, |B|=14` returns jaccard ≈ `10/16`.
- `confidence(A, B, now)` with half-life 90d and `lastSharedCommit = now - 90d` returns half of same-day confidence.
- Pairs with `sharedCommits < 3` are not returned from `topFor(node, minConfidence=0)`.
- `topFor('src/a.ts', limit=5)` returns descending-confidence list.
- Persistence: `snapshot()` → `load()` round-trips exactly.

- [ ] **Step 2.2: Implement CoChangeIndex**

```typescript
export interface CoChangeStats {
  nodeA: string;
  nodeB: string;
  sharedCommits: number;
  countA: number;
  countB: number;
  lastSharedTimestamp: number;
  jaccard: number;
}

export interface CoChangeQuery {
  node: string;
  limit?: number;         // default 10
  minConfidence?: number; // default 0.05
  now?: number;           // for testability
  halfLifeDays?: number;  // default 90
}

export class CoChangeIndex {
  ingest(event: GitCommitEvent): void;
  topFor(q: CoChangeQuery): Array<CoChangeStats & { confidence: number }>;
  allFor(node: string): CoChangeStats[];
  snapshot(): CoChangeSnapshot;
  static load(s: CoChangeSnapshot): CoChangeIndex;
  size(): { nodes: number; pairs: number };
}
```

Pair generation inside `ingest`: skip `event.isBulk` and `event.isMerge`. For each unordered pair `(a, b)` with `a < b`, increment `sharedCommits` and update `lastSharedTimestamp`. Maintain per-node `countN` independently (incremented once per file per event).

Confidence formula:

```
confidence = jaccard * log(1 + sharedCommits) * exp(-ln(2) * ageDays / halfLifeDays)
```

Drop pairs with `sharedCommits < 3` from `topFor` results.

- [ ] **Step 2.3: Run tests**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npm test -- CoChangeIndex
```

---

## Task 3 — ChurnIndex

Per-node churn + bug-fix density + author entropy. Same "node" granularity as CoChange (file-level v1).

**Files:**
- Create: `src/git/ChurnIndex.ts`
- Create: `tests/ChurnIndex.test.ts`

- [ ] **Step 3.1: Write failing tests**

- Ingesting 5 commits of +10/-5 lines on `src/a.ts` gives `churnLines = 75`.
- Bug regex `/\b(fix|bug|hotfix|revert)\b/i` matches `"fix: null deref"` but not `"refactor: rename var"`.
- `bugDensity` = bug-matching commits / total commits touching node.
- `authorEntropy` of a node touched exclusively by one author is 0; evenly by two authors is 1.0 (base-2 entropy).

- [ ] **Step 3.2: Implement ChurnIndex**

```typescript
export interface ChurnStats {
  node: string;
  commits: number;
  churnLines: number;
  bugCommits: number;
  bugDensity: number;
  authorEntropy: number;
  lastTouch: number;
}

export class ChurnIndex {
  ingest(event: GitCommitEvent): void;
  statsFor(node: string): ChurnStats | null;
  snapshot(): ChurnSnapshot;
  static load(s: ChurnSnapshot): ChurnIndex;
}
```

Store per-node `{ commits, churnLines, bugCommits, authorCounts: Map<string, number>, lastTouch }`. Compute entropy and density on demand.

- [ ] **Step 3.3: Run tests**

---

## Task 4 — OwnershipIndex

Blame-weighted ownership share + staleness + bus-factor.

**Files:**
- Create: `src/git/OwnershipIndex.ts`
- Create: `tests/OwnershipIndex.test.ts`

- [ ] **Step 4.1: Write failing tests**

- `ownersFor(node)` returns list of `{ author, share }` sorted descending; shares sum to 1.
- Weight each commit by `added + deleted` lines so formatting-only commits barely move ownership.
- `stalenessDays` = days since `lastTouch`; `busFactor = min k such that top-k owners cover 50% share`.

- [ ] **Step 4.2: Implement OwnershipIndex**

```typescript
export interface OwnerShare { author: string; email: string; share: number }
export interface OwnershipStats {
  node: string;
  owners: OwnerShare[];
  stalenessDays: number;
  busFactor: number;
}

export class OwnershipIndex {
  ingest(event: GitCommitEvent): void;
  statsFor(node: string): OwnershipStats | null;
  snapshot(): OwnershipSnapshot;
  static load(s: OwnershipSnapshot): OwnershipIndex;
}
```

- [ ] **Step 4.3: Run tests**

---

## Task 5 — GitOverlayStore

Coordinator: drives the miner, fans events into the three indices, loads/saves the sidecar, handles incremental refresh.

**Files:**
- Create: `src/git/GitOverlayStore.ts`
- Create: `tests/GitOverlayStore.test.ts`

- [ ] **Step 5.1: Write failing tests**

- `rebuild()` on a synthetic 3-commit repo populates all three indices with correct counts.
- `refresh()` on the same repo with one additional commit only ingests that commit (verify by spying on `ingest`).
- `saveSnapshot()` writes `.ctxloom/git-overlay.json`; `loadSnapshot()` restores exactly.
- On empty repo, all queries return empty results (no crashes).

- [ ] **Step 5.2: Implement GitOverlayStore**

```typescript
export interface OverlayBootstrapOptions {
  windowDays?: number;       // default 365
  bulkThreshold?: number;    // default 50
  excludePaths?: string[];
}

export class GitOverlayStore {
  readonly coChange: CoChangeIndex;
  readonly churn: ChurnIndex;
  readonly ownership: OwnershipIndex;

  constructor(private repoRoot: string, opts?: OverlayBootstrapOptions);

  async rebuild(): Promise<void>;
  async refresh(): Promise<{ commitsIngested: number; newHead: string }>;
  saveSnapshot(): Promise<void>;
  loadSnapshot(): Promise<boolean>; // false if no snapshot
  stats(): { commits: number; lastCommit: string | null; windowDays: number };
}
```

Sidecar path: `path.join(repoRoot, '.ctxloom', 'git-overlay.json')`. Format:

```json
{
  "version": 1,
  "lastCommitScanned": "<sha>",
  "windowDays": 365,
  "coChange": { /* sparse */ },
  "churn": { /* per-node */ },
  "ownership": { /* per-node */ }
}
```

- [ ] **Step 5.3: Run tests**

---

## Task 6 — `ctx_git_coupling` tool

Given a file, return top co-changed siblings.

**Files:**
- Create: `src/tools/git-coupling.ts`
- Create: `tests/GitCouplingTool.test.ts`
- Modify: `src/tools/context.ts` (add `overlay: GitOverlayStore` to `ServerContext`)
- Modify: `src/tools/index.ts`

- [ ] **Step 6.1: Write failing tool test**

Build a fake `ServerContext` with a `GitOverlayStore` pre-populated via `ingest()` from synthetic events. Call the tool with `{ file: 'src/a.ts', limit: 3 }` and assert the response lists expected siblings with `confidence`, `sharedCommits`, `lastSharedDaysAgo`, and an `explanation` string like `"Changed together in 14 of last 50 commits; last co-change 3 days ago."`.

- [ ] **Step 6.2: Implement tool**

Schema:

```typescript
const Schema = z.object({
  file: z.string(),
  limit: z.number().int().min(1).max(50).default(10),
  min_confidence: z.number().min(0).max(1).default(0.05),
  half_life_days: z.number().int().min(1).max(3650).default(90),
});
```

Call `ctx.overlay.coChange.topFor({ ... })`, format response. Include a top-level `note` if `ctx.overlay.stats().commits === 0` explaining that the overlay has no data yet and suggesting `ctxloom index --with-git` (flag added in Task 10).

- [ ] **Step 6.3: Register tool in `src/tools/index.ts`**

```typescript
import { registerGitCouplingTool } from './git-coupling.js';
// ...
registerGitCouplingTool(registry, ctx);
```

- [ ] **Step 6.4: Run tests**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npm test -- GitCouplingTool
```

---

## Task 7 — `ctx_risk_overlay` tool

Given an array of files/nodes, return per-node risk block + aggregate score.

**Files:**
- Create: `src/tools/risk-overlay.ts`
- Create: `tests/RiskOverlayTool.test.ts`
- Modify: `src/tools/index.ts`

- [ ] **Step 7.1: Write failing test**

- For a node with `churnLines > 500`, `bugDensity > 0.25`, and `busFactor === 1`, risk level is `"high"` and aggregate score ≥ 0.7.
- For a low-activity node, risk level is `"low"`.

- [ ] **Step 7.2: Implement scoring**

```typescript
function riskScore(churn: ChurnStats, own: OwnershipStats, coupling: number): number {
  const churnPart = Math.min(1, churn.churnLines / 1000);
  const bugPart = Math.min(1, churn.bugDensity * 2);
  const ownerPart = own.busFactor === 1 ? 0.6 : own.busFactor === 2 ? 0.3 : 0.1;
  const couplingPart = Math.min(1, coupling / 5); // 5+ strong couplings = saturate
  return 0.35 * churnPart + 0.30 * bugPart + 0.20 * ownerPart + 0.15 * couplingPart;
}
```

Schema:

```typescript
const Schema = z.object({
  nodes: z.array(z.string()).min(1).max(200),
});
```

- [ ] **Step 7.3: Register + test**

---

## Task 8 — Enrich `ctx_detect_changes`

Add a `risk` block per changed file. Additive, non-breaking.

**Files:**
- Modify: `src/tools/detect-changes.ts`
- Modify: `tests/DetectChanges.test.ts` (assumes existing test file)

- [ ] **Step 8.1: Extend test**

For a changed file with pre-populated overlay data, assert the response includes:

```json
"risk": {
  "churn": "high",
  "bugDensity": 0.22,
  "coupledNodes": [{ "node": "src/pricing/rules.ts", "confidence": 0.62 }],
  "owners": [{ "author": "alice", "share": 0.62 }]
}
```

For a file with no overlay data, `risk` is `null` (not missing).

- [ ] **Step 8.2: Implement enrichment**

In `registerDetectChangesTool`, after computing each changed file's static risk, look up `ctx.overlay?.churn.statsFor(file)`, `ownership.statsFor(file)`, and `coChange.topFor({ node: file, limit: 3 })`. Bucket churn into `low|medium|high` using percentile over all indexed nodes (compute once and cache on overlay).

Guard: if `ctx.overlay` is undefined (overlay disabled), set `risk: null` and add a single top-level note once.

- [ ] **Step 8.3: Run tests**

---

## Task 9 — `ctx_blast_radius` historical-surprise section

Add nodes strongly coupled to the seed set but outside the static impact set.

**Files:**
- Modify: `src/tools/blast-radius.ts`
- Modify: `tests/BlastRadius.test.ts` (or equivalent)

- [ ] **Step 9.1: Extend test**

Seed impact set `{ A }`; add overlay data coupling `A` ↔ `Z` strongly but `Z` is not import-reachable from `A`. Assert response has:

```json
"historicalCoupling": [
  { "node": "Z", "confidence": 0.62, "evidence": "14 of last 50 commits..." }
]
```

- [ ] **Step 9.2: Implement**

After the BFS that builds the static impact set, for each seed call `ctx.overlay.coChange.topFor({ node: seed, limit: 10, minConfidence: 0.2 })`, subtract any node already in the static set, deduplicate across seeds, keep top 10 by confidence. Field is `[]` when overlay is empty.

- [ ] **Step 9.3: Run tests**

---

## Task 10 — Indexer wiring + CLI flag

Bootstrap the overlay as part of `ctxloom index` and expose `--with-git` / `--no-git` flags.

**Files:**
- Modify: `src/index.ts`
- Modify: `src/indexer/` (entrypoint where graph is built)
- Modify: `src/tools/context.ts`

- [ ] **Step 10.1: Add flag to CLI**

`--with-git` (default true), `--no-git` (opt-out), `--git-window-days=<n>` (default 365).

- [ ] **Step 10.2: Bootstrap overlay**

After graph build completes:

```typescript
if (opts.withGit) {
  const overlay = new GitOverlayStore(rootDir, { windowDays: opts.gitWindowDays });
  const loaded = await overlay.loadSnapshot();
  if (!loaded) {
    await overlay.rebuild();
  } else {
    await overlay.refresh();
  }
  await overlay.saveSnapshot();
  ctx.overlay = overlay;
}
```

- [ ] **Step 10.3: Add `git` section to graph snapshot**

In `DependencyGraph.SnapshotManager` (or equivalent), extend the snapshot JSON shape with `git: { lastCommitScanned, commits, windowDays }`. Old snapshots without this section load fine (treat as missing overlay).

- [ ] **Step 10.4: Add `--help` entries**

Document `ctx_git_coupling`, `ctx_risk_overlay`, and the new flags in the help output.

- [ ] **Step 10.5: End-to-end smoke test**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npm run build && node dist/index.js index . --with-git --git-window-days=90
cat .ctxloom/git-overlay.json | head -5
```

Expected: file exists, non-empty, valid JSON.

---

## Task 11 — Incremental update on commit

Pick up new commits without a full rebuild.

**Files:**
- Modify: `src/watcher/` (existing watcher tick)
- Create: `tests/GitOverlayIncremental.test.ts`

- [ ] **Step 11.1: Write failing test**

On a watcher tick with a new commit since `lastCommitScanned`, assert overlay stats show the new commit count incremented and the new file's churn is updated.

- [ ] **Step 11.2: Hook watcher**

In the watcher loop (or a dedicated git-poll tick every 60s), call `overlay.refresh()` then `overlay.saveSnapshot()`. Debounce to at most once per 30s.

- [ ] **Step 11.3: Document manual trigger**

Add a one-liner to README: "If you use a non-standard git workflow, run `ctxloom refresh --git-only` to update the overlay on demand."

---

## Task 12 — Docs & README

- [ ] **Step 12.1: Add README section "Risk overlay"**

Cover: what it does, when it activates, opt-out flag, privacy note (overlay is local-only, never leaves the machine), first-run cost (~30–90s on large repos).

- [ ] **Step 12.2: Add tool docs**

For `ctx_git_coupling` and `ctx_risk_overlay`, document inputs, output shape, and a worked example.

- [ ] **Step 12.3: Update competitive comparison table**

In the competitive parity doc (`docs/superpowers/plans/2026-04-16-competitive-parity-sprint.md` or its successor), add a "Risk overlay" row marking it as a ctxloom-exclusive differentiator.

---

## Out of scope (deliberately)

- Exact hunk→AST-node attribution across history (file-level is good enough for v1).
- Multi-repo coupling (separate feature, cross-repo graph).
- ML-based reviewer suggestion (blame-weighted shares are sufficient).
- UI — this plan is data + MCP tools only; the PR bot plan is the user-facing surface.
