# Auto Reviewer Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `ctxloom review-suggest` and `ctxloom authors-sync` commands (plus a GitHub Action) that recommend PR reviewers from the existing ownership/co-change indexes, and generate/update `.github/CODEOWNERS` from ownership data.

**Architecture:** A pure `ReviewerScorer` function consumes the existing `GitOverlayStore` indexes with no network calls; `AuthorResolver` maps git emails to GitHub handles via a user-maintained YAML file and a cached GitHub API lookup; `CodeownersWriter` emits/updates a CODEOWNERS file between managed markers; a thin GitHub Action entrypoint wraps all three for CI use.

**Tech Stack:** TypeScript (existing tsup build), Vitest (existing test runner), `js-yaml` (add), GitHub REST API via fetch (no extra SDK needed), Node 20 fs/path.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/git/OwnershipIndex.ts` | Modify | Add `allNodes(): string[]` public method |
| `src/review/types.ts` | Create | All shared types for review module |
| `src/review/ReviewerScorer.ts` | Create | Pure scoring function (no I/O) |
| `src/review/AuthorResolver.ts` | Create | email → GitHub handle, yml + API cache |
| `src/review/CodeownersWriter.ts` | Create | Emit/update CODEOWNERS between markers |
| `src/review/index.ts` | Create | Re-export public API |
| `src/index.ts` | Modify | Register `review-suggest` and `authors-sync` commands |
| `actions/review-suggest/action.yml` | Create | GitHub Action manifest |
| `actions/review-suggest/entrypoint.ts` | Create | Action entry point |
| `tests/ReviewerScorer.test.ts` | Create | Unit tests for scorer |
| `tests/AuthorResolver.test.ts` | Create | Unit tests for resolver |
| `tests/CodeownersWriter.test.ts` | Create | Unit tests for writer |

---

## Task 1: Add `allNodes()` to OwnershipIndex

The scorer needs to walk all tracked files. `OwnershipIndex` has a private `nodes` Map — expose it.

**Files:**
- Modify: `src/git/OwnershipIndex.ts`
- Test: `tests/OwnershipIndex.test.ts`

- [ ] **Step 1.1: Add failing test for `allNodes()`**

Open `tests/OwnershipIndex.test.ts` and add after the last existing test:

```ts
it('allNodes returns all tracked file paths', () => {
  const idx = new OwnershipIndex();
  const event = (path: string) => ({
    sha: 'abc', author: 'Alice', authorEmail: 'alice@x.com',
    timestamp: 1_000_000, message: '',
    files: [{ path, added: 5, deleted: 0 }],
    isBulk: false, isMerge: false,
  });
  idx.ingest(event('src/a.ts'));
  idx.ingest(event('src/b.ts'));
  expect(idx.allNodes().sort()).toEqual(['src/a.ts', 'src/b.ts']);
});
```

- [ ] **Step 1.2: Run test to confirm it fails**

```bash
npx vitest run tests/OwnershipIndex.test.ts
```
Expected: `TypeError: idx.allNodes is not a function`

- [ ] **Step 1.3: Add `allNodes()` method to `OwnershipIndex`**

In `src/git/OwnershipIndex.ts`, add inside the class body after the `statsFor` method:

```ts
/** Return all file paths that have ownership data. */
allNodes(): string[] {
  return Array.from(this.nodes.keys());
}
```

- [ ] **Step 1.4: Run test to confirm it passes**

```bash
npx vitest run tests/OwnershipIndex.test.ts
```
Expected: all tests PASS

- [ ] **Step 1.5: Commit**

```bash
git add src/git/OwnershipIndex.ts tests/OwnershipIndex.test.ts
git commit -m "feat(ownership): expose allNodes() for reviewer scoring"
```

---

## Task 2: Shared Types

**Files:**
- Create: `src/review/types.ts`

- [ ] **Step 2.1: Create `src/review/types.ts`**

```ts
// ---------------------------------------------------------------------------
// Review config (loaded from .ctxloom/review.yml)
// ---------------------------------------------------------------------------

export interface ReviewWeights {
  ownership: number;
  coChange: number;
  activity: number;
  busFactorBoost: number;
}

export interface ReviewThresholds {
  stalenessDaysPenalty: number;
  stalenessDaysFilter: number;
  activityRecentDays: number;
  activityMidDays: number;
  coChangeWindowDays: number;
}

export interface ReviewDefaults {
  max: number;
  minShare: number;
  maxPerPath: number;
}

export interface ReviewConfig {
  weights: ReviewWeights;
  thresholds: ReviewThresholds;
  defaults: ReviewDefaults;
  exclude: string[];
}

export const DEFAULT_REVIEW_CONFIG: ReviewConfig = {
  weights: {
    ownership: 0.50,
    coChange: 0.25,
    activity: 0.15,
    busFactorBoost: 0.10,
  },
  thresholds: {
    stalenessDaysPenalty: 180,
    stalenessDaysFilter: 180,
    activityRecentDays: 30,
    activityMidDays: 90,
    coChangeWindowDays: 90,
  },
  defaults: {
    max: 3,
    minShare: 0.30,
    maxPerPath: 2,
  },
  exclude: [],
};

// ---------------------------------------------------------------------------
// Scorer types
// ---------------------------------------------------------------------------

export interface CandidateActivity {
  email: string;
  lastCommitTimestamp: number; // unix seconds
}

export interface ScoreBreakdown {
  email: string;
  handle?: string;           // resolved GitHub handle (undefined until resolved)
  ownership: number;         // 0..1
  coChange: number;          // 0..1
  activity: number;          // 0..1
  busFactorBoost: number;    // 0..1
  stalenessMultiplier: number; // 0.3 or 1.0
  total: number;             // weighted sum × multiplier
}

export interface ReviewSuggestion {
  breakdown: ScoreBreakdown;
  reason: string;            // human-readable summary for CLI/comment output
}

export interface BusFactorWarning {
  pattern: string;           // e.g. "src/auth/**"
  busFactor: number;
  topOwnerStalenessDays: number;
}

export interface ReviewSuggestResult {
  suggestions: ReviewSuggestion[];
  warnings: BusFactorWarning[];
}

// ---------------------------------------------------------------------------
// Author resolution
// ---------------------------------------------------------------------------

