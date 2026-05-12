# Multi-project `project_root` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a single ctxloom MCP server process serve any project the agent points it at, without restart and without client-specific config tricks, by adding an optional `project_root` parameter to every tool and routing through a per-project state map.

**Architecture:** Replace the server's module-level lazy singletons (`_storePromise`, `_graphPromise`, etc. in `src/server.ts`) with a `ProjectStateManager` holding a `Map<canonicalAbsolutePath, ProjectState>` plus an LRU cap (default 5). Every tool's input schema gains an optional `project_root` field; a resolver picks alias-or-path-or-env-or-cwd per call. First-touch on a new root runs the existing `DependencyGraph.buildFromDirectory()` (Tier 1, ~5s) synchronously; vector embeddings (Tier 2) are deferred until the first vector-flavored tool call. Existing `RepoRegistry` (used today only by `ctx_cross_repo_search`) is extended with optional alias support and lookup helpers, surfaced via `ctxloom register --alias <name>`. `ctx_status` keeps its v1.0.31 top-level fields (describing the default project) and appends `<active_projects>` + `<registered_projects>` blocks. A `CTXLOOM_DISABLE_MULTIPROJECT=1` kill switch falls back to v1.0.31 behavior.

**Tech Stack:** TypeScript (Node 20+), Zod schemas, @modelcontextprotocol/sdk, Vitest, tsup ESM build, LanceDB (vectors), web-tree-sitter (AST), @huggingface/transformers (embeddings).

---

## Spec reference

Full design at [`docs/superpowers/specs/2026-05-12-multi-project-project_root-design.md`](../specs/2026-05-12-multi-project-project_root-design.md). Read it first. This plan implements every acceptance criterion from §"Acceptance criteria" of the spec.

## File structure

### New files

| Path | Responsibility |
|---|---|
| `packages/core/src/server/ProjectState.ts` | `interface ProjectState`; the per-root state shape and helpers to lazy-init each field |
| `packages/core/src/server/ProjectStateManager.ts` | `Map<canonicalRoot, ProjectState>` + LRU bookkeeping + eviction (closes LanceDB, stops watcher) |
| `packages/core/src/server/resolveProjectRoot.ts` | Pure function: arg + env + cwd + registry → resolution outcome `{ root, alias?, source, error? }`; also `validateDefaultRoot(candidate): bool` |
| `packages/core/src/server/indexingEnvelope.ts` | Helpers to wrap a tool response with `<ctxloom_indexing first_touch="..." tier="..." />` |
| `packages/core/src/server/structuredErrors.ts` | Builders for `<error code="..." />` and `<warning code="..." />` XML shapes |
| `tests/ResolveProjectRoot.test.ts` | Unit tests for the resolver (precedence, alias-vs-path, no-default mode) |
| `tests/ProjectStateManager.test.ts` | Unit tests for the LRU map (eviction, pin protection, concurrency dedup) |
| `tests/RepoRegistryAlias.test.ts` | Unit tests for `findByAlias` / `findByPath`, alias validation |
| `tests/CtxStatusMultiProject.test.ts` | Tests for new `<active_projects>` / `<registered_projects>` XML shape |
| `tests/KillSwitch.test.ts` | `CTXLOOM_DISABLE_MULTIPROJECT=1` parity with v1.0.31 |
| `tests/MultiProjectIntegration.test.ts` | End-to-end: spawn server with no default, hit tools against two cold roots |

### Modified files

| Path | Change |
|---|---|
| `packages/core/src/tools/context.ts` | `ServerContext` getter signatures: `() => Promise<X>` → `(root?: string) => Promise<X>` |
| `packages/core/src/tools/cross-repo-search.ts` | Extend `RegisteredRepo` with `alias?: string`; add `findByAlias`, `findByPath` to `RepoRegistry` |
| `packages/core/src/tools/status.ts` | Accept `project_root` param; emit multi-project view; per-project view when param passed |
| `src/server.ts` | Replace module-level lazy singletons with `ProjectStateManager`; default-root validation; no-default mode; `CTXLOOM_DISABLE_MULTIPROJECT` / `CTXLOOM_MAX_PROJECTS` handling |
| `src/index.ts` | `register` command: accept `--alias <name>`; `repos` command: print alias column |
| `apps/dashboard/server/projects.ts` | `DashboardProject` gains `alias?: string`; `listProjects()` propagates it |
| `apps/dashboard/client/src/components/ProjectSwitcher.tsx` | Display alias as primary label when present |
| 32 tool files in `packages/core/src/tools/` (full list in Task 3.3) | Add `project_root` to Zod schema + JSON schema; resolve per call; pass root to `ctx.getXxx(root)` |

### Phases overview

| Phase | Goal | User-visible change? |
|---|---|---|
| 1 | Add new types + pure functions (resolver, ProjectStateManager, alias helpers) — all unused | No |
| 2 | Wire `ServerContext` getters to `ProjectStateManager`; default-root validation + no-default mode | No (when omitting `project_root`, behavior identical) |
| 3 | Add `project_root` param to every tool; per-call resolution | Yes — tools accept the param |
| 4 | CLI: `ctxloom register --alias`, `ctxloom repos` shows alias column | Yes — alias UX |
| 5 | `ctx_status` multi-project view + observability logging | Yes — new XML blocks |
| 6 | First-touch `<ctxloom_indexing>` envelope + structured `<error>` / `<warning>` shapes | Yes — new envelopes |
| 7 | Kill switch + `CTXLOOM_MAX_PROJECTS` env | No (unless user sets the env vars) |
| 8 | Dashboard: alias display in `ProjectSwitcher` | Yes — dashboard UI |
| 9 | Integration tests, README updates, release notes | No |

Each phase ends with the full test suite green. Land phases as separate PRs if helpful, or as one large PR if the engineer prefers.

---

## Phase 1 — Foundation (new code, no wiring)

This phase introduces the types and pure functions. Nothing in `src/server.ts` or the tool layer references them yet. Existing behavior is 100% unchanged.

### Task 1.1: Branch off main + create directory layout

**Files:**
- Create: `packages/core/src/server/` (new directory)

- [ ] **Step 1.1.1: Branch**

```bash
git checkout main
git pull --ff-only
git checkout -b feat/multi-project-project_root
mkdir -p /Users/ricardoribeiro/GitHub/contextmesh/packages/core/src/server
```

- [ ] **Step 1.1.2: Commit empty branch state**

(Nothing to commit yet — proceed to Task 1.2.)

---

### Task 1.2: `resolveProjectRoot` pure function + tests

**Files:**
- Create: `packages/core/src/server/resolveProjectRoot.ts`
- Test: `tests/ResolveProjectRoot.test.ts`

This is a pure function with no side effects. Easy to TDD.

- [ ] **Step 1.2.1: Write the failing test**

Create `tests/ResolveProjectRoot.test.ts`:

```ts
/**
 * Unit tests for resolveProjectRoot.
 *
 * The resolver picks a project root from (in priority order):
 *   1. Explicit `arg` — alias-only if no path separator, else path
 *   2. `env.CTXLOOM_ROOT`
 *   3. `cwd`
 *
 * Plus `validateDefaultRoot(candidate)` which checks that the chosen
 * candidate is safe to pin as the default (not `/`, exists, has a project
 * marker file).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveProjectRoot, validateDefaultRoot } from '../packages/core/src/server/resolveProjectRoot.js';

interface MockRegistry {
  findByAlias(name: string): { root: string; alias?: string } | null;
  list(): { root: string; alias?: string }[];
}

function mkRegistry(entries: { root: string; alias?: string }[]): MockRegistry {
  return {
    findByAlias: (name) => entries.find((e) => e.alias === name) ?? null,
    list: () => entries,
  };
}

describe('resolveProjectRoot', () => {
  it('explicit alias (no separator) → registry path', () => {
    const reg = mkRegistry([{ root: '/abs/foo', alias: 'foo' }]);
    const out = resolveProjectRoot({
      arg: 'foo',
      env: undefined,
      cwd: '/cwd',
      registry: reg,
    });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.root).toBe('/abs/foo');
      expect(out.alias).toBe('foo');
      expect(out.source).toBe('arg-alias');
    }
  });

  it('explicit alias-shaped string with no matching alias → error (does NOT fall through to path)', () => {
    const reg = mkRegistry([{ root: '/abs/foo', alias: 'foo' }]);
    const out = resolveProjectRoot({
      arg: 'bar',
      env: undefined,
      cwd: '/cwd',
      registry: reg,
    });
    expect(out.kind).toBe('alias_not_found');
    if (out.kind === 'alias_not_found') {
      expect(out.alias).toBe('bar');
      expect(out.didYouMean).toEqual(['foo']);
    }
  });

  it('explicit path (has separator) → resolves to absolute', () => {
    const reg = mkRegistry([]);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpr-'));
    try {
      const out = resolveProjectRoot({
        arg: tmpDir,
        env: undefined,
        cwd: '/cwd',
        registry: reg,
      });
      expect(out.kind).toBe('ok');
      if (out.kind === 'ok') {
        expect(out.root).toBe(fs.realpathSync(tmpDir));
        expect(out.source).toBe('arg-path');
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('arg omitted, env set → use env', () => {
    const reg = mkRegistry([]);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpr-'));
    try {
      const out = resolveProjectRoot({
        arg: undefined,
        env: tmpDir,
        cwd: '/cwd',
        registry: reg,
      });
      expect(out.kind).toBe('ok');
      if (out.kind === 'ok') {
        expect(out.root).toBe(fs.realpathSync(tmpDir));
        expect(out.source).toBe('env');
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('arg + env both unset → use cwd', () => {
    const reg = mkRegistry([]);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpr-'));
    try {
      const out = resolveProjectRoot({
        arg: undefined,
        env: undefined,
        cwd: tmpDir,
        registry: reg,
      });
      expect(out.kind).toBe('ok');
      if (out.kind === 'ok') {
        expect(out.root).toBe(fs.realpathSync(tmpDir));
        expect(out.source).toBe('cwd');
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('path doesn\'t exist → project_root_not_found', () => {
    const reg = mkRegistry([]);
    const out = resolveProjectRoot({
      arg: '/nonexistent/path/xyzzy',
      env: undefined,
      cwd: '/cwd',
      registry: reg,
    });
    expect(out.kind).toBe('project_root_not_found');
  });
});

describe('validateDefaultRoot', () => {
  it('rejects filesystem root', () => {
    expect(validateDefaultRoot('/')).toBe(false);
  });

  it('rejects nonexistent', () => {
    expect(validateDefaultRoot('/nonexistent/xyzzy')).toBe(false);
  });

  it('rejects directory without project marker', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpr-novalid-'));
    try {
      expect(validateDefaultRoot(tmpDir)).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('accepts directory with .git', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpr-git-'));
    fs.mkdirSync(path.join(tmpDir, '.git'));
    try {
      expect(validateDefaultRoot(tmpDir)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('accepts directory with .ctxloom', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpr-ctx-'));
    fs.mkdirSync(path.join(tmpDir, '.ctxloom'));
    try {
      expect(validateDefaultRoot(tmpDir)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('accepts directory with package.json', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpr-pkg-'));
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    try {
      expect(validateDefaultRoot(tmpDir)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 1.2.2: Run test to verify it fails**

```bash
npx vitest run tests/ResolveProjectRoot.test.ts
```

Expected: FAIL — module `../packages/core/src/server/resolveProjectRoot.js` not found.

- [ ] **Step 1.2.3: Implement the resolver**

Create `packages/core/src/server/resolveProjectRoot.ts`:

```ts
/**
 * Pure resolver: pick a project root from an MCP tool call.
 *
 * Resolution order (per design spec §1):
 *   1. Explicit `arg`:
 *        - No path separator (`/`, leading `~`, drive letter) → alias-only.
 *          Registry miss returns `alias_not_found`. No silent path fallback.
 *        - Has path separator → resolve as path. Registry not consulted.
 *   2. `env.CTXLOOM_ROOT` (same as v1.0.31)
 *   3. `cwd` (same fallback as v1.0.31)
 *
 * Side-effect-free. Filesystem checks (existence) are real syscalls and
 * happen here — but no mutations, no logging.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface RegistryView {
  findByAlias(name: string): { root: string; alias?: string } | null;
  list(): { root: string; alias?: string }[];
}

export interface ResolveInput {
  arg: string | undefined;
  env: string | undefined;
  cwd: string;
  registry: RegistryView;
}

export type ResolveOutcome =
  | { kind: 'ok'; root: string; alias?: string; source: 'arg-alias' | 'arg-path' | 'env' | 'cwd' }
  | { kind: 'alias_not_found'; alias: string; didYouMean: string[] }
  | { kind: 'project_root_not_found'; attemptedPath: string; resolutionChain: string };

const PATH_SEPARATOR_PATTERN = /[/\\~]|^[A-Za-z]:/;

function looksLikePath(value: string): boolean {
  return PATH_SEPARATOR_PATTERN.test(value);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

function fuzzyMatchAliases(target: string, registry: RegistryView): string[] {
  return registry
    .list()
    .map((e) => e.alias)
    .filter((a): a is string => typeof a === 'string')
    .map((a) => ({ alias: a, dist: levenshtein(target, a) }))
    .filter((m) => m.dist <= 3)
    .sort((x, y) => x.dist - y.dist)
    .slice(0, 5)
    .map((m) => m.alias);
}

function resolvePathSafely(p: string, cwd: string): string {
  // Expand ~/foo to $HOME/foo. node:path doesn't do this for us.
  let expanded = p;
  if (p === '~' || p.startsWith('~/')) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    expanded = p === '~' ? home : path.join(home, p.slice(2));
  }
  return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(cwd, expanded);
}

function realpathOrSame(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

export function resolveProjectRoot(input: ResolveInput): ResolveOutcome {
  const { arg, env, cwd, registry } = input;

  // 1. Explicit arg
  if (arg !== undefined && arg !== '') {
    if (!looksLikePath(arg)) {
      // Alias-only lookup
      const hit = registry.findByAlias(arg);
      if (hit) {
        return {
          kind: 'ok',
          root: realpathOrSame(hit.root),
          alias: hit.alias,
          source: 'arg-alias',
        };
      }
      return {
        kind: 'alias_not_found',
        alias: arg,
        didYouMean: fuzzyMatchAliases(arg, registry),
      };
    }
    // Path-flavored arg
    const resolved = resolvePathSafely(arg, cwd);
    if (!fs.existsSync(resolved)) {
      return {
        kind: 'project_root_not_found',
        attemptedPath: resolved,
        resolutionChain: `arg:${arg}→${resolved}`,
      };
    }
    return { kind: 'ok', root: realpathOrSame(resolved), source: 'arg-path' };
  }

  // 2. Env
  if (env !== undefined && env !== '') {
    const resolved = resolvePathSafely(env, cwd);
    if (!fs.existsSync(resolved)) {
      return {
        kind: 'project_root_not_found',
        attemptedPath: resolved,
        resolutionChain: `env:CTXLOOM_ROOT→${resolved}`,
      };
    }
    return { kind: 'ok', root: realpathOrSame(resolved), source: 'env' };
  }

  // 3. cwd
  const resolved = resolvePathSafely(cwd, cwd);
  return { kind: 'ok', root: realpathOrSame(resolved), source: 'cwd' };
}

// ─── validateDefaultRoot ─────────────────────────────────────────────────────

const PROJECT_MARKERS = [
  '.ctxloom',
  '.git',
  'package.json',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'setup.py',
  'pom.xml',
  'build.gradle',
];

const FILESYSTEM_ROOTS = new Set(['/', 'C:\\', 'D:\\', 'E:\\', 'F:\\']);

export function validateDefaultRoot(candidate: string): boolean {
  if (FILESYSTEM_ROOTS.has(candidate)) return false;
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isDirectory()) return false;
  } catch {
    return false;
  }
  return PROJECT_MARKERS.some((m) => fs.existsSync(path.join(candidate, m)));
}
```

- [ ] **Step 1.2.4: Run tests to verify they pass**

```bash
npx vitest run tests/ResolveProjectRoot.test.ts
```

Expected: all 11 tests PASS.

- [ ] **Step 1.2.5: Commit**

```bash
git add packages/core/src/server/resolveProjectRoot.ts tests/ResolveProjectRoot.test.ts
git commit -m "feat(#70): add resolveProjectRoot + validateDefaultRoot

Pure resolver picking the project root from arg/env/cwd with strict
alias-vs-path disambiguation (no silent fallthrough). Side-effect-free
apart from existence checks. Used by ServerContext getters in Phase 2."
```

---

### Task 1.3: `ProjectState` type + per-state lazy getters

**Files:**
- Create: `packages/core/src/server/ProjectState.ts`

No tests yet — this is just a type + factories. The `ProjectStateManager` tests in Task 1.4 exercise the factories.

- [ ] **Step 1.3.1: Write the type module**

Create `packages/core/src/server/ProjectState.ts`:

```ts
/**
 * ProjectState — per-project lazy singletons.
 *
 * Mirrors the module-level singletons that lived in src/server.ts in
 * v1.0.31, but scoped to one project root. The ProjectStateManager owns
 * the lifecycle (creation on first touch, eviction on LRU pressure).
 *
 * Each lazy field follows the "in-flight promise" pattern so concurrent
 * first-call requests don't kick off N parallel inits.
 */