export interface AuthorMapping {
  mappings: Record<string, string>;  // email → handle
  ignore: string[];
}
```

- [ ] **Step 2.2: Commit**

```bash
git add src/review/types.ts
git commit -m "feat(review): add shared types for reviewer scoring"
```

---

## Task 3: ReviewerScorer — Core Scoring Logic

**Files:**
- Create: `src/review/ReviewerScorer.ts`
- Create: `tests/ReviewerScorer.test.ts`

- [ ] **Step 3.1: Write failing tests**

Create `tests/ReviewerScorer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scoreReviewers } from '../src/review/ReviewerScorer.js';
import { OwnershipIndex } from '../src/git/OwnershipIndex.js';
import { CoChangeIndex } from '../src/git/CoChangeIndex.js';
import { DEFAULT_REVIEW_CONFIG } from '../src/review/types.js';
import type { CandidateActivity } from '../src/review/types.js';

const NOW = 1_800_000_000; // fixed unix seconds for deterministic tests

function makeOwnership() {
  const idx = new OwnershipIndex();
  // Alice: heavy owner of auth.ts (10 lines)
  idx.ingest({ sha: 'c1', author: 'Alice', authorEmail: 'alice@x.com',
    timestamp: NOW - 86400 * 10, message: '',
    files: [{ path: 'src/auth.ts', added: 10, deleted: 0 }],
    isBulk: false, isMerge: false });
  // Bob: minor owner (2 lines)
  idx.ingest({ sha: 'c2', author: 'Bob', authorEmail: 'bob@x.com',
    timestamp: NOW - 86400 * 5, message: '',
    files: [{ path: 'src/auth.ts', added: 2, deleted: 0 }],
    isBulk: false, isMerge: false });
  return idx;
}

function makeCoChange() {
  return new CoChangeIndex(); // empty — no co-change signal
}

function makeActivity(daysAgo: number): CandidateActivity[] {
  return [
    { email: 'alice@x.com', lastCommitTimestamp: NOW - 86400 * daysAgo },
    { email: 'bob@x.com',   lastCommitTimestamp: NOW - 86400 * daysAgo },
  ];
}

describe('scoreReviewers', () => {
  it('ranks alice above bob (higher ownership share)', () => {
    const result = scoreReviewers(
      ['src/auth.ts'],
      makeOwnership(),
      makeCoChange(),
      makeActivity(5),
      'author@x.com',
      DEFAULT_REVIEW_CONFIG,
      NOW,
    );
    expect(result.suggestions[0]!.breakdown.email).toBe('alice@x.com');
    expect(result.suggestions[1]!.breakdown.email).toBe('bob@x.com');
  });

  it('excludes the PR author', () => {
    const result = scoreReviewers(
      ['src/auth.ts'],
      makeOwnership(),
      makeCoChange(),
      makeActivity(5),
      'alice@x.com', // alice is the author
      DEFAULT_REVIEW_CONFIG,
      NOW,
    );
    expect(result.suggestions.every(s => s.breakdown.email !== 'alice@x.com')).toBe(true);
  });

  it('applies staleness filter for candidates older than threshold', () => {
    const staleActivity: CandidateActivity[] = [
      { email: 'alice@x.com', lastCommitTimestamp: NOW - 86400 * 200 }, // > 180d
      { email: 'bob@x.com',   lastCommitTimestamp: NOW - 86400 * 200 },
    ];
    const result = scoreReviewers(
      ['src/auth.ts'],
      makeOwnership(),
      makeCoChange(),
      staleActivity,
      'nobody@x.com',
      DEFAULT_REVIEW_CONFIG,
      NOW,
    );
    expect(result.suggestions).toHaveLength(0);
  });

  it('applies staleness penalty (not filter) for candidates between 90-180d', () => {
    const midActivity: CandidateActivity[] = [
      { email: 'alice@x.com', lastCommitTimestamp: NOW - 86400 * 120 },
      { email: 'bob@x.com',   lastCommitTimestamp: NOW - 86400 * 120 },
    ];
    const result = scoreReviewers(
      ['src/auth.ts'],
      makeOwnership(),
      makeCoChange(),
      midActivity,
      'nobody@x.com',
      DEFAULT_REVIEW_CONFIG,
      NOW,
    );
    // present but with penalty
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0]!.breakdown.stalenessMultiplier).toBe(0.3);
  });

  it('emits bus factor warning when busFactor ≤ 2', () => {
    const result = scoreReviewers(
      ['src/auth.ts'],
      makeOwnership(),
      makeCoChange(),
      makeActivity(5),
      'nobody@x.com',
      DEFAULT_REVIEW_CONFIG,
      NOW,
    );
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]!.busFactor).toBeLessThanOrEqual(2);
  });

  it('respects max from config', () => {
    const cfg = { ...DEFAULT_REVIEW_CONFIG, defaults: { ...DEFAULT_REVIEW_CONFIG.defaults, max: 1 } };
    const result = scoreReviewers(
      ['src/auth.ts'],
      makeOwnership(),
      makeCoChange(),
      makeActivity(5),
      'nobody@x.com',
      cfg,
      NOW,
    );
    expect(result.suggestions).toHaveLength(1);
  });
});
```

- [ ] **Step 3.2: Run tests to confirm they fail**

```bash
npx vitest run tests/ReviewerScorer.test.ts
```
Expected: `Cannot find module '../src/review/ReviewerScorer.js'`

- [ ] **Step 3.3: Implement `src/review/ReviewerScorer.ts`**

```ts
import type { OwnershipIndex } from '../git/OwnershipIndex.js';
import type { CoChangeIndex } from '../git/CoChangeIndex.js';
import type {
  ReviewConfig,
  CandidateActivity,
  ScoreBreakdown,
  ReviewSuggestion,
  BusFactorWarning,
  ReviewSuggestResult,
} from './types.js';

const SECS_PER_DAY = 86_400;

export function scoreReviewers(
  files: string[],
  ownership: OwnershipIndex,
  coChange: CoChangeIndex,
  activity: CandidateActivity[],
  prAuthorEmail: string,
  config: ReviewConfig,
  now: number = Math.floor(Date.now() / 1000),
): ReviewSuggestResult {
  const { weights, thresholds, defaults } = config;

  // Build activity lookup: email → last commit timestamp
  const activityMap = new Map<string, number>(
    activity.map(a => [a.email, a.lastCommitTimestamp]),
  );

  // Collect all candidate emails across the files (excluding PR author and excluded list)
  const candidateEmails = new Set<string>();
  for (const file of files) {
    const stats = ownership.statsFor(file, now);
    if (!stats) continue;
    for (const owner of stats.owners) {
      if (owner.email === prAuthorEmail) continue;
      if (config.exclude.some(ex => matchGlob(ex, owner.email))) continue;
      candidateEmails.add(owner.email);
    }
  }

  // Hard-filter: candidates with no activity in stalenessDaysFilter
  const activeEmails = new Set(
    Array.from(candidateEmails).filter(email => {
      const lastTs = activityMap.get(email);
      if (lastTs === undefined) return false;
      const daysAgo = (now - lastTs) / SECS_PER_DAY;
      return daysAgo <= thresholds.stalenessDaysFilter;
    }),
  );

  // Score each active candidate across all files, then take mean
  const breakdowns: ScoreBreakdown[] = [];
  for (const email of activeEmails) {
    const perFile = files.map(file => scoreCandidate(
      email, file, ownership, coChange, activityMap, config, now,
    ));
    // Mean across files
    const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const first = perFile[0]!;
    const merged: ScoreBreakdown = {
      email,
      ownership: mean(perFile.map(b => b.ownership)),
      coChange: mean(perFile.map(b => b.coChange)),
      activity: first.activity, // activity is per-person, not per-file
      busFactorBoost: mean(perFile.map(b => b.busFactorBoost)),
      stalenessMultiplier: first.stalenessMultiplier,
      total: 0,
    };
    merged.total =
      (weights.ownership * merged.ownership +
       weights.coChange * merged.coChange +
       weights.activity * merged.activity +
       weights.busFactorBoost * merged.busFactorBoost) *
      merged.stalenessMultiplier;
    breakdowns.push(merged);
  }

  // Sort descending; tie-break by stalenessMultiplier then activity
  breakdowns.sort((a, b) => {
    const diff = b.total - a.total;
    if (Math.abs(diff) >= 0.02) return diff;
    if (b.stalenessMultiplier !== a.stalenessMultiplier)
      return b.stalenessMultiplier - a.stalenessMultiplier;
    const lastA = activityMap.get(a.email) ?? 0;
    const lastB = activityMap.get(b.email) ?? 0;
    return lastB - lastA;
  });

  const suggestions: ReviewSuggestion[] = breakdowns
    .slice(0, defaults.max)
    .map(bd => ({ breakdown: bd, reason: buildReason(bd, files, ownership, now) }));

  // Bus-factor warnings
  const warnings: BusFactorWarning[] = collectWarnings(files, ownership, now, thresholds.activityMidDays);

  return { suggestions, warnings };
}

// ---------------------------------------------------------------------------
// Per-file per-candidate score (no I/O)
// ---------------------------------------------------------------------------