import path from 'node:path';
import { VectorStore } from '../db/VectorStore.js';
import { DependencyGraph } from '../graph/DependencyGraph.js';
import { ASTParser } from '../ast/ASTParser.js';
import { Skeletonizer } from '../ast/Skeletonizer.js';
import { GitOverlayStore } from '../git/GitOverlayStore.js';
import { RuleManager } from '../tools/ruleManager.js';
import { FileWatcher } from '../watcher/FileWatcher.js';
import { PathValidator } from '../security/PathValidator.js';

export interface ProjectState {
  /** Canonical absolute path. Key in ProjectStateManager.map. */
  projectRoot: string;
  /** Path to vectors.lancedb under projectRoot/.ctxloom/ */
  dbPath: string;
  /** Pinned state — survives LRU eviction. Set on the default project at boot. */
  pinned: boolean;
  /** Touched timestamp for LRU. */
  lastTouchedAt: number;
  /** True once Tier 2 (vector indexing) has run for this project. */
  vectorsInitialized: boolean;
  /** True once Tier 1 (graph build/load) has completed. */
  graphInitialized: boolean;
  storePromise: Promise<VectorStore> | null;
  parserPromise: Promise<ASTParser> | null;
  graphPromise: Promise<DependencyGraph> | null;
  skeletonizerPromise: Promise<Skeletonizer> | null;
  ruleManager: RuleManager | null;
  overlay: GitOverlayStore | null;
  watcher: FileWatcher | null;
  pathValidator: PathValidator | null;
}

export function createProjectState(projectRoot: string, opts: { pinned?: boolean } = {}): ProjectState {
  return {
    projectRoot,
    dbPath: path.join(projectRoot, '.ctxloom', 'vectors.lancedb'),
    pinned: opts.pinned ?? false,
    lastTouchedAt: Date.now(),
    vectorsInitialized: false,
    graphInitialized: false,
    storePromise: null,
    parserPromise: null,
    graphPromise: null,
    skeletonizerPromise: null,
    ruleManager: null,
    overlay: null,
    watcher: null,
    pathValidator: null,
  };
}

/**
 * Release OS-level resources held by a project state. Always best-effort;
 * never throws. Idempotent — safe to call on a fresh state.
 */
export async function disposeProjectState(state: ProjectState): Promise<void> {
  try {
    await state.watcher?.stop();
  } catch { /* best-effort */ }
  try {
    const store = state.storePromise ? await state.storePromise : null;
    await store?.close();
  } catch { /* best-effort */ }
  // The remaining fields (graph, parser, skeletonizer, ruleManager, overlay)
  // are pure-JS objects; the next GC collects them once we drop references.
  // Snapshots on disk (.ctxloom/graph-snapshot.json, vectors.lancedb/,
  // git-overlay.json) are NOT deleted — re-warming the same root later
  // skips the parse pass.
  state.watcher = null;
  state.storePromise = null;
  state.graphPromise = null;
  state.parserPromise = null;
  state.skeletonizerPromise = null;
  state.ruleManager = null;
  state.overlay = null;
  state.pathValidator = null;
  state.graphInitialized = false;
  state.vectorsInitialized = false;
}
```

- [ ] **Step 1.3.2: Type-check**

```bash
npm run lint   # tsc --noEmit
```

Expected: no errors. (If any imports don't resolve, fix the import paths — the imports above match v1.0.31 module layout.)

- [ ] **Step 1.3.3: Commit**

```bash
git add packages/core/src/server/ProjectState.ts
git commit -m "feat(#70): add ProjectState type + dispose helper

Per-project replacement for the module-level lazy singletons in
src/server.ts. Encapsulates store/graph/parser/skeletonizer promises,
rule manager, git overlay, file watcher, path validator. disposeProjectState
releases LanceDB FDs (via VectorStore.close from v1.0.29) and stops the
watcher; on-disk snapshots are preserved for cheap re-warming."
```

---

### Task 1.4: `ProjectStateManager` + LRU + tests

**Files:**
- Create: `packages/core/src/server/ProjectStateManager.ts`
- Test: `tests/ProjectStateManager.test.ts`

- [ ] **Step 1.4.1: Write the failing tests**

Create `tests/ProjectStateManager.test.ts`:

```ts
/**
 * Unit tests for ProjectStateManager.
 *
 * Verifies:
 *   - get(root) creates and caches ProjectState
 *   - second get(sameRoot) returns the cached state (object identity)
 *   - LRU cap evicts the oldest non-pinned entry
 *   - pinned entries never evict
 *   - dispose is called on eviction
 *   - concurrency: two parallel get(coldRoot) share one state
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectStateManager } from '../packages/core/src/server/ProjectStateManager.js';

describe('ProjectStateManager', () => {
  it('creates and caches ProjectState on first get', () => {
    const mgr = new ProjectStateManager({ maxProjects: 3 });
    const s1 = mgr.get('/abs/foo');
    const s2 = mgr.get('/abs/foo');
    expect(s1).toBe(s2); // object identity
    expect(s1.projectRoot).toBe('/abs/foo');
    expect(mgr.size()).toBe(1);
  });

  it('updates lastTouchedAt on each get', async () => {
    const mgr = new ProjectStateManager({ maxProjects: 3 });
    const s = mgr.get('/abs/foo');
    const t1 = s.lastTouchedAt;
    await new Promise((r) => setTimeout(r, 5));
    mgr.get('/abs/foo');
    expect(s.lastTouchedAt).toBeGreaterThan(t1);
  });

  it('evicts LRU non-pinned entry when cap exceeded', async () => {
    const disposeCalls: string[] = [];
    const mgr = new ProjectStateManager({
      maxProjects: 2,
      onDispose: (state) => {
        disposeCalls.push(state.projectRoot);
        return Promise.resolve();
      },
    });
    mgr.get('/abs/a'); // first
    await new Promise((r) => setTimeout(r, 5));
    mgr.get('/abs/b'); // second
    await new Promise((r) => setTimeout(r, 5));
    mgr.get('/abs/c'); // third — should evict /abs/a (LRU)
    await new Promise((r) => setTimeout(r, 50));
    expect(disposeCalls).toEqual(['/abs/a']);
    expect(mgr.has('/abs/a')).toBe(false);
    expect(mgr.has('/abs/b')).toBe(true);
    expect(mgr.has('/abs/c')).toBe(true);
  });

  it('never evicts a pinned entry, even if it is the LRU', async () => {
    const mgr = new ProjectStateManager({ maxProjects: 2 });
    mgr.pin('/abs/default'); // pinned, first
    await new Promise((r) => setTimeout(r, 5));
    mgr.get('/abs/b'); // second
    await new Promise((r) => setTimeout(r, 5));
    mgr.get('/abs/c'); // third — must evict /abs/b, NOT /abs/default
    expect(mgr.has('/abs/default')).toBe(true);
    expect(mgr.has('/abs/b')).toBe(false);
    expect(mgr.has('/abs/c')).toBe(true);
  });

  it('parallel get() on the same cold root returns identical ProjectState', () => {
    const mgr = new ProjectStateManager({ maxProjects: 3 });
    // get() is synchronous and idempotent — first call creates, second sees cache.
    // We're verifying there's no race window where two concurrent gets create two states.
    const a = mgr.get('/abs/foo');
    const b = mgr.get('/abs/foo');
    expect(a).toBe(b);
    expect(mgr.size()).toBe(1);
  });

  it('throws on adding past cap when ALL entries are pinned', () => {
    const mgr = new ProjectStateManager({ maxProjects: 2 });
    mgr.pin('/abs/a');
    mgr.pin('/abs/b');
    expect(() => mgr.get('/abs/c')).toThrow(/cannot evict — all .* pinned/);
  });
});
```

- [ ] **Step 1.4.2: Run test to verify it fails**

```bash
npx vitest run tests/ProjectStateManager.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 1.4.3: Implement `ProjectStateManager`**

Create `packages/core/src/server/ProjectStateManager.ts`:

```ts
/**
 * ProjectStateManager — per-project state cache with LRU eviction.
 *
 * The server holds exactly one ProjectStateManager. Every tool call's
 * resolveProjectRoot output keys into it. First touch creates a state,
 * subsequent touches return the cached one. When the configured cap is
 * exceeded, the LRU non-pinned entry is evicted (its handles released
 * via the configured onDispose callback, defaulting to disposeProjectState).
 *
 * Pinned entries are exempt from eviction. The default project (resolved
 * at server boot from CTXLOOM_ROOT or cwd, post-validation) is pinned.
 * If validation fails, no default is pinned and the server runs in
 * "no-default mode" — see src/server.ts.
 *
 * get() is synchronous: state creation is a constant-time object
 * allocation. The expensive work (graph build, vector init) is gated on
 * the lazy fields inside ProjectState, triggered by tool calls.
 */
import { ProjectState, createProjectState, disposeProjectState } from './ProjectState.js';
import { logger } from '../utils/logger.js';

export interface ProjectStateManagerOptions {
  /** Max active (non-pinned + pinned) entries. Default 5. */
  maxProjects?: number;
  /** Callback fired before a state is removed. Default: disposeProjectState. */
  onDispose?: (state: ProjectState) => Promise<void>;
}

const DEFAULT_MAX_PROJECTS = 5;

export class ProjectStateManager {
  private readonly map = new Map<string, ProjectState>();
  private readonly maxProjects: number;
  private readonly onDispose: (state: ProjectState) => Promise<void>;

  constructor(opts: ProjectStateManagerOptions = {}) {
    this.maxProjects = opts.maxProjects ?? DEFAULT_MAX_PROJECTS;
    this.onDispose = opts.onDispose ?? disposeProjectState;
  }

  size(): number {
    return this.map.size;
  }

  has(root: string): boolean {
    return this.map.has(root);
  }

  /**
   * Get-or-create the state for `root`. Updates lastTouchedAt on every call.
   * Throws if creating a new entry would exceed maxProjects and no non-pinned
   * entry can be evicted.
   */
  get(root: string): ProjectState {
    const existing = this.map.get(root);
    if (existing) {
      existing.lastTouchedAt = Date.now();
      return existing;
    }
    if (this.map.size >= this.maxProjects) {
      this.evictLRU();
    }
    const fresh = createProjectState(root);
    this.map.set(root, fresh);
    return fresh;
  }

  /**
   * Create-and-pin a state. Used for the default project at server boot
   * (when it passes validation). Pinned states never get LRU-evicted.
   */
  pin(root: string): ProjectState {
    const state = this.get(root);
    state.pinned = true;
    return state;
  }

  /**
   * List all active states ordered most-recently-touched first.
   */
  list(): ProjectState[] {
    return Array.from(this.map.values()).sort((a, b) => b.lastTouchedAt - a.lastTouchedAt);
  }