function scoreCandidate(
  email: string,
  file: string,
  ownership: OwnershipIndex,
  coChange: CoChangeIndex,
  activityMap: Map<string, number>,
  config: ReviewConfig,
  now: number,
): ScoreBreakdown {
  const { thresholds } = config;
  const stats = ownership.statsFor(file, now);
  const ownerEntry = stats?.owners.find(o => o.email === email);

  // Ownership score
  const ownershipScore = ownerEntry?.share ?? 0;

  // Co-change score: fraction of top co-changed files owned by this candidate
  const coChangePeers = coChange.topFor({
    node: file, limit: 10,
    minConfidence: 0.05,
    halfLifeDays: thresholds.coChangeWindowDays,
    now,
  });
  let coChangeScore = 0;
  if (coChangePeers.length > 0) {
    const hits = coChangePeers.filter(peer => {
      const peerFile = peer.nodeA === file ? peer.nodeB : peer.nodeA;
      const peerStats = ownership.statsFor(peerFile, now);
      return peerStats?.owners.some(o => o.email === email) ?? false;
    });
    coChangeScore = hits.length / coChangePeers.length;
  }

  // Activity score (per person)
  const lastTs = activityMap.get(email) ?? 0;
  const daysAgo = (now - lastTs) / 86_400;
  const activityScore =
    daysAgo <= thresholds.activityRecentDays ? 1.0 :
    daysAgo <= thresholds.activityMidDays ? 0.5 : 0;

  // Bus-factor boost: non-top-owner with ≥10% share on low-bus-factor file
  let busBoost = 0;
  if (stats && stats.busFactor <= 2 && ownerEntry && ownerEntry.share >= 0.10) {
    const isTopOwner = stats.owners[0]?.email === email;
    if (!isTopOwner) busBoost = 1;
  }

  // Staleness multiplier (applied to total, not per-factor)
  const stalenessMultiplier = daysAgo > thresholds.stalenessDaysPenalty ? 0.3 : 1.0;

  return {
    email,
    ownership: ownershipScore,
    coChange: coChangeScore,
    activity: activityScore,
    busFactorBoost: busBoost,
    stalenessMultiplier,
    total: 0, // set by caller after mean
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildReason(
  bd: ScoreBreakdown,
  files: string[],
  ownership: OwnershipIndex,
  now: number,
): string {
  const parts: string[] = [];
  if (bd.ownership > 0.3) {
    const pct = Math.round(bd.ownership * 100);
    const topFile = files.find(f => {
      const s = ownership.statsFor(f, now);
      return s?.owners.some(o => o.email === bd.email) ?? false;
    });
    parts.push(`owns ~${pct}% of ${topFile ?? 'changed files'}`);
  }
  if (bd.coChange > 0.3) parts.push('active in co-changed files');
  if (bd.busFactorBoost > 0) parts.push('bus-factor boost');
  if (bd.stalenessMultiplier < 1) parts.push('stale (>180d)');
  return parts.join('; ') || 'historical contributor';
}

function collectWarnings(
  files: string[],
  ownership: OwnershipIndex,
  now: number,
  midDays: number,
): BusFactorWarning[] {
  const warnings: BusFactorWarning[] = [];
  for (const file of files) {
    const stats = ownership.statsFor(file, now);
    if (!stats) continue;
    const topOwnerStalenessDays = stats.stalenessDays;
    if (stats.busFactor <= 2 || topOwnerStalenessDays > midDays) {
      warnings.push({
        pattern: file,
        busFactor: stats.busFactor,
        topOwnerStalenessDays,
      });
    }
  }
  // Deduplicate by pattern
  return warnings.filter((w, i, arr) => arr.findIndex(x => x.pattern === w.pattern) === i);
}

/** Very small glob: only supports leading/trailing * and *.domain patterns */
function matchGlob(pattern: string, value: string): boolean {
  if (pattern.startsWith('*@')) {
    const domain = pattern.slice(2);
    return value.endsWith(`@${domain}`);
  }
  return pattern === value;
}
```

- [ ] **Step 3.4: Run tests to confirm they pass**

```bash
npx vitest run tests/ReviewerScorer.test.ts
```
Expected: all 6 tests PASS

- [ ] **Step 3.5: Commit**

```bash
git add src/review/types.ts src/review/ReviewerScorer.ts tests/ReviewerScorer.test.ts
git commit -m "feat(review): implement ReviewerScorer with ownership/co-change/activity scoring"
```

---

## Task 4: AuthorResolver — Email → GitHub Handle

**Files:**
- Create: `src/review/AuthorResolver.ts`
- Create: `tests/AuthorResolver.test.ts`

- [ ] **Step 4.1: Write failing tests**

Create `tests/AuthorResolver.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthorResolver } from '../src/review/AuthorResolver.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

describe('AuthorResolver', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctxloom-test-'));
  });

  it('resolves from yml mapping first', async () => {
    const authorsYml = `mappings:\n  alice@x.com: alice-gh\nignore: []`;
    await fs.writeFile(path.join(tmpDir, 'authors.yml'), authorsYml);
    const resolver = new AuthorResolver(tmpDir);
    await resolver.load();
    expect(resolver.resolve('alice@x.com')).toBe('alice-gh');
  });

  it('returns undefined for unmapped email', async () => {
    const resolver = new AuthorResolver(tmpDir);
    await resolver.load();
    expect(resolver.resolve('unknown@x.com')).toBeUndefined();
  });

  it('returns undefined for ignored email', async () => {
    const authorsYml = `mappings: {}\nignore:\n  - bot@dependabot.com`;
    await fs.writeFile(path.join(tmpDir, 'authors.yml'), authorsYml);
    const resolver = new AuthorResolver(tmpDir);
    await resolver.load();
    expect(resolver.resolve('bot@dependabot.com')).toBe(null); // null = ignored
  });

  it('resolves from cache when yml has no mapping', async () => {
    const cache = { 'bob@x.com': 'bobsmith' };
    await fs.writeFile(
      path.join(tmpDir, 'authors-cache.json'),
      JSON.stringify(cache),
    );
    const resolver = new AuthorResolver(tmpDir);
    await resolver.load();
    expect(resolver.resolve('bob@x.com')).toBe('bobsmith');
  });

  it('yml mapping wins over cache', async () => {
    const authorsYml = `mappings:\n  bob@x.com: bob-override\nignore: []`;
    const cache = { 'bob@x.com': 'bob-cache' };
    await fs.writeFile(path.join(tmpDir, 'authors.yml'), authorsYml);
    await fs.writeFile(
      path.join(tmpDir, 'authors-cache.json'),
      JSON.stringify(cache),
    );
    const resolver = new AuthorResolver(tmpDir);
    await resolver.load();
    expect(resolver.resolve('bob@x.com')).toBe('bob-override');
  });
});
```

- [ ] **Step 4.2: Run tests to confirm they fail**

```bash
npx vitest run tests/AuthorResolver.test.ts
```
Expected: `Cannot find module '../src/review/AuthorResolver.js'`

- [ ] **Step 4.3: Add `js-yaml` dependency**

```bash
npm install js-yaml
npm install --save-dev @types/js-yaml
```

- [ ] **Step 4.4: Implement `src/review/AuthorResolver.ts`**

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import type { AuthorMapping } from './types.js';

interface Cache {
  [email: string]: string;
}

/**
 * Resolves git author emails to GitHub handles.
 * Resolution order: authors.yml > authors-cache.json > undefined
 *
 * null return means the email is on the ignore list.
 * undefined return means no mapping found (may attempt API lookup later).
 */
export class AuthorResolver {
  private mappings: Record<string, string> = {};
  private ignoreSet: Set<string> = new Set();
  private cache: Cache = {};

  constructor(private readonly ctxloomDir: string) {}

  async load(): Promise<void> {
    await Promise.all([this.loadYml(), this.loadCache()]);
  }

  /** Resolve email → handle. Returns null if ignored, undefined if unknown. */
  resolve(email: string): string | null | undefined {
    if (this.ignoreSet.has(email)) return null;
    const fromYml = this.mappings[email];
    if (fromYml !== undefined) return fromYml;
    const fromCache = this.cache[email];
    if (fromCache !== undefined) return fromCache;
    return undefined;
  }

  /** Write a new mapping to the cache file. */
  async writeCache(email: string, handle: string): Promise<void> {
    this.cache[email] = handle;
    await fs.writeFile(
      path.join(this.ctxloomDir, 'authors-cache.json'),
      JSON.stringify(this.cache, null, 2),
    );
  }

  /** Return all emails that have no mapping and are not ignored. */
  unmapped(emails: string[]): string[] {
    return emails.filter(e => this.resolve(e) === undefined);
  }

  // ---------------------------------------------------------------------------

  private async loadYml(): Promise<void> {
    const file = path.join(this.ctxloomDir, 'authors.yml');
    try {
      const raw = await fs.readFile(file, 'utf8');
      const parsed = yaml.load(raw) as AuthorMapping | null;
      if (!parsed) return;
      this.mappings = parsed.mappings ?? {};
      this.ignoreSet = new Set(parsed.ignore ?? []);
    } catch {
      // file absent — ok
    }
  }

  private async loadCache(): Promise<void> {
    const file = path.join(this.ctxloomDir, 'authors-cache.json');
    try {
      const raw = await fs.readFile(file, 'utf8');
      this.cache = JSON.parse(raw) as Cache;
    } catch {
      // file absent — ok
    }
  }
}

/**
 * Attempt to resolve a git email to a GitHub handle via the GitHub API.
 * Uses the commits API to find the first commit by that email and reads the
 * login from the response. Returns undefined on failure.
 */
export async function resolveViaGitHubApi(
  email: string,
  owner: string,
  repo: string,
  token: string,
): Promise<string | undefined> {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/commits?author=${encodeURIComponent(email)}&per_page=1`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) return undefined;
    const data = await res.json() as Array<{ author?: { login?: string } }>;
    return data[0]?.author?.login ?? undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4.5: Run tests to confirm they pass**

```bash
npx vitest run tests/AuthorResolver.test.ts
```
Expected: all 5 tests PASS

- [ ] **Step 4.6: Commit**

```bash
git add src/review/AuthorResolver.ts tests/AuthorResolver.test.ts package.json package-lock.json
git commit -m "feat(review): implement AuthorResolver with yml + cache resolution"
```

---

## Task 5: CodeownersWriter

**Files:**
- Create: `src/review/CodeownersWriter.ts`
- Create: `tests/CodeownersWriter.test.ts`

- [ ] **Step 5.1: Write failing tests**

Create `tests/CodeownersWriter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildCodeownersBlock, mergeIntoFile, parseExistingFile } from '../src/review/CodeownersWriter.js';

const START = '# <ctxloom:start>';
const END = '# <ctxloom:end>';

describe('buildCodeownersBlock', () => {
  it('emits rules with handles', () => {
    const rules = [
      { pattern: 'src/auth/**', handles: ['alice', 'bob'] },
      { pattern: 'src/payments/**', handles: ['carol'] },
    ];
    const block = buildCodeownersBlock(rules);
    expect(block).toContain('src/auth/**');
    expect(block).toContain('@alice @bob');
    expect(block).toContain('src/payments/**');
    expect(block).toContain('@carol');
    expect(block).toContain(START);
    expect(block).toContain(END);
  });
});

describe('mergeIntoFile', () => {
  it('inserts markers when file has no existing markers', () => {
    const existing = '# hand-written\n/docs/** @docs-team\n';
    const block = `${START}\nsrc/auth/** @alice\n${END}`;
    const result = mergeIntoFile(existing, block);
    expect(result).toContain('# hand-written');
    expect(result).toContain('/docs/** @docs-team');
    expect(result).toContain('src/auth/** @alice');
    expect(result.indexOf('# hand-written')).toBeLessThan(result.indexOf(START));
  });

  it('replaces content between existing markers', () => {
    const existing = `# hand-written\n${START}\nold/rule/** @old\n${END}\n# footer\n`;
    const block = `${START}\nnew/rule/** @new\n${END}`;
    const result = mergeIntoFile(existing, block);
    expect(result).not.toContain('@old');
    expect(result).toContain('@new');
    expect(result).toContain('# hand-written');
    expect(result).toContain('# footer');
  });

  it('preserves content outside markers exactly', () => {
    const existing = `before\n${START}\nold\n${END}\nafter\n`;
    const block = `${START}\nnew\n${END}`;
    const result = mergeIntoFile(existing, block);
    expect(result.startsWith('before\n')).toBe(true);
    expect(result.endsWith('after\n')).toBe(true);
  });
});

describe('parseExistingFile', () => {
  it('returns empty string when file is empty', () => {
    expect(parseExistingFile('')).toBe('');
  });
});
```

- [ ] **Step 5.2: Run tests to confirm they fail**

```bash
npx vitest run tests/CodeownersWriter.test.ts
```
Expected: `Cannot find module '../src/review/CodeownersWriter.js'`

- [ ] **Step 5.3: Implement `src/review/CodeownersWriter.ts`**

```ts
import fs from 'node:fs/promises';
import path from 'node:path';

const MARKER_START = '# <ctxloom:start> — managed by ctxloom review-suggest; do not edit between markers';
const MARKER_END = '# <ctxloom:end>';
const MARKER_START_DETECT = '# <ctxloom:start>';

export interface CodeownersRule {
  pattern: string;
  handles: string[];
}

/** Build the managed block (including markers). */
export function buildCodeownersBlock(rules: CodeownersRule[]): string {
  const lines = [MARKER_START];
  for (const rule of rules) {
    const owners = rule.handles.map(h => `@${h}`).join(' ');
    lines.push(`${rule.pattern.padEnd(40)} ${owners}`);
  }
  lines.push(MARKER_END);
  return lines.join('\n');
}

/** Merge a new managed block into existing file content. */
export function mergeIntoFile(existing: string, block: string): string {
  const startIdx = existing.indexOf(MARKER_START_DETECT);
  const endIdx = existing.indexOf(MARKER_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace between markers
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + MARKER_END.length);
    return before + block + after;
  }

  // No markers — append at end
  const base = existing.endsWith('\n') ? existing : existing + '\n';
  return base + '\n' + block + '\n';
}

/** No-op passthrough; included for symmetry and future pre-processing. */
export function parseExistingFile(content: string): string {
  return content;
}

/**
 * Read existing CODEOWNERS (or empty string), merge new block in, return result.
 * Does NOT write to disk — call writeCODEOWNERS() for that.
 */
export async function generateCODEOWNERS(
  codeownersPath: string,
  rules: CodeownersRule[],
): Promise<string> {
  let existing = '';
  try {
    existing = await fs.readFile(codeownersPath, 'utf8');
  } catch {
    // file absent — start fresh
  }
  const block = buildCodeownersBlock(rules);
  return mergeIntoFile(existing, block);
}

/** Write the generated CODEOWNERS content to disk. */
export async function writeCODEOWNERS(
  codeownersPath: string,
  content: string,
): Promise<void> {
  await fs.mkdir(path.dirname(codeownersPath), { recursive: true });
  await fs.writeFile(codeownersPath, content, 'utf8');
}
```

- [ ] **Step 5.4: Run tests to confirm they pass**

```bash
npx vitest run tests/CodeownersWriter.test.ts
```
Expected: all 4 tests PASS

- [ ] **Step 5.5: Commit**

```bash
git add src/review/CodeownersWriter.ts tests/CodeownersWriter.test.ts
git commit -m "feat(review): implement CodeownersWriter with marker-based CODEOWNERS management"
```

---

## Task 6: Public API re-export

**Files:**
- Create: `src/review/index.ts`

- [ ] **Step 6.1: Create `src/review/index.ts`**

```ts
export { scoreReviewers } from './ReviewerScorer.js';
export { AuthorResolver, resolveViaGitHubApi } from './AuthorResolver.js';
export { buildCodeownersBlock, mergeIntoFile, generateCODEOWNERS, writeCODEOWNERS } from './CodeownersWriter.js';
export type {
  ReviewConfig,
  ReviewSuggestResult,
  ReviewSuggestion,
  ScoreBreakdown,
  BusFactorWarning,
  CandidateActivity,
  CodeownersRule,
} from './types.js';
export { DEFAULT_REVIEW_CONFIG } from './types.js';
```

- [ ] **Step 6.2: Commit**

```bash
git add src/review/index.ts
git commit -m "feat(review): add public API re-export for review module"
```

---

## Task 7: Config Loader

**Files:**
- Create: `src/review/loadConfig.ts`

- [ ] **Step 7.1: Implement `src/review/loadConfig.ts`**

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { DEFAULT_REVIEW_CONFIG, type ReviewConfig } from './types.js';

/**
 * Load review config from .ctxloom/review.yml, deep-merged over defaults.
 * Missing or invalid file silently returns defaults.
 */
export async function loadReviewConfig(root: string): Promise<ReviewConfig> {
  const file = path.join(root, '.ctxloom', 'review.yml');
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = yaml.load(raw) as Partial<ReviewConfig> | null;
    if (!parsed) return DEFAULT_REVIEW_CONFIG;
    return {
      weights: { ...DEFAULT_REVIEW_CONFIG.weights, ...(parsed.weights ?? {}) },
      thresholds: { ...DEFAULT_REVIEW_CONFIG.thresholds, ...(parsed.thresholds ?? {}) },
      defaults: { ...DEFAULT_REVIEW_CONFIG.defaults, ...(parsed.defaults ?? {}) },
      exclude: parsed.exclude ?? DEFAULT_REVIEW_CONFIG.exclude,
    };
  } catch {
    return DEFAULT_REVIEW_CONFIG;
  }
}
```