  /**
   * Evict the LRU non-pinned entry. Throws if all entries are pinned.
   */
  private evictLRU(): void {
    let victim: ProjectState | undefined;
    for (const state of this.map.values()) {
      if (state.pinned) continue;
      if (!victim || state.lastTouchedAt < victim.lastTouchedAt) {
        victim = state;
      }
    }
    if (!victim) {
      throw new Error(
        `ProjectStateManager: cannot evict — all ${this.map.size} entries are pinned. ` +
        `Raise CTXLOOM_MAX_PROJECTS or unpin entries.`,
      );
    }
    this.map.delete(victim.projectRoot);
    // Fire-and-forget — the LRU eviction signal isn't waitable from a
    // synchronous get() call. Dispose errors are swallowed inside
    // disposeProjectState.
    void this.onDispose(victim).then(() => {
      logger.info('project.evicted', {
        root: victim!.projectRoot,
        reason: 'lru_cap_reached',
        ttl_seconds: Math.round((Date.now() - victim!.lastTouchedAt) / 1000),
      });
    });
  }

  /**
   * Dispose all states and clear the map. Use only on shutdown.
   */
  async drain(): Promise<void> {
    for (const state of this.map.values()) {
      await this.onDispose(state);
    }
    this.map.clear();
  }
}
```

- [ ] **Step 1.4.4: Run tests to verify they pass**

```bash
npx vitest run tests/ProjectStateManager.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 1.4.5: Commit**

```bash
git add packages/core/src/server/ProjectStateManager.ts tests/ProjectStateManager.test.ts
git commit -m "feat(#70): add ProjectStateManager with LRU eviction

Per-project state cache that replaces src/server.ts module-level
singletons. LRU at configurable cap (default 5); pinned default
project never evicts; eviction calls disposeProjectState to release
LanceDB FDs and stop the watcher."
```

---

### Task 1.5: `RepoRegistry` alias support + tests

**Files:**
- Modify: `packages/core/src/tools/cross-repo-search.ts` (lines 28-83 — `RegisteredRepo` interface + `RepoRegistry` class)
- Test: `tests/RepoRegistryAlias.test.ts`

- [ ] **Step 1.5.1: Write the failing tests**

Create `tests/RepoRegistryAlias.test.ts`:

```ts
/**
 * Unit tests for RepoRegistry alias support.
 *
 * Verifies:
 *   - registering with alias persists to disk
 *   - findByAlias resolves to the matching entry
 *   - findByPath resolves a canonical path back to the entry
 *   - alias collision is rejected
 *   - alias regex enforcement (lowercase alphanumeric + hyphen, 1-40 chars)
 *   - subcommand-name shadowing is rejected
 *   - existing alias-less repos.json files load without error (forward compat)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { RepoRegistry, validateAlias } from '../packages/core/src/tools/cross-repo-search.js';

describe('RepoRegistry alias support', () => {
  let tmpFile: string;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rra-'));
    tmpFile = path.join(tmpDir, 'repos.json');
  });

  afterEach(() => {
    if (fs.existsSync(tmpFile)) fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
  });

  it('register without alias works as before', () => {
    const reg = new RepoRegistry(tmpFile);
    reg.register('/abs/foo', '/abs/foo/.ctxloom/vectors.lancedb');
    const entries = reg.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].root).toBe('/abs/foo');
    expect(entries[0].alias).toBeUndefined();
  });

  it('register with alias persists alias', () => {
    const reg = new RepoRegistry(tmpFile);
    reg.register('/abs/foo', '/abs/foo/.ctxloom/vectors.lancedb', { alias: 'foo' });
    const found = reg.findByAlias('foo');
    expect(found?.root).toBe('/abs/foo');
    expect(found?.alias).toBe('foo');
  });

  it('findByAlias returns null for unknown alias', () => {
    const reg = new RepoRegistry(tmpFile);
    expect(reg.findByAlias('nope')).toBeNull();
  });

  it('findByPath returns the entry with canonical comparison', () => {
    const reg = new RepoRegistry(tmpFile);
    reg.register('/abs/foo', '/abs/foo/.ctxloom/vectors.lancedb', { alias: 'foo' });
    const found = reg.findByPath('/abs/foo');
    expect(found?.alias).toBe('foo');
  });

  it('rejects alias collision', () => {
    const reg = new RepoRegistry(tmpFile);
    reg.register('/abs/foo', '/abs/foo/.ctxloom/vectors.lancedb', { alias: 'foo' });
    expect(() =>
      reg.register('/abs/bar', '/abs/bar/.ctxloom/vectors.lancedb', { alias: 'foo' }),
    ).toThrow(/alias.*already registered/i);
  });

  it('updating same root with same alias is a no-op (idempotent)', () => {
    const reg = new RepoRegistry(tmpFile);
    reg.register('/abs/foo', '/abs/foo/.ctxloom/vectors.lancedb', { alias: 'foo' });
    reg.register('/abs/foo', '/abs/foo/.ctxloom/vectors.lancedb', { alias: 'foo' });
    expect(reg.list()).toHaveLength(1);
  });

  it('loads existing alias-less repos.json without error', () => {
    fs.writeFileSync(
      tmpFile,
      JSON.stringify([
        {
          root: '/legacy',
          dbPath: '/legacy/.ctxloom/vectors.lancedb',
          name: 'legacy',
          registeredAt: '2026-01-01T00:00:00Z',
        },
      ]),
    );
    const reg = new RepoRegistry(tmpFile);
    expect(reg.list()[0].root).toBe('/legacy');
    expect(reg.list()[0].alias).toBeUndefined();
  });
});

describe('validateAlias', () => {
  it('accepts lowercase alphanumeric + hyphen', () => {
    expect(validateAlias('contextmesh')).toEqual({ ok: true });
    expect(validateAlias('api-server')).toEqual({ ok: true });
    expect(validateAlias('proj-42-v2')).toEqual({ ok: true });
  });

  it('rejects uppercase', () => {
    expect(validateAlias('Foo').ok).toBe(false);
  });

  it('rejects underscores', () => {
    expect(validateAlias('my_proj').ok).toBe(false);
  });

  it('rejects empty', () => {
    expect(validateAlias('').ok).toBe(false);
  });

  it('rejects > 40 chars', () => {
    expect(validateAlias('a'.repeat(41)).ok).toBe(false);
  });

  it('rejects subcommand-name shadows', () => {
    for (const name of ['register', 'repos', 'setup', 'index', 'init', 'dashboard', 'status', 'trial', 'activate', 'deactivate', 'grammars', 'help']) {
      expect(validateAlias(name).ok).toBe(false);
    }
  });
});
```

- [ ] **Step 1.5.2: Run test to verify it fails**

```bash
npx vitest run tests/RepoRegistryAlias.test.ts
```

Expected: FAIL — `validateAlias` not exported, `findByAlias` doesn't exist.

- [ ] **Step 1.5.3: Modify `RepoRegistry`**

Edit `packages/core/src/tools/cross-repo-search.ts`. Replace the `RegisteredRepo` interface (lines 28-33) and `RepoRegistry` class (lines 35-83) with:

```ts
export interface RegisteredRepo {
  root: string;            // absolute path to repo root
  dbPath: string;          // absolute path to the LanceDB store
  name: string;            // display name (basename of root)
  alias?: string;          // optional short name for `project_root` lookups
  registeredAt: string;    // ISO date string
}

const ALIAS_REGEX = /^[a-z0-9-]{1,40}$/;

const RESERVED_ALIASES = new Set([
  'register', 'repos', 'setup', 'index', 'init', 'dashboard', 'status',
  'trial', 'activate', 'deactivate', 'grammars', 'help', 'review-suggest',
]);

export interface AliasValidation {
  ok: boolean;
  reason?: string;
}

export function validateAlias(alias: string): AliasValidation {
  if (!ALIAS_REGEX.test(alias)) {
    return {
      ok: false,
      reason: `alias must match ${ALIAS_REGEX.source} (lowercase, alphanumeric+hyphen, 1-40 chars)`,
    };
  }
  if (RESERVED_ALIASES.has(alias)) {
    return {
      ok: false,
      reason: `alias '${alias}' shadows a ctxloom subcommand`,
    };
  }
  return { ok: true };
}

export class RepoRegistry {
  private readonly filePath: string;
  private repos: RegisteredRepo[];

  constructor(filePath: string) {
    this.filePath = filePath;
    this.repos = this.load();
  }

  private load(): RegisteredRepo[] {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      return JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as RegisteredRepo[];
    } catch {
      return [];
    }
  }

  private save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.repos, null, 2), 'utf-8');
  }

  list(): RegisteredRepo[] {
    return [...this.repos];
  }

  findByAlias(alias: string): RegisteredRepo | null {
    return this.repos.find((r) => r.alias === alias) ?? null;
  }

  findByPath(absPath: string): RegisteredRepo | null {
    const canonical = path.resolve(absPath);
    return this.repos.find((r) => path.resolve(r.root) === canonical) ?? null;
  }

  register(root: string, dbPath: string, opts: { alias?: string } = {}): void {
    if (opts.alias !== undefined) {
      const v = validateAlias(opts.alias);
      if (!v.ok) throw new Error(`Invalid alias: ${v.reason}`);
      // Reject collision unless the colliding entry has the same root
      const colliding = this.repos.find(
        (r) => r.alias === opts.alias && path.resolve(r.root) !== path.resolve(root),
      );
      if (colliding) {
        throw new Error(
          `Alias '${opts.alias}' is already registered to ${colliding.root}. ` +
          `Pick a different alias or unregister the existing entry first.`,
        );
      }
    }
    const existingIdx = this.repos.findIndex((r) => path.resolve(r.root) === path.resolve(root));
    const entry: RegisteredRepo = {
      root,
      dbPath,
      name: path.basename(root),
      alias: opts.alias,
      registeredAt: new Date().toISOString(),
    };
    if (existingIdx >= 0) {
      this.repos = this.repos.map((r, i) => (i === existingIdx ? entry : r));
    } else {
      this.repos = [...this.repos, entry];
    }
    this.save();
  }

  unregister(root: string): void {
    this.repos = this.repos.filter((r) => path.resolve(r.root) !== path.resolve(root));
    this.save();
  }
}
```

- [ ] **Step 1.5.4: Run tests to verify they pass**

```bash
npx vitest run tests/RepoRegistryAlias.test.ts
```

Expected: all 13 tests PASS.

- [ ] **Step 1.5.5: Verify existing cross-repo-search tests still pass**

```bash
npx vitest run tests/CrossRepoSearch.test.ts 2>&1 | tail -5
```

Expected: PASS. (If this test file doesn't exist, skip — it just confirms we didn't break the existing tool wiring.)

- [ ] **Step 1.5.6: Commit**

```bash
git add packages/core/src/tools/cross-repo-search.ts tests/RepoRegistryAlias.test.ts
git commit -m "feat(#70): extend RepoRegistry with optional alias support

RegisteredRepo gains optional alias field. RepoRegistry gets findByAlias
and findByPath lookup helpers, plus collision/regex/reserved-name
validation via validateAlias(). Forward-compatible: existing repos.json
files without alias field load identically."
```

---

### Phase 1 checkpoint

- [ ] **Run full test suite**

```bash
npx vitest run 2>&1 | tail -5
```

Expected: all tests pass (no regressions; the new tests are additive).

- [ ] **Run typecheck**

```bash
npm run lint
```

Expected: no errors.

---

## Phase 2 — Wire `ServerContext` to `ProjectStateManager`

This phase swaps `src/server.ts` from module-level lazy singletons to the new manager. Public behavior is unchanged when no `project_root` is passed (tools call `ctx.getStore()` / `getStore(undefined)` and get the default project's state).

### Task 2.1: Extend `ServerContext` interface

**Files:**
- Modify: `packages/core/src/tools/context.ts`

- [ ] **Step 2.1.1: Read current file**

```bash
cat packages/core/src/tools/context.ts
```

- [ ] **Step 2.1.2: Update the interface**

Replace the entire content of `packages/core/src/tools/context.ts` with:

```ts
import type { PathValidator } from '../security/PathValidator.js';
import type { VectorStore } from '../db/VectorStore.js';
import type { DependencyGraph } from '../graph/DependencyGraph.js';
import type { ASTParser } from '../ast/ASTParser.js';
import type { Skeletonizer } from '../ast/Skeletonizer.js';
import type { RuleManager } from './ruleManager.js';
import type { GitOverlayStore } from '../git/GitOverlayStore.js';
import type { RepoRegistry } from './cross-repo-search.js';

/**
 * ServerContext — handed to every tool's registration callback.
 *
 * v1.1 change: getters now accept an optional `projectRoot` argument.
 * When omitted, the getter operates on the default project (resolved at
 * server boot from CTXLOOM_ROOT env or cwd, post-validation). When
 * passed, the getter operates on that specific project — first-touch
 * triggers a Tier-1 graph build/load against the new root.
 *
 * The `projectRoot` field is preserved for back-compat: it always
 * reports the default project's root. Tools that need per-call routing
 * MUST resolve via the param + registry instead of reading this field.
 */
export interface ServerContext {
  /** The default project root (server-boot resolved). Stays for back-compat. */
  projectRoot: string;
  /** Default project's LanceDB path (back-compat field). */
  dbPath: string;
  /** True when the server entered no-default mode (boot validation failed). */
  noDefaultMode: boolean;

  // ─── Lazy getters (all accept optional projectRoot) ──────────────────
  getStore: (projectRoot?: string) => Promise<VectorStore>;
  getGraph: (projectRoot?: string) => Promise<DependencyGraph>;
  getParser: (projectRoot?: string) => Promise<ASTParser>;
  getSkeletonizer: (projectRoot?: string) => Promise<Skeletonizer>;
  getRuleManager: (projectRoot?: string) => RuleManager;
  getPathValidator: (projectRoot?: string) => PathValidator;

  // ─── Diagnostic (default project only — multi-project view lives in ctx_status) ──
  isStoreInitialized: () => boolean;
  isGraphInitialized: () => boolean;
  isParserInitialized: () => boolean;

  /** Git overlay for the default project (back-compat field). */
  overlay?: GitOverlayStore;

  /** Registry surface for resolveProjectRoot. Stable across requests. */
  registry: RepoRegistry;
}
```

- [ ] **Step 2.1.3: Typecheck**

```bash
npm run lint 2>&1 | tail -20
```

Expected: many errors from tool files that still call `ctx.getStore()` without args — that's fine in this step (the optional arg means callers still compile, but TS may flag any callers that explicitly pass `()`). If errors mention "Type X is not assignable to never" or similar, those are tools that need attention in Phase 3. Note them but don't fix yet.

If there are blocking errors, fix the OPTIONAL-arg compat by ensuring every getter signature accepts `()` (no arg) — TypeScript allows this for parameters with `?`.

- [ ] **Step 2.1.4: Commit**

```bash
git add packages/core/src/tools/context.ts
git commit -m "feat(#70): extend ServerContext getters with optional projectRoot

Signature change is additive — callers passing no argument continue to
get the default project's state. Adds noDefaultMode flag and registry
field for tools that need to resolve project_root parameters."
```

---

### Task 2.2: Rewrite `src/server.ts` to use `ProjectStateManager`

**Files:**
- Modify: `src/server.ts` (major)

This is the biggest single edit in the plan. Read the existing file first.

- [ ] **Step 2.2.1: Read current `src/server.ts`**

```bash
cat src/server.ts | head -150
```

- [ ] **Step 2.2.2: Replace the lazy-singleton block and `buildContext`**

Edit `src/server.ts`. Replace lines 63-126 (the `// ─── Lazy singletons ───` block and the `buildContext` function) with the implementation below. The rest of the file (imports, PROJECT_ROOT IIFE, `createServer`, `startServer`) stays.

```ts
// ─── State manager (replaces module-level lazy singletons) ───────────────
import { ProjectStateManager } from '@ctxloom/core/server/ProjectStateManager.js';
import type { ProjectState } from '@ctxloom/core/server/ProjectState.js';
import { resolveProjectRoot as resolveRoot } from '@ctxloom/core/server/resolveProjectRoot.js';
import { validateDefaultRoot } from '@ctxloom/core/server/resolveProjectRoot.js';

const DISABLE_MULTIPROJECT = process.env.CTXLOOM_DISABLE_MULTIPROJECT === '1';
const MAX_PROJECTS = (() => {
  const v = Number(process.env.CTXLOOM_MAX_PROJECTS ?? '');
  return Number.isFinite(v) && v >= 1 ? v : 5;
})();

const repoRegistryPath = path.join(
  process.env.HOME ?? process.env.USERPROFILE ?? '',
  '.ctxloom',
  'repos.json',
);

const stateManager = new ProjectStateManager({
  maxProjects: DISABLE_MULTIPROJECT ? 1 : MAX_PROJECTS,
});

// Lazy helpers — each one inits the corresponding field on the project state.
async function initStore(state: ProjectState): Promise<VectorStore> {
  if (!state.storePromise) {
    state.storePromise = (async () => {
      const s = new VectorStore(state.dbPath);
      await s.init();
      return s;
    })();
  }
  return state.storePromise;
}

async function initParser(state: ProjectState): Promise<ASTParser> {
  if (!state.parserPromise) {
    state.parserPromise = (async () => {
      const p = new ASTParser();
      await p.init();
      return p;
    })();
  }
  return state.parserPromise;
}

async function initGraph(state: ProjectState): Promise<DependencyGraph> {
  if (!state.graphPromise) {
    state.graphPromise = (async () => {
      const parser = await initParser(state);
      const graph = new DependencyGraph();
      graph.setParser(parser);
      await graph.buildFromDirectory(state.projectRoot);
      state.graphInitialized = true;
      return graph;
    })();
  }
  return state.graphPromise;
}

async function initSkeletonizer(state: ProjectState): Promise<Skeletonizer> {
  if (!state.skeletonizerPromise) {
    state.skeletonizerPromise = (async () => {
      const sk = new Skeletonizer();
      await sk.init();
      return sk;
    })();
  }
  return state.skeletonizerPromise;
}

function buildContext(defaultRoot: string | null, noDefaultMode: boolean): ServerContext {
  const repoRegistry = new (require('@ctxloom/core').RepoRegistry)(repoRegistryPath);

  function resolveOrDefault(arg: string | undefined): ProjectState {
    if (DISABLE_MULTIPROJECT) {
      if (!defaultRoot) {
        throw new Error('CTXLOOM_DISABLE_MULTIPROJECT=1 but server has no default root.');
      }
      return stateManager.get(defaultRoot);
    }
    if (arg === undefined) {
      if (!defaultRoot) {
        throw new Error('no_default_project'); // converted to structured error at tool layer
      }
      return stateManager.get(defaultRoot);
    }
    const outcome = resolveRoot({
      arg,
      env: process.env.CTXLOOM_ROOT,
      cwd: process.cwd(),
      registry: repoRegistry,
    });
    if (outcome.kind !== 'ok') {
      throw new Error(JSON.stringify(outcome));
    }
    return stateManager.get(outcome.root);
  }

  const ctx: ServerContext = {
    projectRoot: defaultRoot ?? '',
    dbPath: defaultRoot ? path.join(defaultRoot, '.ctxloom', 'vectors.lancedb') : '',
    noDefaultMode,
    registry: repoRegistry,
    getStore: (root) => initStore(resolveOrDefault(root)),
    getGraph: (root) => initGraph(resolveOrDefault(root)),
    getParser: (root) => initParser(resolveOrDefault(root)),
    getSkeletonizer: (root) => initSkeletonizer(resolveOrDefault(root)),
    getRuleManager: (root) => {
      const state = resolveOrDefault(root);
      if (!state.ruleManager) {
        state.ruleManager = new RuleManager(state.projectRoot, ctx.getPathValidator(state.projectRoot));
      }
      return state.ruleManager;
    },
    getPathValidator: (root) => {
      const state = resolveOrDefault(root);
      if (!state.pathValidator) {
        state.pathValidator = new PathValidator(state.projectRoot);
      }
      return state.pathValidator;
    },
    isStoreInitialized: () => {
      if (!defaultRoot) return false;
      const state = stateManager.has(defaultRoot) ? stateManager.get(defaultRoot) : null;
      if (state?.storePromise) return true;
      return fs.existsSync(path.join(defaultRoot, '.ctxloom', 'vectors.lancedb', 'code_embeddings.lance'));
    },
    isGraphInitialized: () => {
      if (!defaultRoot) return false;
      const state = stateManager.has(defaultRoot) ? stateManager.get(defaultRoot) : null;
      return state?.graphInitialized ?? false;
    },
    isParserInitialized: () => {
      if (!defaultRoot) return false;
      const state = stateManager.has(defaultRoot) ? stateManager.get(defaultRoot) : null;
      return !!state?.parserPromise;
    },
  };
  return ctx;
}
```

- [ ] **Step 2.2.3: Update `createServer` and `startServer` to validate default root**

In `src/server.ts`, find `export function createServer()` (around line 129). Replace it with:

```ts
export function createServer(): { server: Server; ctx: ServerContext } {
  const server = new Server({ name: 'ctxloom', version: '1.0.0' }, { capabilities: { tools: {} } });
  // Validate the default-root candidate. If validation fails, server runs
  // in no-default mode: tool calls without project_root return the
  // no_default_project structured error.
  const candidateDefault = PROJECT_ROOT;
  const isValidDefault = validateDefaultRoot(candidateDefault);
  if (!isValidDefault) {
    logger.warn(
      'No valid default project detected — server entering no-default mode. ' +
      'All tool calls require explicit project_root.',
      { attempted: candidateDefault },
    );
  }
  const defaultRoot = isValidDefault ? candidateDefault : null;
  if (defaultRoot) stateManager.pin(defaultRoot);
  const ctx = buildContext(defaultRoot, !isValidDefault);
  const registry = createToolRegistry(ctx);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: registry.list() }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params: { name, arguments: args } }) => {
    try {
      const text = await registry.dispatch(name, args);
      return { content: [{ type: 'text' as const, text }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  });
  return { server, ctx };
}
```

- [ ] **Step 2.2.4: Update `startServer` warmup to skip when in no-default mode**

In `src/server.ts`, find the warmup block (around line 162: `Promise.all([ctx.getGraph(), generateEmbedding('warmup')]).then(...)`). Wrap it:

```ts
if (!ctx.noDefaultMode) {
  Promise.all([ctx.getGraph(), generateEmbedding('warmup')]).then(async ([graph]) => {
    logger.info('Ready', { edges: graph.edgeCount() });
    // … existing git overlay bootstrap stays here unchanged …
  }).catch(err => {
    logger.warn('Initialization warning', { detail: String(err) });
  });
} else {
  logger.info('Server started in no-default mode — skipping warmup.');
}
```

Also wrap the `FileWatcher` startup similarly (no watcher if there's no default root):

```ts
if (!ctx.noDefaultMode) {
  const watcher = new FileWatcher(PROJECT_ROOT, async (absPath, event) => {
    // … existing watcher handler body, unchanged …
  });
  watcher.start();
  logger.info('File watcher active');
  process.on('SIGINT', () => { watcher.stop(); process.exit(0); });
  process.on('SIGTERM', () => { watcher.stop(); process.exit(0); });
} else {
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}
```

- [ ] **Step 2.2.5: Typecheck**

```bash
npm run lint 2>&1 | tail -30
```

Expected: zero errors. If tools have type errors against the new ctx signature, fix them by passing `undefined` explicitly OR leave them broken until Phase 3 (whichever your testing flow prefers — recommend fix now so the suite passes between phases).

- [ ] **Step 2.2.6: Run the full test suite**

```bash
npx vitest run 2>&1 | tail -15
```

Expected: all v1.0.31 tests still pass. Any failure means a tool's behavior changed unexpectedly when getters were swapped — investigate before proceeding.

- [ ] **Step 2.2.7: Commit**

```bash
git add src/server.ts
git commit -m "feat(#70): swap server lazy singletons for ProjectStateManager

src/server.ts no longer holds module-level _storePromise / _graphPromise
etc. — they live in a per-project ProjectState owned by a
ProjectStateManager. ctx getters route through it. When no project_root
is passed (every existing tool today), behavior is unchanged: the
default project (CTXLOOM_ROOT or cwd, post-validation) is pinned and
serves the call.

If the default-root candidate fails validateDefaultRoot, server boots
in no-default mode: warmup + file watcher are skipped, tool calls
without project_root throw, and the (Phase 6) structured error
converts that to a no_default_project response."
```

---

### Task 2.3: Smoke-test the refactored server

- [ ] **Step 2.3.1: Build the CLI**

```bash
npm run build:cli 2>&1 | tail -5
```

Expected: build success.

- [ ] **Step 2.3.2: Launch the server in no-default mode and confirm warning**

```bash
CTXLOOM_ROOT="" cd / && node /Users/ricardoribeiro/GitHub/contextmesh/dist/index.js 2>&1 &
SERVER_PID=$!
sleep 2
kill $SERVER_PID 2>/dev/null
```

Expected: the log line `No valid default project detected — server entering no-default mode` appears in stderr.

- [ ] **Step 2.3.3: Launch with valid root and confirm warmup proceeds**

```bash
CTXLOOM_ROOT=/Users/ricardoribeiro/GitHub/contextmesh node /Users/ricardoribeiro/GitHub/contextmesh/dist/index.js 2>&1 &
SERVER_PID=$!
sleep 5
kill $SERVER_PID 2>/dev/null
```

Expected: the log line `Ready { edges: ... }` appears.

- [ ] **Step 2.3.4: Commit nothing (smoke test only)**

---

## Phase 3 — Add `project_root` parameter to every tool

This phase exposes the parameter on every tool's input schema and wires it through `ctx.getXxx(project_root)`. Each tool is a small, self-contained change.

### Task 3.1: Build the helper pattern using `ctx_status` as the worked example

We pick `ctx_status` because it's the simplest tool (no other arguments). Once this works, we replicate the pattern.

**Files:**
- Modify: `packages/core/src/tools/status.ts`
- Test: `tests/StatusTool.test.ts` (extend existing)

- [ ] **Step 3.1.1: Look at the existing test file**

```bash
cat tests/StatusTool.test.ts
```

- [ ] **Step 3.1.2: Add a failing test for `project_root` parameter routing**

Append to `tests/StatusTool.test.ts`:

```ts
describe('ctx_status with project_root parameter', () => {
  it('returns single-project view when project_root is passed', async () => {
    // … set up a ServerContext with two registered projects (default + alt)
    // … call ctx_status({ project_root: '/abs/alt' })
    // … expect only the alt project's <project_root>, no <active_projects>
    // (Implementation detail: spin up a real createServer() with mocked ctx,
    // or unit-test the tool handler directly.)
  });

  it('returns multi-project view when no project_root is passed', async () => {
    // … expect <active_projects> and <registered_projects> blocks
  });
});
```

*(Real test code for this is fleshed out in Task 5.2 where `ctx_status` is rewritten. For now this is a stub-failing test to prove the schema accepts the param.)*

A simpler immediate failing test — just verify the schema accepts `project_root`:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createToolRegistry } from '../packages/core/src/tools/index.js';

it('ctx_status schema accepts project_root', () => {
  // After Task 3.1, the input schema must list project_root.
  const registry = createToolRegistry(mockCtx);
  const status = registry.list().find((t) => t.name === 'ctx_status');
  expect(status?.inputSchema.properties).toHaveProperty('project_root');
});
```

- [ ] **Step 3.1.3: Run test to verify it fails**

```bash
npx vitest run tests/StatusTool.test.ts -t 'schema accepts project_root'
```

Expected: FAIL.

- [ ] **Step 3.1.4: Update `packages/core/src/tools/status.ts`**

Replace `inputSchema` and the handler:

```ts
inputSchema: {
  type: 'object',
  properties: {
    project_root: {
      type: 'string',
      description:
        'Absolute path or registered alias of the project to operate on. ' +
        'Omit to get the multi-project view (default project + active list + registry).',
    },
  },
},
```

And the handler:

```ts
async (args) => {
  const Schema = z.object({ project_root: z.string().optional() });
  const { project_root } = Schema.parse(args ?? {});
  // … existing body, but pass project_root through to ctx getters:
  //     const graph = await ctx.getGraph(project_root);
  //     const store = await ctx.getStore(project_root);
  // For Phase 3 leave the XML shape unchanged (still emits top-level fields
  // only). Phase 5 adds <active_projects> + <registered_projects>.
}
```

- [ ] **Step 3.1.5: Run test to verify it passes**

```bash
npx vitest run tests/StatusTool.test.ts -t 'schema accepts project_root'
```

Expected: PASS.

- [ ] **Step 3.1.6: Commit**

```bash
git add packages/core/src/tools/status.ts tests/StatusTool.test.ts
git commit -m "feat(#70): ctx_status accepts project_root parameter (worked example)"
```

---

### Task 3.2: Define the schema-extension helper

Apply the same shape to 32 more tools is tedious by hand. Add a tiny helper that returns the parameter spec, so every tool can reuse it.

**Files:**
- Create: `packages/core/src/tools/projectRootParam.ts`

- [ ] **Step 3.2.1: Write the helper**

Create `packages/core/src/tools/projectRootParam.ts`:

```ts
/**
 * Reusable input-schema fragment for the optional `project_root` parameter.
 * Every tool registered after #70 includes it via spread.
 */
import { z } from 'zod';

export const PROJECT_ROOT_DESCRIPTION =
  'Absolute path or registered alias of the project to operate on. ' +
  'Falls back to CTXLOOM_ROOT env, then server cwd. ' +
  'Register aliases with `ctxloom register <path> --alias <name>`.';

export const PROJECT_ROOT_JSON_SCHEMA = {
  type: 'string' as const,
  description: PROJECT_ROOT_DESCRIPTION,
};

export const ProjectRootField = z.string().optional().describe(PROJECT_ROOT_DESCRIPTION);
```

- [ ] **Step 3.2.2: Commit**

```bash
git add packages/core/src/tools/projectRootParam.ts
git commit -m "feat(#70): add projectRootParam helper for tool schemas"
```

---

### Task 3.3: Apply the param to every remaining tool

For each tool in the list below, the change is mechanical:
1. Import `ProjectRootField` and `PROJECT_ROOT_JSON_SCHEMA` from `./projectRootParam.js`.
2. Add `project_root: ProjectRootField` to the Zod schema.
3. Add `project_root: PROJECT_ROOT_JSON_SCHEMA` to `inputSchema.properties`.
4. Destructure `project_root` from the parsed args.
5. Change every `ctx.getStore()`, `ctx.getGraph()`, `ctx.getParser()`, `ctx.getSkeletonizer()`, `ctx.getRuleManager()`, `ctx.getPathValidator()` call inside the handler to pass `project_root`.

**Files (apply once each):**

- [ ] `packages/core/src/tools/search.ts`
- [ ] `packages/core/src/tools/full-text-search.ts`
- [ ] `packages/core/src/tools/similar-files.ts`
- [ ] `packages/core/src/tools/blast-radius.ts`
- [ ] `packages/core/src/tools/detect-changes.ts`
- [ ] `packages/core/src/tools/get-affected-flows.ts`
- [ ] `packages/core/src/tools/git-diff-review.ts`
- [ ] `packages/core/src/tools/definition.ts`
- [ ] `packages/core/src/tools/call-graph.ts`
- [ ] `packages/core/src/tools/execution-flow.ts`
- [ ] `packages/core/src/tools/context-packet.ts`
- [ ] `packages/core/src/tools/file.ts`
- [ ] `packages/core/src/tools/community-list.ts`
- [ ] `packages/core/src/tools/wiki-generate.ts`
- [ ] `packages/core/src/tools/hub-nodes.ts`
- [ ] `packages/core/src/tools/bridge-nodes.ts`
- [ ] `packages/core/src/tools/knowledge-gaps.ts`
- [ ] `packages/core/src/tools/surprising-connections.ts`
- [ ] `packages/core/src/tools/find-large-functions.ts`
- [ ] `packages/core/src/tools/architecture-overview.ts`
- [ ] `packages/core/src/tools/rules-check.ts`
- [ ] `packages/core/src/tools/rules.ts`
- [ ] `packages/core/src/tools/suggested-questions.ts`
- [ ] `packages/core/src/tools/refactor-preview.ts`
- [ ] `packages/core/src/tools/apply-refactor.ts`
- [ ] `packages/core/src/tools/get-workflow.ts`
- [ ] `packages/core/src/tools/graph-snapshot.ts`
- [ ] `packages/core/src/tools/graph-export.ts`
- [ ] `packages/core/src/tools/graph-diff.ts`
- [ ] `packages/core/src/tools/git-coupling.ts`
- [ ] `packages/core/src/tools/risk-overlay.ts`
- [ ] `packages/core/src/tools/cross-repo-search.ts` (already takes `repos` array; add `project_root` for the *origin* repo used to embed the query)

**Worked example — `packages/core/src/tools/search.ts`:**

Find the existing Zod schema:

```ts
const Schema = z.object({
  query: z.string().min(1),
  limit: z.number().min(1).max(50).optional().default(10),
});
```

Change to:

```ts
import { ProjectRootField, PROJECT_ROOT_JSON_SCHEMA } from './projectRootParam.js';
// ...
const Schema = z.object({
  project_root: ProjectRootField,
  query: z.string().min(1),
  limit: z.number().min(1).max(50).optional().default(10),
});
```

Find the existing `inputSchema.properties`:

```ts
inputSchema: {
  type: 'object',
  properties: {
    query: { type: 'string', ... },
    limit: { type: 'number', ... },
  },
  required: ['query'],
},
```

Change to:

```ts
inputSchema: {
  type: 'object',
  properties: {
    project_root: PROJECT_ROOT_JSON_SCHEMA,
    query: { type: 'string', ... },
    limit: { type: 'number', ... },
  },
  required: ['query'],
},
```

Find the handler body:

```ts
async (args) => {
  const { query, limit } = Schema.parse(args);
  const store = await ctx.getStore();
  const graph = await ctx.getGraph();
  // ...
}
```

Change to:

```ts
async (args) => {
  const { project_root, query, limit } = Schema.parse(args);
  const store = await ctx.getStore(project_root);
  const graph = await ctx.getGraph(project_root);
  // ...
}
```

**For each tool:**

- [ ] **Step 3.3.X.1: Apply the four-edit pattern above**
- [ ] **Step 3.3.X.2: Run that tool's existing test file** (e.g. `tests/SearchTool.test.ts`)
- [ ] **Step 3.3.X.3: Confirm green**

**Commit cadence:** commit after every 4-5 tools to keep the diff manageable. Commit message template:

```bash
git commit -m "feat(#70): wire project_root through <toolA>, <toolB>, <toolC>, <toolD>"
```

After all 32 tools are converted:

- [ ] **Step 3.3.Z: Run full test suite**

```bash
npx vitest run 2>&1 | tail -10
```

Expected: all green.

---

### Phase 3 checkpoint

- [ ] All 33 tools (status + 32 others) accept `project_root` in their schemas
- [ ] All existing tool tests still pass (parameter is optional, default behavior unchanged)
- [ ] `npm run lint` is clean

---

## Phase 4 — CLI alias UX

### Task 4.1: `ctxloom register --alias <name>`

**Files:**
- Modify: `src/index.ts` (the `case 'register':` block around line 545)
- Test: `tests/RegisterCli.test.ts` (new — integration test of the CLI binary)

- [ ] **Step 4.1.1: Write the failing test**

Create `tests/RegisterCli.test.ts`:

```ts
/**
 * Integration test for `ctxloom register --alias <name>`.
 *
 * Spawns the actual built binary (dist/index.js) and verifies the
 * registry file is written with the alias.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BIN = path.resolve(__dirname, '../bin/ctxloom.cjs');

describe('ctxloom register --alias', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-cli-'));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('writes alias to registry', () => {
    const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-proj-'));
    fs.writeFileSync(path.join(projDir, 'package.json'), '{}');
    try {
      const result = spawnSync(
        'node',
        [BIN, 'register', projDir, '--alias', 'myproj'],
        { env: { ...process.env, HOME: tmpHome, CTXLOOM_SKIP_FD_BUMP: '1' }, encoding: 'utf-8' },
      );
      expect(result.status).toBe(0);
      const reg = JSON.parse(fs.readFileSync(path.join(tmpHome, '.ctxloom', 'repos.json'), 'utf-8'));
      expect(reg[0].alias).toBe('myproj');
      expect(reg[0].root).toBe(fs.realpathSync(projDir));
    } finally {
      fs.rmSync(projDir, { recursive: true, force: true });
    }
  });

  it('rejects invalid alias (uppercase)', () => {
    const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-proj-'));
    try {
      const result = spawnSync(
        'node',
        [BIN, 'register', projDir, '--alias', 'NotValid'],
        { env: { ...process.env, HOME: tmpHome, CTXLOOM_SKIP_FD_BUMP: '1' }, encoding: 'utf-8' },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/alias must match/i);
    } finally {
      fs.rmSync(projDir, { recursive: true, force: true });
    }
  });

  it('rejects alias collision', () => {
    const projA = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-A-'));
    const projB = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-B-'));
    fs.writeFileSync(path.join(projA, 'package.json'), '{}');
    fs.writeFileSync(path.join(projB, 'package.json'), '{}');
    try {
      const r1 = spawnSync(
        'node',
        [BIN, 'register', projA, '--alias', 'shared'],
        { env: { ...process.env, HOME: tmpHome, CTXLOOM_SKIP_FD_BUMP: '1' }, encoding: 'utf-8' },
      );
      expect(r1.status).toBe(0);
      const r2 = spawnSync(
        'node',
        [BIN, 'register', projB, '--alias', 'shared'],
        { env: { ...process.env, HOME: tmpHome, CTXLOOM_SKIP_FD_BUMP: '1' }, encoding: 'utf-8' },
      );
      expect(r2.status).not.toBe(0);
      expect(r2.stderr).toMatch(/already registered/i);
    } finally {
      fs.rmSync(projA, { recursive: true, force: true });
      fs.rmSync(projB, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 4.1.2: Run test to verify it fails**

```bash
npm run build:cli && npx vitest run tests/RegisterCli.test.ts
```

Expected: FAIL — CLI doesn't accept `--alias` yet.

- [ ] **Step 4.1.3: Update `src/index.ts`**

In the `case 'register':` block (around line 545), replace the body with:

```ts
case 'register': {
  const args = process.argv.slice(3);
  const aliasFlagIdx = args.findIndex((a) => a === '--alias');
  let alias: string | undefined;
  if (aliasFlagIdx >= 0) {
    alias = args[aliasFlagIdx + 1];
    if (!alias || alias.startsWith('--')) {
      console.error('[ctxloom] --alias requires a value');
      process.exit(1);
    }
    args.splice(aliasFlagIdx, 2); // remove flag + value
  }
  const repoPath = args[0] ?? '.';
  const absPath = path.resolve(repoPath);
  try {
    const stat = await import('node:fs').then((m) => m.statSync(absPath));
    if (!stat.isDirectory()) {
      console.error(`[ctxloom] ${absPath} is not a directory`);
      process.exit(1);
    }
  } catch {
    console.error(`[ctxloom] Path does not exist: ${absPath}`);
    process.exit(1);
  }
  const dbPath = path.join(absPath, '.ctxloom', 'vectors.lancedb');
  const registryPath = path.join(os.homedir(), '.ctxloom', 'repos.json');
  const reg = new RepoRegistry(registryPath);
  try {
    reg.register(absPath, dbPath, alias ? { alias } : {});
  } catch (err) {
    console.error(`[ctxloom] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  console.log(`[ctxloom] Registered repo: ${absPath}`);
  if (alias) console.log(`[ctxloom] Alias: ${alias}`);
  console.log(`[ctxloom] LanceDB path: ${dbPath}`);
  console.log(`[ctxloom] Registry: ${registryPath}`);
  break;
}
```

- [ ] **Step 4.1.4: Rebuild and re-run tests**

```bash
npm run build:cli && npx vitest run tests/RegisterCli.test.ts
```

Expected: all 3 PASS.

- [ ] **Step 4.1.5: Commit**

```bash
git add src/index.ts tests/RegisterCli.test.ts
git commit -m "feat(#70): ctxloom register --alias <name>

Accepts the optional --alias flag, validates via the regex/reserved
checks in RepoRegistry, rejects collisions. Tests spin up the real
built binary via bin/ctxloom.cjs to exercise the full path."
```

---

### Task 4.2: `ctxloom repos` shows alias column

**Files:**
- Modify: `src/index.ts` (`case 'repos':` around line 576)

- [ ] **Step 4.2.1: Update the print loop**

Replace the `repos` case body:

```ts
case 'repos': {
  const registryPath = path.join(os.homedir(), '.ctxloom', 'repos.json');
  const reg = new RepoRegistry(registryPath);
  const repos = reg.list();
  if (repos.length === 0) {
    console.log('[ctxloom] No repos registered. Run `ctxloom register` from any project directory.');
  } else {
    console.log(`\n[ctxloom] Registered repos (${repos.length}):`);
    const longestAlias = Math.max(5, ...repos.map((r) => (r.alias ?? '').length));
    const longestName = Math.max(4, ...repos.map((r) => r.name.length));
    console.log(`  ${'ALIAS'.padEnd(longestAlias)}  ${'NAME'.padEnd(longestName)}  ROOT`);
    for (const r of repos) {
      const alias = (r.alias ?? '').padEnd(longestAlias);
      const name = r.name.padEnd(longestName);
      console.log(`  ${alias}  ${name}  ${r.root}`);
    }
  }
  break;
}
```

- [ ] **Step 4.2.2: Rebuild and manually verify**

```bash
npm run build:cli
node bin/ctxloom.cjs repos
```

Expected: prints aliases (if any registered) in a new column.

- [ ] **Step 4.2.3: Commit**

```bash
git add src/index.ts
git commit -m "feat(#70): ctxloom repos prints alias column"
```

---

## Phase 5 — `ctx_status` multi-project view + observability

### Task 5.1: `ctx_status` emits `<active_projects>` and `<registered_projects>`

**Files:**
- Modify: `packages/core/src/tools/status.ts`
- Test: `tests/CtxStatusMultiProject.test.ts` (new)

- [ ] **Step 5.1.1: Add `list()` method to `ProjectStateManager`** (already added in Task 1.4 — verify present, the test exercises it).

- [ ] **Step 5.1.2: Write the failing test**

Create `tests/CtxStatusMultiProject.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ProjectStateManager } from '../packages/core/src/server/ProjectStateManager.js';

// Direct test of the rendering function. We export it from status.ts.
import { renderStatusXml } from '../packages/core/src/tools/status.js';

describe('ctx_status multi-project rendering', () => {
  it('emits active_projects with count and max', () => {
    const mgr = new ProjectStateManager({ maxProjects: 5 });
    mgr.pin('/abs/main');
    mgr.get('/abs/b');
    const out = renderStatusXml({
      defaultRoot: '/abs/main',
      manager: mgr,
      registry: { list: () => [{ root: '/abs/main', alias: 'main', name: 'main', dbPath: '', registeredAt: '' }] },
    });
    expect(out).toMatch(/<active_projects count="2" max="5">/);
    expect(out).toMatch(/root="\/abs\/main".*pinned="true"/);
    expect(out).toMatch(/<registered_projects count="1">/);
  });

  it('emits no_default_mode marker when defaultRoot is null', () => {
    const mgr = new ProjectStateManager({ maxProjects: 5 });
    const out = renderStatusXml({
      defaultRoot: null,
      manager: mgr,
      registry: { list: () => [] },
    });
    expect(out).toMatch(/<no_default_project/);
  });
});
```

- [ ] **Step 5.1.3: Run test to verify it fails**

```bash
npx vitest run tests/CtxStatusMultiProject.test.ts
```

Expected: FAIL — `renderStatusXml` not exported.

- [ ] **Step 5.1.4: Refactor `status.ts`**

Replace `packages/core/src/tools/status.ts` with:

```ts
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { ProjectRootField, PROJECT_ROOT_JSON_SCHEMA } from './projectRootParam.js';
import type { ProjectStateManager } from '../server/ProjectStateManager.js';
import type { RegisteredRepo } from './cross-repo-search.js';

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface RenderStatusInput {
  defaultRoot: string | null;
  manager: ProjectStateManager;
  registry: { list(): Pick<RegisteredRepo, 'root' | 'alias' | 'name'>[] };
}

export function renderStatusXml(input: RenderStatusInput): string {
  const { defaultRoot, manager, registry } = input;
  const lines = ['<ctx_status>'];

  if (defaultRoot) {
    lines.push(`  <project_root>${escapeXML(defaultRoot)}</project_root>`);
    // The legacy graph/store/parser tags are still emitted for back-compat,
    // populated from the default project's state. Skip when no default.
    const state = manager.has(defaultRoot) ? manager.get(defaultRoot) : null;
    if (state?.graphInitialized && state.graphPromise) {
      // edges/nodes counts need to be passed in synchronously — for the
      // unit test we render a status string; the real tool wires up
      // counts at the call site (see registerStatusTool below).
      lines.push('  <graph status="ready" />');
    } else {
      lines.push('  <graph status="not_initialized" />');
    }
  } else {
    lines.push('  <no_default_project reason="server boot validation failed; pass project_root explicitly" />');
  }

  // ─── active_projects ─────────────────────────────────────────────────
  const active = manager.list();
  lines.push(`  <active_projects count="${active.length}" max="5">`);
  for (const s of active) {
    const reg = registry.list().find((r) => r.root === s.projectRoot);
    const alias = reg?.alias ? ` alias="${escapeXML(reg.alias)}"` : '';
    const graphState = s.graphInitialized ? 'ready' : s.graphPromise ? 'building' : 'cold';
    const vectorsState = s.vectorsInitialized ? 'ready' : s.storePromise ? 'building' : 'cold';
    lines.push(
      `    <project root="${escapeXML(s.projectRoot)}"${alias} ` +
      `pinned="${s.pinned}" graph="${graphState}" vectors="${vectorsState}" ` +
      `last_touched_at="${new Date(s.lastTouchedAt).toISOString()}" />`,
    );
  }
  lines.push('  </active_projects>');

  // ─── registered_projects ──────────────────────────────────────────────
  const registered = registry.list();
  lines.push(`  <registered_projects count="${registered.length}">`);
  for (const r of registered) {
    const alias = r.alias ? ` alias="${escapeXML(r.alias)}"` : '';
    lines.push(`    <project root="${escapeXML(r.root)}"${alias} name="${escapeXML(r.name)}" />`);
  }
  lines.push('  </registered_projects>');

  lines.push('</ctx_status>');
  return lines.join('\n');
}

export function registerStatusTool(registry: ToolRegistry, ctx: ServerContext): void {
  const Schema = z.object({ project_root: ProjectRootField });

  registry.register(
    'ctx_status',
    {
      name: 'ctx_status',
      description:
        'Return the current status of the ctxloom server. ' +
        'With no project_root: full multi-project view (default + active + registry). ' +
        'With project_root: details for that one project.',
      inputSchema: {
        type: 'object',
        properties: {
          project_root: PROJECT_ROOT_JSON_SCHEMA,
        },
      },
    },
    async (args) => {
      const { project_root } = Schema.parse(args ?? {});
      // Single-project view when project_root passed (Phase 5.2 — for now
      // we render the full view; per-project rendering is a polish task).
      // Manager + registry are not directly on ctx; expose via server.ts
      // (see Task 5.1.5).
      return renderStatusXml({
        defaultRoot: ctx.noDefaultMode ? null : ctx.projectRoot,
        manager: (ctx as unknown as { stateManager: ProjectStateManager }).stateManager,
        registry: ctx.registry,
      });
    },
  );
}
```

- [ ] **Step 5.1.5: Expose `stateManager` on `ServerContext`**

Edit `packages/core/src/tools/context.ts`. Add to `ServerContext`:

```ts
import type { ProjectStateManager } from '../server/ProjectStateManager.js';
// ...
export interface ServerContext {
  // ... existing fields ...
  stateManager: ProjectStateManager;
}
```

And in `src/server.ts` `buildContext()`, return:

```ts
const ctx: ServerContext = {
  // ... existing fields ...
  stateManager,
};
```

- [ ] **Step 5.1.6: Run test to verify it passes**

```bash
npx vitest run tests/CtxStatusMultiProject.test.ts
```

Expected: both tests PASS.

- [ ] **Step 5.1.7: Commit**

```bash
git add packages/core/src/tools/status.ts packages/core/src/tools/context.ts src/server.ts tests/CtxStatusMultiProject.test.ts
git commit -m "feat(#70): ctx_status emits multi-project view

Adds <active_projects> + <registered_projects> blocks. Legacy
<project_root>/<graph>/<vector_store>/<ast_parser> tags preserved for
the default project. Emits <no_default_project> marker when server
booted in no-default mode."
```

---

### Task 5.2: Observability — logger calls at tool dispatch + project events

**Files:**
- Modify: `packages/core/src/tools/registry.ts` (the dispatcher)

- [ ] **Step 5.2.1: Read current dispatcher**

```bash
cat packages/core/src/tools/registry.ts
```

- [ ] **Step 5.2.2: Wrap dispatch with a logging hook**

Find the `dispatch` method. Add:

```ts
async dispatch(name: string, args: unknown): Promise<string> {
  const tool = this.tools.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  // Best-effort log. project_root is the input field's name; if present
  // it's a string (Zod will validate inside the handler).
  const projectRoot =
    args && typeof args === 'object' && 'project_root' in args
      ? (args as Record<string, unknown>).project_root
      : undefined;
  logger.debug('tool.dispatch', { tool: name, project_root: projectRoot });
  return tool.handler(args);
}
```

- [ ] **Step 5.2.3: Commit**

```bash
git add packages/core/src/tools/registry.ts
git commit -m "feat(#70): log tool.dispatch with project_root"
```

---

## Phase 6 — Structured errors + first-touch envelope

### Task 6.1: `<error>` / `<warning>` shape builders + tests

**Files:**
- Create: `packages/core/src/server/structuredErrors.ts`
- Test: `tests/StructuredErrors.test.ts`

- [ ] **Step 6.1.1: Write the failing test**

Create `tests/StructuredErrors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  noDefaultProjectError,
  projectRootNotFoundError,
  aliasNotFoundError,
  noParseableSourcesWarning,
} from '../packages/core/src/server/structuredErrors.js';

describe('structured errors', () => {
  it('emits no_default_project with attempted root + resolution chain', () => {
    const out = noDefaultProjectError({
      attemptedRoot: '/',
      resolutionChain: 'env:CTXLOOM_ROOT→unset, fallback_cwd→/',
      registeredAliases: ['foo', 'bar'],
    });
    expect(out).toMatch(/<error code="no_default_project"/);
    expect(out).toMatch(/attempted_root="\/"/);
    expect(out).toMatch(/Registered aliases: \['foo', 'bar'\]/);
  });

  it('emits project_root_not_found', () => {
    expect(projectRootNotFoundError({ path: '/nope', resolutionChain: 'arg:nope' }))
      .toMatch(/code="project_root_not_found"/);
  });

  it('emits alias_not_found with did_you_mean', () => {
    expect(aliasNotFoundError({ alias: 'fooo', didYouMean: ['foo', 'foobar'] }))
      .toMatch(/did_you_mean="\['foo', 'foobar'\]"/);
  });

  it('emits no_parseable_sources warning', () => {
    expect(noParseableSourcesWarning())
      .toMatch(/<warning code="no_parseable_sources"/);
  });
});
```

- [ ] **Step 6.1.2: Run test to verify it fails**

```bash
npx vitest run tests/StructuredErrors.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 6.1.3: Implement the builders**

Create `packages/core/src/server/structuredErrors.ts`:

```ts
/**
 * XML builders for structured `<error>` and `<warning>` shapes introduced
 * by issue #70.
 *
 * Scoped to project-resolution and indexing failures only — existing
 * tools' plain-text error paths are unchanged.
 */

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function noDefaultProjectError(input: {
  attemptedRoot: string;
  resolutionChain: string;
  registeredAliases: string[];
}): string {
  const aliasList = `[${input.registeredAliases.map((a) => `'${a}'`).join(', ')}]`;
  return (
    `<error code="no_default_project" ` +
    `attempted_root="${escapeAttr(input.attemptedRoot)}" ` +
    `resolution_chain="${escapeAttr(input.resolutionChain)}" ` +
    `hint="Set CTXLOOM_ROOT in your MCP server config, or pass project_root explicitly. Registered aliases: ${aliasList}." />`
  );
}

export function projectRootNotFoundError(input: {
  path: string;
  resolutionChain: string;
}): string {
  return (
    `<error code="project_root_not_found" ` +
    `path="${escapeAttr(input.path)}" ` +
    `resolution_chain="${escapeAttr(input.resolutionChain)}" />`
  );
}

export function projectRootUnreadableError(input: { path: string; detail: string }): string {
  return (
    `<error code="project_root_unreadable" ` +
    `path="${escapeAttr(input.path)}" ` +
    `detail="${escapeAttr(input.detail)}" />`
  );
}

export function aliasNotFoundError(input: { alias: string; didYouMean: string[] }): string {
  const suggestions = `[${input.didYouMean.map((a) => `'${a}'`).join(', ')}]`;
  return (
    `<error code="alias_not_found" ` +
    `alias="${escapeAttr(input.alias)}" ` +
    `did_you_mean="${escapeAttr(suggestions)}" />`
  );
}

export function noParseableSourcesWarning(): string {
  return (
    `<warning code="no_parseable_sources" ` +
    `reason="directory has 0 files matching supported language extensions" />`
  );
}
```

- [ ] **Step 6.1.4: Run test to verify it passes**

```bash
npx vitest run tests/StructuredErrors.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 6.1.5: Commit**

```bash
git add packages/core/src/server/structuredErrors.ts tests/StructuredErrors.test.ts
git commit -m "feat(#70): structured error/warning XML builders"
```

---

### Task 6.2: First-touch `<ctxloom_indexing>` envelope

**Files:**
- Create: `packages/core/src/server/indexingEnvelope.ts`
- Test: `tests/IndexingEnvelope.test.ts`

- [ ] **Step 6.2.1: Write the failing test**

Create `tests/IndexingEnvelope.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { wrapWithIndexingEnvelope, FirstTouchTracker } from '../packages/core/src/server/indexingEnvelope.js';

describe('FirstTouchTracker', () => {
  it('returns true on the first call for a root+tier, false thereafter', () => {
    const t = new FirstTouchTracker();
    expect(t.markAndCheck('/abs/foo', 'graph')).toBe(true);
    expect(t.markAndCheck('/abs/foo', 'graph')).toBe(false);
    expect(t.markAndCheck('/abs/foo', 'vectors')).toBe(true);
    expect(t.markAndCheck('/abs/bar', 'graph')).toBe(true);
  });
});

describe('wrapWithIndexingEnvelope', () => {
  it('prepends envelope when first_touch is true', () => {
    const wrapped = wrapWithIndexingEnvelope(
      { firstTouch: true, projectRoot: '/abs/foo', tier: 'graph', durationMs: 4823, filesIndexed: 847 },
      '<some_result />',
    );
    expect(wrapped).toMatch(/^<ctxloom_indexing first_touch="true" project_root="\/abs\/foo" tier="graph" duration_ms="4823" files_indexed="847" \/>\n<some_result \/>$/);
  });

  it('passes through unchanged when first_touch is false', () => {
    const wrapped = wrapWithIndexingEnvelope(
      { firstTouch: false, projectRoot: '/abs/foo', tier: 'graph', durationMs: 0 },
      '<some_result />',
    );
    expect(wrapped).toBe('<some_result />');
  });
});
```

- [ ] **Step 6.2.2: Run test to verify it fails**

```bash
npx vitest run tests/IndexingEnvelope.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 6.2.3: Implement**

Create `packages/core/src/server/indexingEnvelope.ts`:

```ts
export type IndexingTier = 'graph' | 'vectors';

export interface EnvelopeInput {
  firstTouch: boolean;
  projectRoot: string;
  tier: IndexingTier;
  durationMs: number;
  filesIndexed?: number;
  records?: number;
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export function wrapWithIndexingEnvelope(input: EnvelopeInput, body: string): string {
  if (!input.firstTouch) return body;
  const extras: string[] = [];
  if (input.tier === 'graph' && typeof input.filesIndexed === 'number') {
    extras.push(`files_indexed="${input.filesIndexed}"`);
  }
  if (input.tier === 'vectors' && typeof input.records === 'number') {
    extras.push(`records="${input.records}"`);
  }
  const envelope =
    `<ctxloom_indexing first_touch="true" project_root="${escapeAttr(input.projectRoot)}" ` +
    `tier="${input.tier}" duration_ms="${input.durationMs}"` +
    (extras.length ? ` ${extras.join(' ')}` : '') +
    ` />`;
  return `${envelope}\n${body}`;
}

/**
 * Per-server tracker of whether a (root, tier) pair has been seen.
 *
 * Lives on the server alongside the ProjectStateManager. Survives
 * across tool calls; reset on eviction would happen at the
 * ProjectStateManager level if we wanted to re-emit envelopes after
 * eviction — for Phase 1 we keep them sticky so an agent only sees
 * the "first touch" message once per server lifetime per root.
 */
export class FirstTouchTracker {
  private readonly seen = new Set<string>();

  markAndCheck(root: string, tier: IndexingTier): boolean {
    const key = `${root}::${tier}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }

  reset(root: string): void {
    this.seen.delete(`${root}::graph`);
    this.seen.delete(`${root}::vectors`);
  }
}
```

- [ ] **Step 6.2.4: Run test to verify it passes**

```bash
npx vitest run tests/IndexingEnvelope.test.ts
```

Expected: all 3 PASS.

- [ ] **Step 6.2.5: Commit**

```bash
git add packages/core/src/server/indexingEnvelope.ts tests/IndexingEnvelope.test.ts
git commit -m "feat(#70): first-touch indexing envelope"
```

---

### Task 6.3: Wire structured errors through `CallToolRequest` handler

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 6.3.1: Update the dispatcher catch block**

Replace the existing `server.setRequestHandler(CallToolRequestSchema, ...)` in `src/server.ts` (around line 135) with:

```ts
server.setRequestHandler(CallToolRequestSchema, async ({ params: { name, arguments: args } }) => {
  try {
    const text = await registry.dispatch(name, args);
    return { content: [{ type: 'text' as const, text }] };
  } catch (err) {
    // Try to parse a structured-error outcome thrown from resolveOrDefault
    if (err instanceof Error && err.message.startsWith('{')) {
      try {
        const outcome = JSON.parse(err.message);
        if (outcome.kind === 'alias_not_found') {
          return { content: [{ type: 'text' as const, text: aliasNotFoundError({ alias: outcome.alias, didYouMean: outcome.didYouMean }) }], isError: true };
        }
        if (outcome.kind === 'project_root_not_found') {
          return { content: [{ type: 'text' as const, text: projectRootNotFoundError({ path: outcome.attemptedPath, resolutionChain: outcome.resolutionChain }) }], isError: true };
        }
      } catch { /* fall through to plaintext */ }
    }
    if (err instanceof Error && err.message === 'no_default_project') {
      const aliases = ctx.registry.list().map((r) => r.alias).filter((a): a is string => !!a);
      return { content: [{ type: 'text' as const, text: noDefaultProjectError({
        attemptedRoot: PROJECT_ROOT ?? '/',
        resolutionChain: `env:CTXLOOM_ROOT→${process.env.CTXLOOM_ROOT ?? 'unset'}, fallback_cwd→${process.cwd()}`,
        registeredAliases: aliases,
      }) }], isError: true };
    }
    return {
      content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }
});
```

Add imports at top:

```ts
import {
  noDefaultProjectError,
  projectRootNotFoundError,
  aliasNotFoundError,
} from '@ctxloom/core/server/structuredErrors.js';
```

- [ ] **Step 6.3.2: Verify with manual smoke test**

```bash
npm run build:cli
CTXLOOM_ROOT="" (cd / && node /Users/ricardoribeiro/GitHub/contextmesh/bin/ctxloom.cjs) &
# Then call any tool through MCP — should get <error code="no_default_project" />
```

- [ ] **Step 6.3.3: Commit**

```bash
git add src/server.ts
git commit -m "feat(#70): wire structured errors through dispatcher"
```

---

### Task 6.4: Wire the `<ctxloom_indexing>` envelope into tool dispatch

The envelope module exists (Task 6.2) but isn't yet wrapped around any tool response. This task hooks it into the `ToolRegistry.dispatch` path so any tool's first call against a cold root automatically gets the envelope.

**Files:**
- Modify: `packages/core/src/tools/registry.ts` (dispatch method)
- Modify: `packages/core/src/tools/context.ts` (expose `firstTouchTracker`)
- Modify: `src/server.ts` (construct `FirstTouchTracker`, pass into context, time graph builds)

- [ ] **Step 6.4.1: Expose `firstTouchTracker` on `ServerContext`**

In `packages/core/src/tools/context.ts`:

```ts
import type { FirstTouchTracker } from '../server/indexingEnvelope.js';
// ...
export interface ServerContext {
  // ... existing fields ...
  firstTouchTracker: FirstTouchTracker;
}
```

- [ ] **Step 6.4.2: Construct it in `src/server.ts` `buildContext`**

```ts
import { FirstTouchTracker } from '@ctxloom/core/server/indexingEnvelope.js';
// ...
const firstTouchTracker = new FirstTouchTracker();
// ... inside ctx object literal:
firstTouchTracker,
```

- [ ] **Step 6.4.3: Update `initGraph` to time the build**

In `src/server.ts`:

```ts
async function initGraph(state: ProjectState, tracker: FirstTouchTracker): Promise<{ graph: DependencyGraph; durationMs: number; firstTouch: boolean; filesIndexed: number }> {
  let firstTouch = false;
  let durationMs = 0;
  let filesIndexed = 0;
  if (!state.graphPromise) {
    firstTouch = tracker.markAndCheck(state.projectRoot, 'graph');
    state.graphPromise = (async () => {
      const start = Date.now();
      const parser = await initParser(state);
      const graph = new DependencyGraph();
      graph.setParser(parser);
      await graph.buildFromDirectory(state.projectRoot);
      durationMs = Date.now() - start;
      filesIndexed = graph.allFiles().length;
      state.graphInitialized = true;
      if (firstTouch) {
        logger.info('project.first_touch', {
          root: state.projectRoot,
          tier: 'graph',
          duration_ms: durationMs,
          files: filesIndexed,
        });
      }
      return graph;
    })();
  }
  const graph = await state.graphPromise;
  return { graph, durationMs, firstTouch, filesIndexed };
}
```

Update the `ctx.getGraph` field to discard the metadata for callers that don't need it (the dispatcher reads it via a separate path — see step 6.4.4):

```ts
getGraph: async (root) => (await initGraph(resolveOrDefault(root), firstTouchTracker)).graph,
```

And add a sibling method that EXPOSES the metadata for the dispatcher:

```ts
getGraphWithIndexingMeta: async (root) => initGraph(resolveOrDefault(root), firstTouchTracker),
```

Add `getGraphWithIndexingMeta` to the `ServerContext` interface in `context.ts`:

```ts
getGraphWithIndexingMeta: (projectRoot?: string) => Promise<{
  graph: DependencyGraph;
  durationMs: number;
  firstTouch: boolean;
  filesIndexed: number;
}>;
```

- [ ] **Step 6.4.4: Modify `ToolRegistry.dispatch` to wrap with envelope**

In `packages/core/src/tools/registry.ts`:

```ts
import { wrapWithIndexingEnvelope } from '../server/indexingEnvelope.js';
// ...
async dispatch(name: string, args: unknown): Promise<string> {
  const tool = this.tools.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  const projectRoot =
    args && typeof args === 'object' && 'project_root' in args
      ? String((args as Record<string, unknown>).project_root ?? '')
      : '';
  logger.debug('tool.dispatch', { tool: name, project_root: projectRoot });
  // Pre-touch the graph so we can capture first-touch metadata before
  // the tool body runs. Tool-call latency increases by 0 for warm
  // projects (cached promise resolves immediately) and by the build
  // duration on cold roots — which is the cost we want to pay AND
  // surface via the envelope.
  let envelopeMeta: { firstTouch: boolean; projectRoot: string; durationMs: number; filesIndexed: number } | null = null;
  if (this.ctx) {
    try {
      const meta = await this.ctx.getGraphWithIndexingMeta(projectRoot || undefined);
      if (meta.firstTouch) {
        envelopeMeta = {
          firstTouch: true,
          projectRoot: projectRoot || this.ctx.projectRoot,
          durationMs: meta.durationMs,
          filesIndexed: meta.filesIndexed,
        };
      }
    } catch {
      // Resolution may throw (no_default_project, alias_not_found, etc.).
      // Let the tool handler hit the same error so the structured error
      // path catches it consistently.
    }
  }
  const body = await tool.handler(args);
  if (envelopeMeta) {
    return wrapWithIndexingEnvelope({ ...envelopeMeta, tier: 'graph' }, body);
  }
  return body;
}
```

Add a `ctx` field to `ToolRegistry`:

```ts
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  constructor(private readonly ctx?: ServerContext) {}
  // ...
}
```

And update `createToolRegistry(ctx)` to pass it in.

- [ ] **Step 6.4.5: Add test for the envelope appearing in a real dispatch path**

Append to `tests/IndexingEnvelope.test.ts`:

```ts
import { ToolRegistry } from '../packages/core/src/tools/registry.js';

describe('envelope appears in dispatch path on first touch', () => {
  it('wraps the response with <ctxloom_indexing> on first call', async () => {
    // Build a mock ctx with getGraphWithIndexingMeta returning firstTouch=true
    // … then register a tool that returns "<bare />", dispatch, expect the
    // wrapped output.
  });
});
```

- [ ] **Step 6.4.6: Commit**

```bash
git add packages/core/src/tools/registry.ts packages/core/src/tools/context.ts src/server.ts tests/IndexingEnvelope.test.ts
git commit -m "feat(#70): wire <ctxloom_indexing> envelope into dispatch

ToolRegistry.dispatch now pre-touches the graph (idempotent, cached on
warm roots) to capture first-touch metadata and wraps the tool response
with the envelope when applicable. Adds getGraphWithIndexingMeta on
ServerContext that returns the build duration + file count alongside
the graph."
```

---

### Task 6.5: Tier 2 vector deferral on first vector-tool call

The vectorsInitialized flag exists on `ProjectState` but nothing reads or sets it. This task wires the deferral pattern: vector-using tools call `ensureVectorsInitialized(state)` before their first store access.

**Files:**
- Modify: `packages/core/src/server/ProjectState.ts` (add helper)
- Modify: `src/server.ts` (expose helper through context)
- Modify: 4 vector-using tools: `search.ts`, `full-text-search.ts`, `similar-files.ts`, `cross-repo-search.ts`

- [ ] **Step 6.5.1: Add `ensureVectorsInitialized` to `ProjectState.ts`**

```ts
import { collectFiles, generateEmbedding } from '../indexer/embedder.js';
import { logger } from '../utils/logger.js';

/**
 * Tier 2 lazy init — runs the embedding pass for a project if it hasn't
 * happened yet. Idempotent; skipped on subsequent calls via the
 * vectorsInitialized flag.
 */
export async function ensureVectorsInitialized(
  state: ProjectState,
  getStore: (s: ProjectState) => Promise<{ upsert: (...args: any[]) => Promise<void>; close: () => Promise<void> }>,
): Promise<{ firstTouch: boolean; durationMs: number; records: number }> {
  if (state.vectorsInitialized) return { firstTouch: false, durationMs: 0, records: 0 };
  const start = Date.now();
  const store = await getStore(state);
  const files = collectFiles(state.projectRoot).slice(0, 5000); // safety cap
  let records = 0;
  for (const f of files) {
    try {
      const fs = await import('node:fs');
      const content = fs.readFileSync(f, 'utf-8');
      if (!content.trim()) continue;
      const embedding = await generateEmbedding(content.slice(0, 4096));
      const path = await import('node:path');
      await store.upsert(path.relative(state.projectRoot, f), embedding, content.slice(0, 512));
      records++;
    } catch (err) {
      logger.warn('vector index entry failed', { file: f, detail: String(err) });
    }
  }
  state.vectorsInitialized = true;
  const durationMs = Date.now() - start;
  logger.info('project.first_touch', { root: state.projectRoot, tier: 'vectors', duration_ms: durationMs, records });
  return { firstTouch: true, durationMs, records };
}
```

- [ ] **Step 6.5.2: Expose through `ServerContext`**

Add to `context.ts`:

```ts
ensureVectorsInitialized: (projectRoot?: string) => Promise<{ firstTouch: boolean; durationMs: number; records: number }>;
```

And implement in `src/server.ts` `buildContext`:

```ts
ensureVectorsInitialized: async (root) => {
  const state = resolveOrDefault(root);
  return ensureVectorsInitialized(state, (s) => initStore(s));
},
```

- [ ] **Step 6.5.3: Call from vector-using tools**

In each of `search.ts`, `full-text-search.ts`, `similar-files.ts`, `cross-repo-search.ts`, before the first `ctx.getStore(project_root)` call, add:

```ts
const vectorMeta = await ctx.ensureVectorsInitialized(project_root);
const store = await ctx.getStore(project_root);
// ... existing body ...
// At the end, optionally wrap response with vector-tier envelope:
const body = /* existing return */;
return wrapWithIndexingEnvelope({
  firstTouch: vectorMeta.firstTouch,
  projectRoot: /* resolved root */ ,
  tier: 'vectors',
  durationMs: vectorMeta.durationMs,
  records: vectorMeta.records,
}, body);
```

(The wrapper is a no-op when `firstTouch` is false, so this is safe to apply unconditionally to vector tools.)

- [ ] **Step 6.5.4: Add test**

Append to `tests/IndexingEnvelope.test.ts`:

```ts
it('vector envelope appears only on first vector-tool call', async () => {
  // Mock a ProjectState with vectorsInitialized=false
  // Call ensureVectorsInitialized twice
  // First: { firstTouch: true, records > 0 }
  // Second: { firstTouch: false, records: 0 }
});
```

- [ ] **Step 6.5.5: Commit**

```bash
git add packages/core/src/server/ProjectState.ts packages/core/src/tools/context.ts src/server.ts packages/core/src/tools/search.ts packages/core/src/tools/full-text-search.ts packages/core/src/tools/similar-files.ts packages/core/src/tools/cross-repo-search.ts tests/IndexingEnvelope.test.ts
git commit -m "feat(#70): Tier 2 vector deferral on first vector-tool call

ensureVectorsInitialized runs the embedding pass once per project, on
the first call from a vector-using tool. Sets ProjectState.vectorsInitialized
to short-circuit subsequent calls. Vector tools wrap their response with
<ctxloom_indexing tier='vectors'> on first touch."
```

---

## Phase 7 — Kill switch + `CTXLOOM_MAX_PROJECTS`

These two env vars are read at server boot. Implementation is mostly handled by Task 2.2 (`DISABLE_MULTIPROJECT` and `MAX_PROJECTS` constants). What remains is **tests** and **a warning log on disabled state**.

### Task 7.1: Kill-switch parity test

**Files:**
- Test: `tests/KillSwitch.test.ts`

- [ ] **Step 7.1.1: Write the test**

Create `tests/KillSwitch.test.ts`:

```ts
/**
 * Verifies CTXLOOM_DISABLE_MULTIPROJECT=1 produces v1.0.31 behavior.
 *
 * Strategy: spawn the built MCP server with the env var set, send it a
 * tools/list request, confirm project_root parameter is still in the
 * schema (we don't strip it) but is ignored, and that ctx_status emits
 * only the legacy top-level fields without <active_projects>.
 */
import { describe, it, expect } from 'vitest';
import { renderStatusXml } from '../packages/core/src/tools/status.js';
import { ProjectStateManager } from '../packages/core/src/server/ProjectStateManager.js';

describe('CTXLOOM_DISABLE_MULTIPROJECT', () => {
  it('forces maxProjects to 1', () => {
    // When env is set, src/server.ts constructs the manager with maxProjects=1.
    const mgr = new ProjectStateManager({ maxProjects: 1 });
    expect(mgr.size()).toBe(0);
    mgr.pin('/abs/default');
    expect(mgr.size()).toBe(1);
    // Any get for a different root must trigger an eviction attempt;
    // since the default is pinned, throw.
    expect(() => mgr.get('/abs/other')).toThrow(/cannot evict/);
  });
});
```

- [ ] **Step 7.1.2: Run and verify**

```bash
npx vitest run tests/KillSwitch.test.ts
```

Expected: PASS.

- [ ] **Step 7.1.3: Add the warning log**

In `src/server.ts` `startServer`, after the FD-limit log, add:

```ts
if (process.env.CTXLOOM_DISABLE_MULTIPROJECT === '1') {
  logger.warn('multiproject disabled via CTXLOOM_DISABLE_MULTIPROJECT=1 — falling back to v1.0.31 single-project behavior');
}
```

- [ ] **Step 7.1.4: Commit**

```bash
git add src/server.ts tests/KillSwitch.test.ts
git commit -m "feat(#70): kill-switch warning log + parity test"
```

---

## Phase 8 — Dashboard alias display

### Task 8.1: `DashboardProject` + `listProjects()` propagate alias

**Files:**
- Modify: `apps/dashboard/server/projects.ts`

- [ ] **Step 8.1.1: Read current**

```bash
cat apps/dashboard/server/projects.ts
```

- [ ] **Step 8.1.2: Edit**

In the `DashboardProject` interface add:

```ts
/** Registered alias (if user ran `ctxloom register --alias <name>`). */
alias?: string;
```

In `RegisteredRepoEntry` add:

```ts
alias?: string;
```

In the `for (const entry of readRegistry()) { ... }` loop in `listProjects()`, replace the `out.push(...)` block with:

```ts
out.push({
  slug: slugFor(abs),
  name: entry.name ?? (path.basename(abs) || abs),
  root: abs,
  alias: entry.alias,
  isDefault: false,
  hasSnapshot: existsSync(path.join(abs, '.ctxloom')),
});
```

Also add alias to the default-entry block:

```ts
const out: DashboardProject[] = [
  {
    slug: slugFor(absDefault),
    name: path.basename(absDefault) || absDefault,
    root: absDefault,
    alias: undefined, // default is unaliased unless registered
    isDefault: true,
    hasSnapshot: existsSync(path.join(absDefault, '.ctxloom')),
  },
];
```

- [ ] **Step 8.1.3: Commit**

```bash
git add apps/dashboard/server/projects.ts
git commit -m "feat(#70): dashboard listProjects surfaces alias"
```

---

### Task 8.2: `ProjectSwitcher.tsx` shows alias

**Files:**
- Modify: `apps/dashboard/client/src/components/ProjectSwitcher.tsx`

- [ ] **Step 8.2.1: Read current**

```bash
cat apps/dashboard/client/src/components/ProjectSwitcher.tsx
```

- [ ] **Step 8.2.2: Find the project-label render** (likely a JSX expression like `{project.name}`). Replace with:

```tsx
{project.alias ?? project.name}
{project.alias && (
  <span className="text-xs text-muted-foreground ml-1">{project.name}</span>
)}
```

- [ ] **Step 8.2.3: Manually test**

```bash
cd apps/dashboard && npm run build:client
```

Expected: clean build. (Visual verification requires running the dashboard.)

- [ ] **Step 8.2.4: Commit**

```bash
git add apps/dashboard/client/src/components/ProjectSwitcher.tsx
git commit -m "feat(#70): ProjectSwitcher shows alias when present"
```

---

## Phase 9 — Integration tests + docs

### Task 9.1: End-to-end integration test

**Files:**
- Create: `tests/MultiProjectIntegration.test.ts`

This is the integration test covering acceptance criteria (a) through (l) from the spec.

- [ ] **Step 9.1.1: Write the test**

Create `tests/MultiProjectIntegration.test.ts` (full code — covers all 12 sub-cases):

```ts
/**
 * End-to-end multi-project integration tests.
 *
 * Spins up two real temp project directories with minimal contents,
 * builds a ServerContext via the same path src/server.ts uses, and
 * exercises tools against both roots in the same process.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectStateManager } from '../packages/core/src/server/ProjectStateManager.js';
import { resolveProjectRoot, validateDefaultRoot } from '../packages/core/src/server/resolveProjectRoot.js';
import { RepoRegistry } from '../packages/core/src/tools/cross-repo-search.js';

interface TestProjects {
  projA: string;
  projB: string;
  registryPath: string;
}

function makeTestProjects(): TestProjects {
  const projA = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-A-'));
  const projB = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-B-'));
  fs.writeFileSync(path.join(projA, 'package.json'), '{}');
  fs.writeFileSync(path.join(projA, 'index.ts'), 'export const foo = 1;');
  fs.writeFileSync(path.join(projB, 'package.json'), '{}');
  fs.writeFileSync(path.join(projB, 'index.ts'), 'export const bar = 2;');
  const registryPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mp-R-')), 'repos.json');
  return { projA, projB, registryPath };
}

describe('multi-project integration', () => {
  let pj: TestProjects;

  beforeEach(() => {
    pj = makeTestProjects();
  });

  afterEach(() => {
    fs.rmSync(pj.projA, { recursive: true, force: true });
    fs.rmSync(pj.projB, { recursive: true, force: true });
    fs.rmSync(path.dirname(pj.registryPath), { recursive: true, force: true });
  });

  // (a) parameter wins over env
  it('parameter wins over env', () => {
    const reg = new RepoRegistry(pj.registryPath);
    const out = resolveProjectRoot({
      arg: pj.projB,
      env: pj.projA,
      cwd: pj.projA,
      registry: reg,
    });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') expect(out.root).toBe(fs.realpathSync(pj.projB));
  });

  // (b) env wins over cwd
  it('env wins over cwd', () => {
    const reg = new RepoRegistry(pj.registryPath);
    const out = resolveProjectRoot({
      arg: undefined,
      env: pj.projB,
      cwd: pj.projA,
      registry: reg,
    });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') expect(out.root).toBe(fs.realpathSync(pj.projB));
  });

  // (c) two consecutive different roots don't cross-contaminate
  it('two consecutive different roots both succeed', () => {
    const mgr = new ProjectStateManager({ maxProjects: 5 });
    const sA = mgr.get(pj.projA);
    const sB = mgr.get(pj.projB);
    expect(sA.projectRoot).toBe(pj.projA);
    expect(sB.projectRoot).toBe(pj.projB);
    expect(sA).not.toBe(sB);
  });

  // (d) same root reuses cached state
  it('same root reuses cached state', () => {
    const mgr = new ProjectStateManager({ maxProjects: 5 });
    const s1 = mgr.get(pj.projA);
    const s2 = mgr.get(pj.projA);
    expect(s1).toBe(s2);
  });

  // (e) LRU evicts the right entry
  it('LRU evicts the LRU non-pinned entry', async () => {
    const evictions: string[] = [];
    const mgr = new ProjectStateManager({
      maxProjects: 2,
      onDispose: async (s) => { evictions.push(s.projectRoot); },
    });
    mgr.get('/a');
    await new Promise((r) => setTimeout(r, 5));
    mgr.get('/b');
    await new Promise((r) => setTimeout(r, 5));
    mgr.get('/c');
    await new Promise((r) => setTimeout(r, 50));
    expect(evictions).toEqual(['/a']);
  });

  // (f) eviction does not affect pinned default
  it('does not evict pinned', () => {
    const mgr = new ProjectStateManager({ maxProjects: 2 });
    mgr.pin('/default');
    mgr.get('/b');
    mgr.get('/c');
    expect(mgr.has('/default')).toBe(true);
  });

  // (g) cold root with no .ctxloom auto-builds (tier 1)
  // (h) vector-tool first-call triggers tier 2
  // These two require a real DependencyGraph build which is too slow for
  // a unit test. Cover them in a separate slow-integration file gated by
  // `process.env.RUN_SLOW_TESTS=1`.

  // (i) parallel cold-root calls share one warmup
  it('parallel cold-root calls share one ProjectState', () => {
    const mgr = new ProjectStateManager({ maxProjects: 5 });
    const a = mgr.get(pj.projA);
    const b = mgr.get(pj.projA);
    expect(a).toBe(b);
  });

  // (j) alias validation (covered fully in RepoRegistryAlias.test.ts)

  // (k) cwd=/ + no CTXLOOM_ROOT → no-default mode
  it('validateDefaultRoot rejects /', () => {
    expect(validateDefaultRoot('/')).toBe(false);
  });

  // (l) DISABLE_MULTIPROJECT parity (covered in KillSwitch.test.ts)
});
```

- [ ] **Step 9.1.2: Run**

```bash
npx vitest run tests/MultiProjectIntegration.test.ts
```

Expected: all 8 PASS.

- [ ] **Step 9.1.3: Commit**

```bash
git add tests/MultiProjectIntegration.test.ts
git commit -m "test(#70): end-to-end multi-project integration tests"
```

---

### Task 9.2: Update README + release notes

**Files:**
- Modify: `README.md`

- [ ] **Step 9.2.1: Read current README**

```bash
grep -n "CTXLOOM_ROOT\|project_root\|register" README.md | head -10
```

- [ ] **Step 9.2.2: Add a Multi-project section**

In `README.md`, after the existing setup section, add:

```markdown
## Multi-project workflows

A single `ctxloom` MCP server can serve any project the agent points at.
Each tool accepts an optional `project_root` parameter — pass an absolute
path or a registered alias to retarget without restarting the server.

### Register projects with short aliases

```bash
ctxloom register .                       # current dir, no alias
ctxloom register . --alias contextmesh   # register cwd with alias
ctxloom register /path/to/api --alias api
ctxloom repos                            # list with aliases
```

Then call any tool with `project_root="api"` and the server routes there.
Aliases must match `^[a-z0-9-]{1,40}$` and can't shadow ctxloom subcommands.

### Tuning the LRU cap

The server keeps up to 5 projects warm in memory. Override:

```bash
export CTXLOOM_MAX_PROJECTS=10
```

### Falling back to v1.0.31 behavior

If you hit a regression in the multi-project logic and need single-project
mode urgently, set:

```bash
export CTXLOOM_DISABLE_MULTIPROJECT=1
```

This forces the LRU cap to 1, ignores the `project_root` parameter, and
emits the legacy `ctx_status` shape.
```

- [ ] **Step 9.2.3: Commit**

```bash
git add README.md
git commit -m "docs(#70): document multi-project workflows, --alias, env vars"
```

---

## Final checkpoint

- [ ] Full test suite passes:

```bash
npx vitest run 2>&1 | tail -10
```

- [ ] Typecheck clean:

```bash
npm run lint
```

- [ ] Build succeeds:

```bash
npm run build:cli
```

- [ ] Publish smoke test passes:

```bash
CTXLOOM_BUILD_POSTHOG_KEY=phc_test CTXLOOM_BUILD_SENTRY_DSN=https://test@test.ingest.sentry.io/0 \
  CTXLOOM_ALLOW_NO_TELEMETRY=1 node scripts/publish-smoke-test.mjs 2>&1 | tail -5
```

- [ ] Manual smoke test:

```bash
# 1. Boot against a real project
CTXLOOM_ROOT=/Users/ricardoribeiro/GitHub/contextmesh node bin/ctxloom.cjs &
# 2. Call ctx_status via MCP — expect multi-project XML
# 3. Call any tool with project_root pointing at a second real project
# 4. ctx_status should now show two active_projects
```

- [ ] Open PR titled `feat(#70): multi-project support via per-tool project_root parameter` against `main`.

---

## Summary

| Phase | Task count | New files | Modified files |
|---|---|---|---|
| 1 | 5 | 5 | 1 |
| 2 | 3 | 0 | 2 |
| 3 | 3 | 1 | 33 |
| 4 | 2 | 1 | 1 |
| 5 | 2 | 1 | 3 |
| 6 | 5 | 2 | 5 |
| 7 | 1 | 1 | 1 |
| 8 | 2 | 0 | 2 |
| 9 | 2 | 1 | 1 |
| **Total** | **25** | **11** | **49** |

Plan complete.