- [ ] **Step 7.2: Commit**

```bash
git add src/review/loadConfig.ts
git commit -m "feat(review): add review.yml config loader with deep-merge defaults"
```

---

## Task 8: CLI Commands — `review-suggest` and `authors-sync`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 8.1: Read the current CLI switch block**

Open `src/index.ts` and find the `switch (command)` block — specifically the `case 'dashboard':` and `case '--help':` blocks. We'll add new cases before `case '--help':`.

- [ ] **Step 8.2: Add imports at the top of `src/index.ts`**

After the existing imports, add:

```ts
import { GitOverlayStore } from './git/GitOverlayStore.js';
import { scoreReviewers } from './review/ReviewerScorer.js';
import { AuthorResolver, resolveViaGitHubApi } from './review/AuthorResolver.js';
import { generateCODEOWNERS, writeCODEOWNERS } from './review/CodeownersWriter.js';
import { loadReviewConfig } from './review/loadConfig.js';
import type { CandidateActivity, CodeownersRule } from './review/types.js';
import { execSync } from 'node:child_process';
```

- [ ] **Step 8.3: Add `review-suggest` and `authors-sync` cases to the switch**

Find the line `case '--help':` in the switch block and insert before it:

```ts
    case 'review-suggest': {
      const root = process.cwd();
      const ctxloomDir = path.join(root, '.ctxloom');
      const max = parseInt(getFlagValue('--max=') ?? '3', 10);
      const emitCodeowners = hasFlag('--emit-codeowners');
      const writeFlag = hasFlag('--write');
      const explainFlag = hasFlag('--explain');
      const minShare = parseFloat(getFlagValue('--min-share=') ?? '0.3');
      const excludeFlags = args.filter(a => a.startsWith('--exclude=')).map(a => a.slice('--exclude='.length));
      const authorFlag = getFlagValue('--author=');
      const jsonFlag = hasFlag('--json');

      // Load overlay
      const store = new GitOverlayStore(ctxloomDir);
      await store.load();

      // Determine files to score
      const positionalFiles = args.filter(a => !a.startsWith('-'));
      let files: string[] = positionalFiles.length > 0
        ? positionalFiles
        : getStagedFiles(root);

      if (files.length === 0) {
        console.error('[ctxloom] No files specified and no staged changes found.');
        process.exit(1);
      }

      const config = await loadReviewConfig(root);
      if (excludeFlags.length > 0) config.exclude.push(...excludeFlags);
      config.defaults.max = max;

      // Determine PR author email
      const prAuthorEmail = authorFlag ?? getGitUserEmail(root) ?? '';

      // Build activity list from ownership index
      const activity = buildActivityFromOwnership(store);

      const resolver = new AuthorResolver(ctxloomDir);
      await resolver.load();

      if (emitCodeowners) {
        // CODEOWNERS mode
        const allFiles = store.ownership.allNodes();
        const ruleMap = new Map<string, Set<string>>();
        for (const file of allFiles) {
          const dir = path.dirname(file);
          const stats = store.ownership.statsFor(file);
          if (!stats) continue;
          const topOwners = stats.owners.filter(o => o.share >= minShare).slice(0, 2);
          for (const owner of topOwners) {
            const handle = resolver.resolve(owner.email);
            if (!handle) continue;
            const pattern = `${dir}/**`;
            const set = ruleMap.get(pattern) ?? new Set();
            set.add(handle);
            ruleMap.set(pattern, set);
          }
        }
        const rules: CodeownersRule[] = Array.from(ruleMap.entries())
          .map(([pattern, handles]) => ({ pattern, handles: Array.from(handles) }))
          .sort((a, b) => a.pattern.localeCompare(b.pattern));
        const codeownersPath = path.join(root, '.github', 'CODEOWNERS');
        const content = await generateCODEOWNERS(codeownersPath, rules);
        if (writeFlag) {
          await writeCODEOWNERS(codeownersPath, content);
          console.log(`[ctxloom] Updated ${codeownersPath} (${rules.length} rules).`);
        } else {
          console.log('--- dry run (pass --write to save) ---\n');
          console.log(content);
        }
        break;
      }

      const result = scoreReviewers(
        files,
        store.ownership,
        store.coChange,
        activity,
        prAuthorEmail,
        config,
      );

      if (jsonFlag) {
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      if (result.suggestions.length === 0) {
        console.log('[ctxloom] No suggestions — all candidates filtered by staleness/exclusion rules.');
        break;
      }

      console.log(`\nSuggested reviewers for ${files.length} file(s):`);
      for (let i = 0; i < result.suggestions.length; i++) {
        const s = result.suggestions[i]!;
        const handle = resolver.resolve(s.breakdown.email) ?? s.breakdown.email;
        const displayName = typeof handle === 'string' && handle !== s.breakdown.email
          ? `@${handle}`
          : s.breakdown.email;
        const score = s.breakdown.total.toFixed(2);
        console.log(`  ${i + 1}. ${displayName.padEnd(20)} ${score}   ${s.reason}`);
        if (explainFlag) {
          const b = s.breakdown;
          console.log(`     ownership=${b.ownership.toFixed(2)}  coChange=${b.coChange.toFixed(2)}  activity=${b.activity.toFixed(2)}  busBoost=${b.busFactorBoost.toFixed(2)}  stale=×${b.stalenessMultiplier}`);
        }
      }

      if (result.warnings.length > 0) {
        console.log('');
        for (const w of result.warnings) {
          if (w.busFactor <= 2) {
            console.log(`  ⚠  Bus factor is ${w.busFactor} for ${w.pattern}. Consider pairing a second reviewer.`);
          }
          if (w.topOwnerStalenessDays > 90) {
            console.log(`  ⚠  Top owner last touched ${w.pattern} ${w.topOwnerStalenessDays}d ago. Ownership may be stale.`);
          }
        }
      }
      console.log('');
      break;
    }

    case 'authors-sync': {
      const root = process.cwd();
      const ctxloomDir = path.join(root, '.ctxloom');
      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        console.error('[ctxloom] GITHUB_TOKEN env var required for authors-sync.');
        process.exit(1);
      }
      const repoSlug = getFlagValue('--repo=') ?? getGitHubRepoSlug(root);
      if (!repoSlug) {
        console.error('[ctxloom] Could not detect GitHub repo. Pass --repo=owner/name.');
        process.exit(1);
      }
      const [owner, repo] = repoSlug.split('/') as [string, string];
      const store = new GitOverlayStore(ctxloomDir);
      await store.load();
      const resolver = new AuthorResolver(ctxloomDir);
      await resolver.load();
      const allEmails = Array.from(new Set(
        store.ownership.allNodes().flatMap(f => {
          const s = store.ownership.statsFor(f);
          return s?.owners.map(o => o.email) ?? [];
        }),
      ));
      const unmapped = resolver.unmapped(allEmails);
      if (unmapped.length === 0) {
        console.log('[ctxloom] All authors already mapped.');
        break;
      }
      console.log(`[ctxloom] Resolving ${unmapped.length} unmapped author(s)...`);
      let resolved = 0;
      for (const email of unmapped) {
        const handle = await resolveViaGitHubApi(email, owner, repo, token);
        if (handle) {
          await resolver.writeCache(email, handle);
          resolved++;
          console.log(`  ${email} → @${handle}`);
        }
      }
      console.log(`[ctxloom] Done. Resolved ${resolved}/${unmapped.length}.`);
      break;
    }
```

- [ ] **Step 8.4: Add helper functions at the bottom of `src/index.ts` before the `main()` call**

```ts
function getStagedFiles(root: string): string[] {
  try {
    const out = execSync('git diff --cached --name-only --diff-filter=ACM', {
      cwd: root, encoding: 'utf8',
    });
    return out.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function getGitUserEmail(root: string): string | undefined {
  try {
    return execSync('git config user.email', { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

function getGitHubRepoSlug(root: string): string | undefined {
  try {
    const remote = execSync('git remote get-url origin', { cwd: root, encoding: 'utf8' }).trim();
    const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function buildActivityFromOwnership(store: GitOverlayStore): CandidateActivity[] {
  const lastTouchMap = new Map<string, number>();
  for (const file of store.ownership.allNodes()) {
    const raw = store.ownership.statsFor(file);
    if (!raw) continue;
    // statsFor returns stalenessDays-based info but not raw timestamp per owner
    // Use churn index lastTouch as proxy for file-level activity
    const churn = store.churn.statsFor(file);
    if (!churn) continue;
    for (const owner of raw.owners) {
      const existing = lastTouchMap.get(owner.email) ?? 0;
      if (churn.lastTouch > existing) lastTouchMap.set(owner.email, churn.lastTouch);
    }
  }
  return Array.from(lastTouchMap.entries()).map(([email, lastCommitTimestamp]) => ({
    email, lastCommitTimestamp,
  }));
}
```

- [ ] **Step 8.5: Update `--help` output to include new commands**

Find the help case output text in `src/index.ts` and add after the dashboard line:

```
  ctxloom review-suggest [files]   Suggest reviewers from ownership index
  ctxloom authors-sync             Map git emails to GitHub handles (needs GITHUB_TOKEN)
```

- [ ] **Step 8.6: Build and smoke-test**

```bash
npm run build
node dist/index.js review-suggest --help 2>&1 | head -5
```
Expected: help text appears without error.

- [ ] **Step 8.7: Commit**

```bash
git add src/index.ts src/review/loadConfig.ts
git commit -m "feat(review): add review-suggest and authors-sync CLI commands"
```

---

## Task 9: GitHub Action

**Files:**
- Create: `actions/review-suggest/action.yml`
- Create: `actions/review-suggest/entrypoint.ts`

- [ ] **Step 9.1: Create `actions/review-suggest/action.yml`**

```yaml
name: ctxloom Review Suggestions
description: Suggest PR reviewers based on ownership and co-change history
author: ctxloom

inputs:
  max:
    description: Maximum number of reviewers to suggest
    required: false
    default: '3'
  mode:
    description: Action mode — only 'comment' is supported in v1
    required: false
    default: comment
  config-path:
    description: Path to review config (default .ctxloom/review.yml)
    required: false
    default: .ctxloom/review.yml

runs:
  using: node20
  main: dist/index.js
```

- [ ] **Step 9.2: Create `actions/review-suggest/entrypoint.ts`**

```ts
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { GitOverlayStore } from '../../src/git/GitOverlayStore.js';
import { scoreReviewers } from '../../src/review/ReviewerScorer.js';
import { AuthorResolver } from '../../src/review/AuthorResolver.js';
import { loadReviewConfig } from '../../src/review/loadConfig.js';
import type { CandidateActivity } from '../../src/review/types.js';

const MARKER = '<!-- ctxloom:review-suggest -->';

async function run() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY ?? '';
  const prNumber = process.env.PR_NUMBER;
  const sha = process.env.GITHUB_SHA ?? '';
  const root = process.cwd();
  const ctxloomDir = path.join(root, '.ctxloom');
  const max = parseInt(process.env.INPUT_MAX ?? '3', 10);

  if (!token || !prNumber) {
    console.log('[ctxloom-action] Missing GITHUB_TOKEN or PR_NUMBER — skipping.');
    return;
  }

  const [owner, repoName] = repo.split('/') as [string, string];

  // Get changed files from GitHub API
  const filesRes = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/pulls/${prNumber}/files?per_page=100`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } },
  );
  const filesData = await filesRes.json() as Array<{ filename: string }>;
  const changedFiles = filesData.map(f => f.filename);

  if (changedFiles.length === 0) {
    console.log('[ctxloom-action] No changed files.');
    return;
  }

  // Get PR author
  const prRes = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/pulls/${prNumber}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } },
  );
  const prData = await prRes.json() as { user: { email?: string; login: string } };
  const prAuthorEmail = prData.user.email ?? '';

  // Load indexes
  const store = new GitOverlayStore(ctxloomDir);
  try { await store.load(); } catch {
    console.log('[ctxloom-action] No git overlay found — running index...');
    execSync('npx ctxloom index', { cwd: root, stdio: 'inherit' });
    await store.load();
  }

  const config = await loadReviewConfig(root);
  config.defaults.max = max;

  const activity = buildActivity(store);
  const resolver = new AuthorResolver(ctxloomDir);
  await resolver.load();

  const result = scoreReviewers(
    changedFiles,
    store.ownership,
    store.coChange,
    activity,
    prAuthorEmail,
    config,
  );

  // Build comment body
  const rows = result.suggestions.map((s, i) => {
    const handle = resolver.resolve(s.breakdown.email);
    const displayName = handle ? `@${handle}` : s.breakdown.email;
    return `| ${i + 1} | ${displayName} | ${s.breakdown.total.toFixed(2)} | ${s.reason} |`;
  }).join('\n');

  const warningLines = result.warnings.map(w => {
    if (w.busFactor <= 2) return `> ⚠ Bus factor is ${w.busFactor} for \`${w.pattern}\`. Consider pairing a second reviewer.`;
    return `> ⚠ Top owner last touched \`${w.pattern}\` ${w.topOwnerStalenessDays}d ago. Ownership may be stale.`;
  }).join('\n');

  const body = [
    MARKER,
    '### 🧵 Suggested reviewers',
    '',
    '| # | Reviewer | Score | Why |',
    '|---|----------|-------|-----|',
    rows || '| — | No suggestions | — | All candidates filtered |',
    '',
    warningLines,
    '',
    `_Based on git history as of \`${sha.slice(0, 7)}\`. Powered by [ctxloom](https://ctxloom.com)._`,
  ].filter(l => l !== undefined).join('\n');

  // Find or post sticky comment
  const commentsRes = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/issues/${prNumber}/comments?per_page=100`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } },
  );
  const comments = await commentsRes.json() as Array<{ id: number; body: string }>;
  const existing = comments.find(c => c.body.includes(MARKER));

  if (existing) {
    await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/issues/comments/${existing.id}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      },
    );
    console.log('[ctxloom-action] Updated existing suggestion comment.');
  } else {
    await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/issues/${prNumber}/comments`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      },
    );
    console.log('[ctxloom-action] Posted new suggestion comment.');
  }
}

function buildActivity(store: GitOverlayStore): CandidateActivity[] {
  const lastTouchMap = new Map<string, number>();
  for (const file of store.ownership.allNodes()) {
    const raw = store.ownership.statsFor(file);
    const churn = store.churn.statsFor(file);
    if (!raw || !churn) continue;
    for (const owner of raw.owners) {
      const existing = lastTouchMap.get(owner.email) ?? 0;
      if (churn.lastTouch > existing) lastTouchMap.set(owner.email, churn.lastTouch);
    }
  }
  return Array.from(lastTouchMap.entries()).map(([email, lastCommitTimestamp]) => ({
    email, lastCommitTimestamp,
  }));
}

run().catch(err => {
  console.error('[ctxloom-action] Error:', err);
  process.exit(1);
});
```

- [ ] **Step 9.3: Commit**

```bash
git add actions/review-suggest/
git commit -m "feat(review): add GitHub Action for PR reviewer suggestions"
```

---

## Task 10: Full Test Run and Final Lint

- [ ] **Step 10.1: Run full test suite**

```bash
npm test
```
Expected: all tests PASS (including OwnershipIndex, ReviewerScorer, AuthorResolver, CodeownersWriter, and all pre-existing tests)

- [ ] **Step 10.2: TypeScript lint check**

```bash
npm run lint
```
Expected: no errors

- [ ] **Step 10.3: Fix any lint errors**

If `npm run lint` reports errors, fix them before committing. Common issues:
- Missing type imports (add `import type`)
- Unused variables (remove or prefix with `_`)
- `any` types (replace with proper types)

- [ ] **Step 10.4: Commit fixes if any**

```bash
git add -p
git commit -m "fix(review): resolve TypeScript lint errors"
```

---

## Task 11: README Update

**Files:**
- Modify: `README.md`

- [ ] **Step 11.1: Add `## Reviewer Suggestions` section to README.md**

Find the `## Web Dashboard` section in README.md and add a new section after it:

```markdown
## Reviewer Suggestions

Suggest PR reviewers based on git ownership, co-change history, and recent activity:

```bash
# Suggest reviewers for staged files
ctxloom review-suggest

# Suggest reviewers for specific files
ctxloom review-suggest src/auth.ts src/api/session.ts

# Show per-factor score breakdown
ctxloom review-suggest src/auth.ts --explain

# Generate / update .github/CODEOWNERS
ctxloom review-suggest --emit-codeowners --write

# Map git author emails to GitHub handles
GITHUB_TOKEN=<token> ctxloom authors-sync
```

### Scoring

Each candidate is scored across four factors:

| Factor | Weight | Source |
|--------|--------|--------|
| Ownership share | 50% | Blame-weighted commit history |
| Co-change recency | 25% | Files changed together in last 90 days |
| Recent activity | 15% | Commits in last 30/90 days |
| Bus-factor boost | 10% | Diversity nudge when bus factor ≤ 2 |

Candidates inactive for > 180 days are excluded automatically.

### GitHub Action

Add to `.github/workflows/review.yml`:

```yaml
name: Reviewer suggestions
on:
  pull_request:
    types: [opened, synchronize, reopened]
jobs:
  suggest:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: kodiii/ctxloom-review-suggest@v1
        with:
          max: 3
```

### Email → GitHub Handle Mapping

Create `.ctxloom/authors.yml` to override auto-resolved handles:

```yaml
mappings:
  alice@company.com: alice-gh
  bob@company.com: bobsmith
ignore:
  - bot@dependabot.com
```
```

- [ ] **Step 11.2: Commit README update**

```bash
git add README.md
git commit -m "docs: add Reviewer Suggestions section to README"
```

---

## Done

All tasks complete. Run `npm test && npm run lint` one final time to confirm everything is green before raising a PR.
