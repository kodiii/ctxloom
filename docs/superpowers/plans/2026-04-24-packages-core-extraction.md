# packages/core Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract shared library code from `src/` into a private workspace package `packages/core/` so that apps (dashboard, pr-bot, future VS Code extension, Slack bot, integrations) consume it via `@ctxloom/core` with a curated public API — without publishing anything new to npm.

**Architecture:** Workspace-private package `@ctxloom/core` scaffolded first with a pass-through re-export from `src/`, apps switched to import from it, then 15 library subdirectories migrated from `src/` to `packages/core/src/` one at a time in dependency order. The published `ctxloom-pro` binary bundles core inline via `tsup noExternal: ['@ctxloom/core']`, so end users see no difference.

**Tech Stack:** TypeScript 5.7, npm workspaces, tsup, vitest, Node 20+.

**Spec:** `docs/superpowers/specs/2026-04-24-packages-core-extraction-design.md`

---

## File Structure

**Created:**

- `packages/core/package.json` — workspace package definition, `"private": true`
- `packages/core/tsconfig.json` — extends root, `rootDir: "src"`, `composite: true`
- `packages/core/src/index.ts` — public API (pass-through at first, curated in Task 22)
- `packages/mcp-client/package.json` — thin wrapper, `"private": true`
- `packages/mcp-client/tsconfig.json`
- `packages/mcp-client/src/index.ts` — `spawnServer()` and `McpClient` class
- `packages/mcp-client/tests/spawn.test.ts` — smoke test for child-process spawn
- `apps/dashboard/tests/core-import-smoke.test.ts` — smoke test for `@ctxloom/core` resolution
- `apps/pr-bot/tests/core-import-smoke.test.ts` — smoke test for `@ctxloom/core` resolution

**Modified:**

- `package.json` — `workspaces` becomes `["packages/*", "apps/*"]`, add `@ctxloom/core` as dep, tsup `noExternal` entry
- `tsconfig.json` — switch to project references, remove `rootDir: "src"` constraint on root
- `tsup.config.ts` — add `noExternal: ['@ctxloom/core']`
- `apps/dashboard/server/loader.ts:2-3` — imports switch to `@ctxloom/core`
- `apps/dashboard/tests/loader.test.ts` — imports switch to `@ctxloom/core`
- `apps/pr-bot/tests/buildReview.test.ts` — imports switch to `@ctxloom/core`
- `apps/pr-bot/tests/reviewerSuggest.test.ts` — imports switch to `@ctxloom/core`
- `src/index.ts` — its many local imports stay relative during migration; once a subdir moves, the import switches to `@ctxloom/core`
- `tests/**/*.ts` — imports updated per migrated subdirectory
- `README.md` — contributor section updated with new layout (final task)

**Moved (15 subdirectories):**

- `src/lib/` → `packages/core/src/lib/`
- `src/utils/` → `packages/core/src/utils/`
- `src/grammars/` → `packages/core/src/grammars/`
- `src/ast/` → `packages/core/src/ast/`
- `src/db/` → `packages/core/src/db/`
- `src/indexer/` → `packages/core/src/indexer/`
- `src/graph/` → `packages/core/src/graph/`
- `src/git/` → `packages/core/src/git/`
- `src/rules/` → `packages/core/src/rules/`
- `src/license/` → `packages/core/src/license/`
- `src/security/` → `packages/core/src/security/`
- `src/review/` → `packages/core/src/review/`
- `src/tools/` → `packages/core/src/tools/`
- `src/workers/` → `packages/core/src/workers/`
- `src/watcher/` → `packages/core/src/watcher/`

**Stays in `src/`:** `index.ts`, `server.ts`, `dashboard.ts`, `setup/`.

---

## Task 1: Scaffold `packages/core/` with pass-through exports

**Files:**

- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Modify: `package.json` (root — workspaces + dep)

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@ctxloom/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "lint": "tsc --noEmit"
  }
}
```

Rationale: `"private": true` stops accidental `npm publish`. `main`/`exports` point at the TypeScript source because tsup will bundle everything at the root level (via `noExternal`), and app dev uses `tsx` which resolves `.ts` files natively.

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `packages/core/src/index.ts` (pass-through stub)**

```typescript
/**
 * @ctxloom/core — shared library for all ctxloom apps.
 *
 * Phase 0.1 migration: this file starts as a pass-through re-export
 * from ../../../src/ and gets curated in Task 22.
 */

// Pass-through re-exports — replaced with curated named exports in Task 22
export * from '../../../src/graph/DependencyGraph.js';
export * from '../../../src/git/GitOverlayStore.js';
```

Note: we only need to cover the two symbols that apps actually import today (`DependencyGraph`, `GitOverlayStore`). The curated API in Task 22 will expand this.

- [ ] **Step 4: Update root `package.json` workspaces**

Change line 12-14 from:

```json
"workspaces": [
  "apps/*"
],
```

to:

```json
"workspaces": [
  "packages/*",
  "apps/*"
],
```

- [ ] **Step 5: Install workspace**

Run:
```bash
npm install
```

Expected: npm creates symlinks under `node_modules/@ctxloom/core` pointing at `packages/core`. No new packages downloaded.

- [ ] **Step 6: Verify workspace resolves**

Run:
```bash
node --input-type=module -e "import('@ctxloom/core').then(m => console.log(Object.keys(m).slice(0, 5)))"
```

Expected: prints an array of five exported symbol names (likely `DependencyGraph`, `GitOverlayStore`, etc. depending on module order). If the import throws, the workspace symlink failed.

- [ ] **Step 7: Run tests and build to confirm zero regression**

Run:
```bash
npm test && npm run build
```

Expected: tests green, `dist/` rebuilt successfully.

- [ ] **Step 8: Commit**

```bash
git add packages/core package.json package-lock.json
git commit -m "chore(packages): scaffold @ctxloom/core with pass-through exports"
```

---

## Task 2: Scaffold `packages/mcp-client/`

**Files:**

- Create: `packages/mcp-client/package.json`
- Create: `packages/mcp-client/tsconfig.json`
- Create: `packages/mcp-client/src/index.ts`

- [ ] **Step 1: Create `packages/mcp-client/package.json`**

```json
{
  "name": "@ctxloom/mcp-client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0"
  }
}
```

- [ ] **Step 2: Create `packages/mcp-client/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `packages/mcp-client/src/index.ts`**

```typescript
/**
 * @ctxloom/mcp-client — thin wrapper for apps that talk to a running
 * ctxloom MCP server over stdio (as a child process).
 *
 * Apps that can import @ctxloom/core directly (dashboard, pr-bot)
 * do not need this package. Apps that run in a different process
 * (VS Code extension, Slack bot, AI reviewer) use this.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface SpawnOpts {
  /** Working directory of the ctxloom server. Defaults to current cwd. */
  cwd?: string;
  /** Env vars merged with process.env. */
  env?: Record<string, string>;
  /** Command to spawn; defaults to `ctxloom`. */
  command?: string;
}

export async function spawnServer(opts: SpawnOpts = {}): Promise<Client> {
  const transport = new StdioClientTransport({
    command: opts.command ?? 'ctxloom',
    args: [],
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env ?? {}) } as Record<string, string>,
  });
  const client = new Client(
    { name: '@ctxloom/mcp-client', version: '0.0.0' },
    { capabilities: {} },
  );
  await client.connect(transport);
  return client;
}
```

- [ ] **Step 4: Install workspace**

Run: `npm install`

Expected: `node_modules/@ctxloom/mcp-client` symlink present.

- [ ] **Step 5: Verify type-check passes**

Run: `npm run lint -w @ctxloom/mcp-client`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp-client package.json package-lock.json
git commit -m "chore(packages): scaffold @ctxloom/mcp-client stdio client wrapper"
```

---

## Task 3: Add app smoke tests for `@ctxloom/core` resolution

**Files:**

- Create: `apps/dashboard/tests/core-import-smoke.test.ts`
- Create: `apps/pr-bot/tests/core-import-smoke.test.ts`

- [ ] **Step 1: Write failing smoke test for dashboard**

Create `apps/dashboard/tests/core-import-smoke.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DependencyGraph, GitOverlayStore } from '@ctxloom/core';

describe('@ctxloom/core public API smoke', () => {
  it('exports DependencyGraph', () => {
    expect(typeof DependencyGraph).toBe('function');
  });
  it('exports GitOverlayStore', () => {
    expect(typeof GitOverlayStore).toBe('function');
  });
});
```

- [ ] **Step 2: Run it — expect it to pass (not fail)**

Run: `npm test -w @ctxloom/dashboard -- core-import-smoke`

Expected: PASS for both assertions. (This test is a tripwire, not a TDD red-first test — the stub in Task 1 Step 3 already re-exports these.)

If FAIL: the workspace resolution is broken — fix before continuing.

- [ ] **Step 3: Write equivalent test for pr-bot**

Create `apps/pr-bot/tests/core-import-smoke.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DependencyGraph, GitOverlayStore } from '@ctxloom/core';

describe('@ctxloom/core public API smoke', () => {
  it('exports DependencyGraph', () => {
    expect(typeof DependencyGraph).toBe('function');
  });
  it('exports GitOverlayStore', () => {
    expect(typeof GitOverlayStore).toBe('function');
  });
});
```

- [ ] **Step 4: Run pr-bot smoke test**

Run: `npm test -w ctxloom-pr-bot -- core-import-smoke` (use the actual workspace name from `apps/pr-bot/package.json` if different)

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/tests/core-import-smoke.test.ts apps/pr-bot/tests/core-import-smoke.test.ts
git commit -m "test(apps): add @ctxloom/core import smoke tests"
```

---

## Task 4: Switch `apps/dashboard` to import from `@ctxloom/core`

**Files:**

- Modify: `apps/dashboard/server/loader.ts` (lines 2–3)
- Modify: `apps/dashboard/tests/loader.test.ts`

- [ ] **Step 1: Update `apps/dashboard/server/loader.ts`**

Change the top imports from:

```typescript
import path from 'node:path';
import { DependencyGraph } from '../../../src/graph/DependencyGraph.js';
import { GitOverlayStore } from '../../../src/git/GitOverlayStore.js';
```

to:

```typescript
import path from 'node:path';
import { DependencyGraph, GitOverlayStore } from '@ctxloom/core';
```

- [ ] **Step 2: Update `apps/dashboard/tests/loader.test.ts`**

Find every line matching `from '\.\./\.\./\.\./src/` and replace with `from '@ctxloom/core'`, consolidating imports. For example:

Before:
```typescript
import { GitOverlayStore } from '../../../src/git/GitOverlayStore.js';
```

After:
```typescript
import { GitOverlayStore } from '@ctxloom/core';
```

- [ ] **Step 3: Run dashboard tests**

Run:
```bash
npm test -w @ctxloom/dashboard
```

Expected: all existing dashboard tests pass, including `loader.test.ts` and `core-import-smoke.test.ts`.

- [ ] **Step 4: Build dashboard**

Run:
```bash
npm run build -w @ctxloom/dashboard
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/loader.ts apps/dashboard/tests/loader.test.ts
git commit -m "refactor(dashboard): consume @ctxloom/core instead of relative src imports"
```

---

## Task 5: Switch `apps/pr-bot` to import from `@ctxloom/core`

**Files:**

- Modify: `apps/pr-bot/tests/buildReview.test.ts`
- Modify: `apps/pr-bot/tests/reviewerSuggest.test.ts`

(If source files under `apps/pr-bot/src/` also import from `../../../src/`, update them too — verify with `grep -l "'\.\./\.\./\.\./src" apps/pr-bot/src` before committing.)

- [ ] **Step 1: Update `apps/pr-bot/tests/buildReview.test.ts`**

Replace:
```typescript
import { DependencyGraph } from '../../../src/graph/DependencyGraph.js';
```
with:
```typescript
import { DependencyGraph } from '@ctxloom/core';
```

- [ ] **Step 2: Update `apps/pr-bot/tests/reviewerSuggest.test.ts`**

Replace:
```typescript
import { GitOverlayStore } from '../../../src/git/GitOverlayStore.js';
```
with:
```typescript
import { GitOverlayStore } from '@ctxloom/core';
```

- [ ] **Step 3: Check for any other pr-bot src/ imports**

Run:
```bash
grep -rn "from '\.\./\.\./\.\./src" apps/pr-bot/src apps/pr-bot/tests 2>/dev/null | grep -v dist
```

Expected: zero matches after Steps 1 and 2. If matches remain, update each with the equivalent `@ctxloom/core` import.

- [ ] **Step 4: Run pr-bot tests**

Run: `npm test -w ctxloom-pr-bot` (use actual workspace name)

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/pr-bot
git commit -m "refactor(pr-bot): consume @ctxloom/core instead of relative src imports"
```

---

## Task 6: Move `src/lib/` into `packages/core/`

**Files:**

- Move: every file under `src/lib/` → `packages/core/src/lib/`
- Modify: `packages/core/src/index.ts` — update re-export paths
- Modify: all files in `src/` that import from `./lib/*` or `../lib/*` → switch to `@ctxloom/core`
- Modify: all files in `tests/` that import from `../src/lib/*` → switch to `@ctxloom/core` once symbols are in the public API (if not yet curated, use deep import `@ctxloom/core` via the pass-through)

Note: **`src/lib/` is chosen first** because it has the fewest inbound dependencies and introduces the least churn.

- [ ] **Step 1: Inventory lib contents**

Run:
```bash
ls src/lib/
```

Record the list — you'll reference it during grep.

- [ ] **Step 2: Check who imports from lib**

Run:
```bash
grep -rln "from '\./lib\|from '\.\./lib\|from '\.\./\.\./lib" src/ tests/ packages/core/src/ 2>/dev/null
```

Record each file. These are the files that need import updates.

- [ ] **Step 3: Create destination directory**

Run:
```bash
mkdir -p packages/core/src/lib
```

- [ ] **Step 4: Move files with `git mv`**

For each file `F` under `src/lib/`, run:
```bash
git mv src/lib/F packages/core/src/lib/F
```

Use `git mv src/lib/* packages/core/src/lib/` if shell expansion works.

- [ ] **Step 5: Update internal imports inside moved files**

Inside `packages/core/src/lib/*.ts`, any relative import to `../*` (pointing at siblings of the old `src/lib/`) is now broken. For example, if `src/lib/foo.ts` imported `../utils/bar.js`, it now needs `../utils/bar.js` (same relative path, because both are under `packages/core/src/`).

Actually, because `src/utils/` hasn't been moved yet, the import needs to reach back to `../../../src/utils/bar.js`. Update each such import.

Verify with:
```bash
npm run lint -w @ctxloom/core
```

Expected: exit 0. Fix any unresolved-import errors.

- [ ] **Step 6: Update the pass-through in `packages/core/src/index.ts`**

If any symbol from `src/lib/` was re-exported from `index.ts` for apps, change the path from `../../../src/lib/...` to `./lib/...`. (If nothing was re-exported, skip this step.)

- [ ] **Step 7: Update consumers of `src/lib/`**

For each file from Step 2, edit the import:
- Files inside `src/`: change `./lib/foo.js` or `../lib/foo.js` to `@ctxloom/core` (for symbols in the public API) OR keep the physical path if the symbol is still internal. Since at this phase we have a pass-through, prefer updating `packages/core/src/index.ts` to re-export lib's symbols, then import via `@ctxloom/core`.
- Files inside `tests/`: same logic.

Concretely: add to `packages/core/src/index.ts`:
```typescript
export * from './lib/index.js';  // or specific files if no barrel exists
```

Then in consumers:
```typescript
import { SomeSymbol } from '@ctxloom/core';
```

- [ ] **Step 8: Run tests and build**

Run:
```bash
npm test && npm run build
```

Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(core): move src/lib into packages/core"
```

---

## Task 7: Move `src/utils/` into `packages/core/`

Apply the same recipe as Task 6, but for `src/utils/`.

- [ ] **Step 1: Inventory**

Run:
```bash
ls src/utils/
grep -rln "from '\./utils\|from '\.\./utils\|from '\.\./\.\./utils" src/ tests/ packages/core/src/ 2>/dev/null
```

- [ ] **Step 2: Create dir and move**

```bash
mkdir -p packages/core/src/utils
git mv src/utils/* packages/core/src/utils/
```

- [ ] **Step 3: Fix internal imports**

Files inside `packages/core/src/utils/` that imported from siblings (e.g., `../lib/foo.js`) now point at `../lib/foo.js` correctly (both are under `packages/core/src/`). If any imported from `../somethingNotYetMoved/`, change to `../../../src/somethingNotYetMoved/...`.

Run: `npm run lint -w @ctxloom/core` — expected exit 0.

- [ ] **Step 4: Add to public API pass-through**

In `packages/core/src/index.ts`, add:
```typescript
export * from './utils/index.js';  // or specific files
```

If a barrel file doesn't exist, create `packages/core/src/utils/index.ts` that re-exports from each file in the directory.

- [ ] **Step 5: Update consumers**

For each file from Step 1's grep output, change `./utils/X.js` / `../utils/X.js` imports to `@ctxloom/core` where the symbol is now re-exported.

- [ ] **Step 6: Run tests and build**

Run: `npm test && npm run build`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(core): move src/utils into packages/core"
```

---

## Task 8: Move `src/grammars/` into `packages/core/`

**Special note:** `src/grammars/` contains WASM loader code and `grammar-manifest.ts`. The tsup build copies WASM from `node_modules/tree-sitter-*/` into `dist/wasm/` at build time — the WASM copy logic in `tsup.config.ts` references `node_modules`, not `src/grammars/`, so it is unaffected by the move.

Apply the standard recipe (Task 6 pattern) with these specifics:

- [ ] **Step 1: Inventory**

```bash
ls src/grammars/
grep -rln "from '\./grammars\|from '\.\./grammars" src/ tests/ packages/core/src/ 2>/dev/null
```

- [ ] **Step 2: Move**

```bash
mkdir -p packages/core/src/grammars
git mv src/grammars/* packages/core/src/grammars/
```

- [ ] **Step 3: Fix internal imports**

Run: `npm run lint -w @ctxloom/core` and fix any unresolved paths.

- [ ] **Step 4: Add to pass-through**

Add to `packages/core/src/index.ts`:
```typescript
export * from './grammars/index.js';
```

Create `packages/core/src/grammars/index.ts` as a barrel if missing.

- [ ] **Step 5: Update consumers**

Switch their imports to `@ctxloom/core`.

- [ ] **Step 6: Verify WASM still copies during build**

Run: `npm run build`
Expected: `dist/wasm/tree-sitter.wasm` and grammar WASM files present.

Check:
```bash
ls dist/wasm/
```

Expected: `tree-sitter.wasm`, `tree-sitter-typescript.wasm`, `tree-sitter-tsx.wasm` (at minimum).

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(core): move src/grammars into packages/core"
```

---

## Task 9: Move `src/ast/` into `packages/core/`

Standard recipe (Task 6 pattern).

- [ ] **Step 1: Inventory and grep**

```bash
ls src/ast/
grep -rln "from '\./ast\|from '\.\./ast" src/ tests/ packages/core/src/ 2>/dev/null
```

- [ ] **Step 2: Move**

```bash
mkdir -p packages/core/src/ast
git mv src/ast/* packages/core/src/ast/
```

- [ ] **Step 3: Fix internal imports**

Files in `packages/core/src/ast/` that imported `../grammars/X.js` still work (grammars moved to core in Task 8). Imports of `../db/X.js`, `../graph/X.js` etc. (not yet moved) need to become `../../../src/db/X.js` etc.

Run: `npm run lint -w @ctxloom/core` — fix unresolved paths.

- [ ] **Step 4: Add to public API pass-through**

Add to `packages/core/src/index.ts`:
```typescript
export * from './ast/index.js';
```

- [ ] **Step 5: Update consumers**

- [ ] **Step 6: Run tests and build**

Run: `npm test && npm run build`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(core): move src/ast into packages/core"
```

---

## Task 10: Move `src/db/` into `packages/core/`

Standard recipe.

- [ ] **Step 1: Inventory and grep**

```bash
ls src/db/
grep -rln "from '\./db\|from '\.\./db" src/ tests/ packages/core/src/ 2>/dev/null
```

- [ ] **Step 2: Move**

```bash
mkdir -p packages/core/src/db
git mv src/db/* packages/core/src/db/
```

- [ ] **Step 3: Fix internal imports + lint**

Run: `npm run lint -w @ctxloom/core`. Fix any unresolved paths.

- [ ] **Step 4: Public API pass-through**

Add to `packages/core/src/index.ts`:
```typescript
export * from './db/index.js';
```

- [ ] **Step 5: Update consumers**

- [ ] **Step 6: Run tests and build**

Run: `npm test && npm run build`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(core): move src/db into packages/core"
```

---

## Task 11: Move `src/indexer/` into `packages/core/`

- [ ] **Step 1: Inventory and grep**

```bash
ls src/indexer/
grep -rln "from '\./indexer\|from '\.\./indexer" src/ tests/ packages/core/src/ 2>/dev/null
```

- [ ] **Step 2: Move**

```bash
mkdir -p packages/core/src/indexer
git mv src/indexer/* packages/core/src/indexer/
```

- [ ] **Step 3: Lint + fix**

Run: `npm run lint -w @ctxloom/core`

- [ ] **Step 4: Pass-through**

Add to `packages/core/src/index.ts`:
```typescript
export * from './indexer/index.js';
```

- [ ] **Step 5: Update consumers**

- [ ] **Step 6: Tests + build**

Run: `npm test && npm run build`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(core): move src/indexer into packages/core"
```

---

## Task 12: Move `src/graph/` into `packages/core/`

**Important:** The pass-through `packages/core/src/index.ts` already has `export * from '../../../src/graph/DependencyGraph.js'`. This line gets replaced in Step 4 below.

- [ ] **Step 1: Inventory and grep**

```bash
ls src/graph/
grep -rln "from '\./graph\|from '\.\./graph" src/ tests/ packages/core/src/ 2>/dev/null
```

- [ ] **Step 2: Move**

```bash
mkdir -p packages/core/src/graph
git mv src/graph/* packages/core/src/graph/
```

- [ ] **Step 3: Lint + fix**

Run: `npm run lint -w @ctxloom/core`

- [ ] **Step 4: Update pass-through**

Edit `packages/core/src/index.ts`. Replace:
```typescript
export * from '../../../src/graph/DependencyGraph.js';
```
with:
```typescript
export * from './graph/DependencyGraph.js';
```

Also add (if barrel file present):
```typescript
export * from './graph/index.js';
```

- [ ] **Step 5: Update consumers**

Any `src/*.ts` or `tests/*.ts` file importing `from './graph/X.js'` or `from '../graph/X.js'` now switches to `@ctxloom/core`.

- [ ] **Step 6: Tests + build**

Run: `npm test && npm run build`
Expected: green. The dashboard and pr-bot smoke tests should still pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(core): move src/graph into packages/core"
```

---

## Task 13: Move `src/git/` into `packages/core/`

**Important:** Pass-through includes `GitOverlayStore`. Line gets replaced below.

- [ ] **Step 1: Inventory and grep**

```bash
ls src/git/
grep -rln "from '\./git\|from '\.\./git" src/ tests/ packages/core/src/ 2>/dev/null
```

- [ ] **Step 2: Move**

```bash
mkdir -p packages/core/src/git
git mv src/git/* packages/core/src/git/
```

- [ ] **Step 3: Lint + fix**

Run: `npm run lint -w @ctxloom/core`

- [ ] **Step 4: Update pass-through**

Edit `packages/core/src/index.ts`. Replace:
```typescript
export * from '../../../src/git/GitOverlayStore.js';
```
with:
```typescript
export * from './git/GitOverlayStore.js';
```

Add barrel:
```typescript
export * from './git/index.js';
```

- [ ] **Step 5: Update consumers**

- [ ] **Step 6: Tests + build**

Run: `npm test && npm run build`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(core): move src/git into packages/core"
```

---

## Task 14: Move `src/rules/` into `packages/core/`

Standard recipe.

- [ ] **Step 1-7: Standard move recipe** (see Task 6 for full detail)

```bash
# Step 1
ls src/rules/
grep -rln "from '\./rules\|from '\.\./rules" src/ tests/ packages/core/src/ 2>/dev/null

# Step 2
mkdir -p packages/core/src/rules
git mv src/rules/* packages/core/src/rules/

# Step 3
npm run lint -w @ctxloom/core

# Step 4: add `export * from './rules/index.js';` to packages/core/src/index.ts

# Step 5: update consumers

# Step 6
npm test && npm run build

# Step 7
git add -A
git commit -m "refactor(core): move src/rules into packages/core"
```

---

## Task 15: Move `src/license/` into `packages/core/`

Standard recipe.

- [ ] **Step 1-7: Standard move recipe**

```bash
# Step 1
ls src/license/
grep -rln "from '\./license\|from '\.\./license" src/ tests/ packages/core/src/ 2>/dev/null

# Step 2
mkdir -p packages/core/src/license
git mv src/license/* packages/core/src/license/

# Step 3
npm run lint -w @ctxloom/core

# Step 4: add `export * from './license/index.js';` to packages/core/src/index.ts

# Step 5: update consumers

# Step 6
npm test && npm run build

# Step 7
git add -A
git commit -m "refactor(core): move src/license into packages/core"
```

**Note on `src/index.ts`:** the root CLI imports many symbols from `./license/index.js`. After this task, those become `from '@ctxloom/core'`.

---

## Task 16: Move `src/security/` into `packages/core/`

- [ ] **Step 1-7: Standard recipe**

```bash
ls src/security/
grep -rln "from '\./security\|from '\.\./security" src/ tests/ packages/core/src/ 2>/dev/null

mkdir -p packages/core/src/security
git mv src/security/* packages/core/src/security/

npm run lint -w @ctxloom/core
# Add `export * from './security/index.js';` to packages/core/src/index.ts
# Update consumers
npm test && npm run build

git add -A
git commit -m "refactor(core): move src/security into packages/core"
```

---

## Task 17: Move `src/review/` into `packages/core/`

**Note:** `src/index.ts` imports heavily from `./review/*` (ReviewerScorer, AuthorResolver, CodeownersWriter, loadConfig, types). After this task, those become `@ctxloom/core` imports.

- [ ] **Step 1-7: Standard recipe**

```bash
ls src/review/
grep -rln "from '\./review\|from '\.\./review" src/ tests/ packages/core/src/ 2>/dev/null

mkdir -p packages/core/src/review
git mv src/review/* packages/core/src/review/

npm run lint -w @ctxloom/core
# Add `export * from './review/index.js';` to packages/core/src/index.ts
# Update consumers (including src/index.ts)
npm test && npm run build

git add -A
git commit -m "refactor(core): move src/review into packages/core"
```

**Specifically update `src/index.ts`:** the block of imports around line 23–28 in the original file:
```typescript
import { scoreReviewers } from './review/ReviewerScorer.js';
import { AuthorResolver, resolveViaGitHubApi } from './review/AuthorResolver.js';
import { generateCODEOWNERS, writeCODEOWNERS } from './review/CodeownersWriter.js';
import { loadReviewConfig } from './review/loadConfig.js';
import type { CandidateActivity } from './review/types.js';
import type { CodeownersRule } from './review/CodeownersWriter.js';
```

becomes:
```typescript
import {
  scoreReviewers,
  AuthorResolver,
  resolveViaGitHubApi,
  generateCODEOWNERS,
  writeCODEOWNERS,
  loadReviewConfig,
} from '@ctxloom/core';
import type { CandidateActivity, CodeownersRule } from '@ctxloom/core';
```

Required: whatever names the existing code actually uses. Do not rename during extraction.

---

## Task 18: Move `src/tools/` into `packages/core/`

**Biggest move.** All 34 MCP tools live here. They depend on graph, git, indexer, ast — all already moved.

- [ ] **Step 1: Inventory and grep**

```bash
ls src/tools/
grep -rln "from '\./tools\|from '\.\./tools" src/ tests/ packages/core/src/ 2>/dev/null
```

- [ ] **Step 2: Move**

```bash
mkdir -p packages/core/src/tools
git mv src/tools/* packages/core/src/tools/
```

- [ ] **Step 3: Fix internal imports**

Every tool file will import from `../graph/`, `../ast/`, `../git/`, etc. — these sibling paths still resolve because both are now under `packages/core/src/`. Check with:
```bash
npm run lint -w @ctxloom/core
```

Expected: exit 0. Fix any path that still expects the old sibling layout.

- [ ] **Step 4: Update pass-through**

Add to `packages/core/src/index.ts`:
```typescript
export * as tools from './tools/index.js';
```

(Note the namespace form — tools are exported under a `tools.*` namespace to avoid symbol collisions like `ctx_blast_radius` handler names.)

If `packages/core/src/tools/index.ts` doesn't exist, create it by exporting from `registry.ts` and each tool:
```typescript
export * from './registry.js';
// add per-tool exports as needed
```

- [ ] **Step 5: Update consumers**

`src/index.ts` imports `RepoRegistry` from `./tools/cross-repo-search.js` — becomes:
```typescript
import { RepoRegistry } from '@ctxloom/core';
```

(Only if `RepoRegistry` is re-exported at top level. If under `tools.*` namespace, use `import { tools } from '@ctxloom/core'; const { RepoRegistry } = tools;` — pick whichever is less invasive for `src/index.ts`.)

- [ ] **Step 6: Run every test suite**

```bash
npm test -w @ctxloom/core
npm test -w @ctxloom/dashboard
npm test -w ctxloom-pr-bot
npm test  # root
```

Expected: all green.

- [ ] **Step 7: Build**

```bash
npm run build
```

Expected: `dist/` rebuilt with all tool handlers. Size should be comparable (±5%) to pre-move build.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(core): move src/tools into packages/core"
```

---

## Task 19: Move `src/workers/` into `packages/core/`

**Special note:** `tsup.config.ts` has `src/workers/indexerWorker.ts` as a build entry point. This entry path must be updated in Task 24.

- [ ] **Step 1-6: Standard recipe**

```bash
ls src/workers/
grep -rln "from '\./workers\|from '\.\./workers" src/ tests/ packages/core/src/ 2>/dev/null

mkdir -p packages/core/src/workers
git mv src/workers/* packages/core/src/workers/

npm run lint -w @ctxloom/core
# If anything references workers/indexerWorker from src/, update
npm test
```

- [ ] **Step 7: Do NOT build yet**

tsup will fail because `src/workers/indexerWorker.ts` no longer exists at that path. Fix in Task 24. Note this in the commit message.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(core): move src/workers into packages/core

Note: tsup entry point update deferred to Task 24."
```

---

## Task 20: Move `src/watcher/` into `packages/core/`

- [ ] **Step 1-6: Standard recipe**

```bash
ls src/watcher/
grep -rln "from '\./watcher\|from '\.\./watcher" src/ tests/ packages/core/src/ 2>/dev/null

mkdir -p packages/core/src/watcher
git mv src/watcher/* packages/core/src/watcher/

npm run lint -w @ctxloom/core
# Add `export * from './watcher/index.js';` to packages/core/src/index.ts if public
npm test
# Build may still fail due to Task 19 worker path — OK to defer build verification
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(core): move src/watcher into packages/core"
```

---

## Task 21: Update `tsup.config.ts` to point at new worker path

**Files:**

- Modify: `tsup.config.ts`
- Modify: `package.json` (postinstall script if it references worker path)

- [ ] **Step 1: Update tsup entry paths**

In `tsup.config.ts`, change:
```typescript
entry: [
  'src/index.ts',
  'src/workers/indexerWorker.ts',
  'src/setup/postinstall.ts',
],
```

to:
```typescript
entry: [
  'src/index.ts',
  'packages/core/src/workers/indexerWorker.ts',
  'src/setup/postinstall.ts',
],
```

- [ ] **Step 2: Update rootDir in tsconfig**

`rootDir: "src"` in `tsconfig.json` is now too narrow because tsup compiles a file outside `src/`. Change:
```json
"rootDir": "src",
```
to:
```json
"rootDir": ".",
```

Also update `include`:
```json
"include": ["src/**/*", "packages/core/src/**/*"]
```

- [ ] **Step 3: Verify build**

Run: `npm run build`

Expected:
- `dist/index.js` present (CLI)
- `dist/workers/indexerWorker.js` present — but note the output path may become `dist/packages/core/src/workers/indexerWorker.js` because tsup mirrors the entry path. Two fix options:
  1. Use tsup's `esbuildOptions` to set `outbase: 'src'` — but that won't work since the entry is outside src.
  2. Use `outbase: '.'` which preserves the `packages/core/src/workers/` path under dist.
  3. **Recommended:** keep `indexerWorker.ts` as a thin re-export stub at `src/workers/indexerWorker.ts` that just `export * from '@ctxloom/core/src/workers/indexerWorker.js'` — this avoids breaking the entry path entirely.

Go with option 3: revert the tsup entry change from Step 1, and create a stub.

Revert Step 1. Then create `src/workers/indexerWorker.ts`:
```typescript
// Thin entry point for tsup — the actual worker lives in @ctxloom/core.
export * from '../../packages/core/src/workers/indexerWorker.js';
```

Restore `tsconfig.json` rootDir back to `"src"` if changed.

- [ ] **Step 4: Re-run build**

Run: `npm run build`
Expected: `dist/workers/indexerWorker.js` present at the original path, containing bundled content from the moved module.

- [ ] **Step 5: Run all tests + smoke-run the binary**

```bash
npm test
node dist/index.js --help
```

Expected: `--help` prints usage without crashing.

- [ ] **Step 6: Commit**

```bash
git add tsup.config.ts src/workers/indexerWorker.ts
git commit -m "build: re-wire tsup worker entry to moved location via stub"
```

---

## Task 22: Curate the public API of `@ctxloom/core`

**Goal:** Replace the `export * from './X/index.js'` pass-through with a curated set of named exports, per the spec's Section 5. Lock down deep imports by adding a strict `exports` field.

**Files:**

- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/package.json`

- [ ] **Step 1: Discover current pass-through surface**

Run:
```bash
node --input-type=module -e "import('@ctxloom/core').then(m => console.log(Object.keys(m).sort().join('\n')))"
```

Record the full list. This is the current surface.

- [ ] **Step 2: Rewrite `packages/core/src/index.ts` with curated exports**

Replace the full contents with:

```typescript
/**
 * @ctxloom/core — public API for all ctxloom apps.
 *
 * Everything exported here is considered the supported surface.
 * Anything not re-exported is internal and may change without notice.
 */

// ─── Graph primitives ────────────────────────────────────────────────
export { DependencyGraph } from './graph/DependencyGraph.js';
export { CallGraphIndex } from './graph/CallGraphIndex.js';
export { GraphExporter } from './graph/GraphExporter.js';

// ─── Parsing ─────────────────────────────────────────────────────────
export { ASTParser } from './ast/ASTParser.js';
export { GrammarLoader } from './grammars/GrammarLoader.js';

// ─── Git overlay ─────────────────────────────────────────────────────
export { GitOverlayStore } from './git/GitOverlayStore.js';

// ─── Indexing ────────────────────────────────────────────────────────
export { indexDirectory } from './indexer/embedder.js';

// ─── Tools ───────────────────────────────────────────────────────────
// Namespaced to avoid collisions with top-level symbols.
export * as tools from './tools/index.js';
export { RepoRegistry } from './tools/cross-repo-search.js';

// ─── Review subsystem ────────────────────────────────────────────────
export { scoreReviewers } from './review/ReviewerScorer.js';
export { AuthorResolver, resolveViaGitHubApi } from './review/AuthorResolver.js';
export { generateCODEOWNERS, writeCODEOWNERS } from './review/CodeownersWriter.js';
export { loadReviewConfig } from './review/loadConfig.js';
export type { CandidateActivity } from './review/types.js';
export type { CodeownersRule } from './review/CodeownersWriter.js';

// ─── License subsystem ───────────────────────────────────────────────
export {
  isActive,
  getLicenseInfo,
  activateLicense,
  deactivateLicense,
  startTrial,
  LicenseRequiredError,
  NetworkError,
  SeatLimitError,
  InvalidKeyError,
  FingerprintAlreadyUsedError,
  EmailAlreadyUsedError,
  TrialUnavailableError,
} from './license/index.js';
export { track, captureError } from './license/telemetry.js';

// ─── Rules engine ────────────────────────────────────────────────────
// Exported only if rules/ has public symbols. If the rules engine is
// still internal, omit this block.
// export { RulesEngine, parseRulesYaml } from './rules/index.js';
```

**Adaptation required:** the exact names above come from `src/index.ts` and the dashboard/pr-bot consumers. If any symbol doesn't exist with that name, the build will fail — fix by looking up the actual export name in the migrated file and correcting this index. No renames are performed during this task.

- [ ] **Step 3: Lock `exports` field**

In `packages/core/package.json`, keep:
```json
"exports": {
  ".": {
    "types": "./src/index.ts",
    "default": "./src/index.ts"
  }
}
```

This blocks any consumer from importing `@ctxloom/core/anything/deep`. Attempts produce a module-not-found error.

- [ ] **Step 4: Build and run all tests**

Run:
```bash
npm run build
npm test
```

Expected: green. If any consumer is using a symbol we didn't re-export, a type error appears — fix by adding the symbol to Step 2.

- [ ] **Step 5: Smoke-test CLI**

```bash
node dist/index.js --help
```

Expected: usage printed, no import errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/index.ts packages/core/package.json
git commit -m "refactor(core): lock public API surface"
```

---

## Task 23: Update `src/index.ts` to import from `@ctxloom/core`

**Files:**

- Modify: `src/index.ts` (lines 16–51)
- Modify: `src/server.ts` (any deep imports into now-moved subdirs)
- Modify: `src/dashboard.ts` (same)

- [ ] **Step 1: Update `src/index.ts` imports**

Replace the block of imports (lines ~16–51) that reach into `./graph`, `./ast`, `./git`, `./indexer`, `./tools`, `./review`, `./license`, `./grammars` with:

```typescript
import { startServer } from './server.js';
import { runSetupWizard } from './setup/setup-wizard.js';
import {
  // Indexing
  indexDirectory,
  // Graph + parsing
  DependencyGraph,
  ASTParser,
  GrammarLoader,
  // Git
  GitOverlayStore,
  // Tools
  RepoRegistry,
  // Review
  scoreReviewers,
  AuthorResolver,
  resolveViaGitHubApi,
  generateCODEOWNERS,
  writeCODEOWNERS,
  loadReviewConfig,
  // License
  isActive,
  getLicenseInfo,
  activateLicense,
  deactivateLicense,
  startTrial,
  LicenseRequiredError,
  NetworkError,
  SeatLimitError,
  InvalidKeyError,
  FingerprintAlreadyUsedError,
  EmailAlreadyUsedError,
  TrialUnavailableError,
  track,
  captureError,
} from '@ctxloom/core';
import type { CandidateActivity, CodeownersRule } from '@ctxloom/core';
import { execSync } from 'node:child_process';
import * as readline from 'node:readline';
import os from 'node:os';
import path from 'node:path';
```

Leave the rest of the file untouched.

- [ ] **Step 2: Update `src/server.ts`**

Inspect: `grep -n "from '\./" src/server.ts`

For every import reaching into a moved subdir (`./graph`, `./tools`, `./ast`, `./git`, `./indexer`, `./grammars`, `./review`, `./license`, `./rules`, `./db`, `./security`, `./utils`, `./lib`, `./watcher`, `./workers`), switch to `@ctxloom/core`.

- [ ] **Step 3: Update `src/dashboard.ts`**

Same treatment as `src/server.ts`.

- [ ] **Step 4: Lint and build**

```bash
npm run lint
npm run build
```

Expected: zero errors. If a symbol isn't exported from core, add it in Task 22 Step 2 and rebuild.

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: green.

- [ ] **Step 6: Smoke-test CLI**

```bash
node dist/index.js --help
node dist/index.js status
```

Expected: both run cleanly.

- [ ] **Step 7: Commit**

```bash
git add src/
git commit -m "refactor(src): re-route CLI entry to consume @ctxloom/core"
```

---

## Task 24: Add tsup `noExternal` for `@ctxloom/core`

**Goal:** Ensure the published `ctxloom-pro` binary inlines `@ctxloom/core` so users installing from npm see no change.

**Files:**

- Modify: `tsup.config.ts`
- Modify: `package.json` (add `@ctxloom/core` as a dep entry so workspace resolution works)

- [ ] **Step 1: Add `noExternal` to tsup**

In `tsup.config.ts`, add to the config object:

```typescript
noExternal: ['@ctxloom/core', '@ctxloom/mcp-client'],
```

Full config object ends up like:
```typescript
export default defineConfig({
  entry: [
    'src/index.ts',
    'src/workers/indexerWorker.ts',
    'src/setup/postinstall.ts',
  ],
  format: ['esm'],
  target: 'node20',
  dts: true,
  sourcemap: true,
  clean: true,
  noExternal: ['@ctxloom/core', '@ctxloom/mcp-client'],
  async onSuccess() {
    // ... existing WASM copy logic unchanged
  },
});
```

- [ ] **Step 2: Declare `@ctxloom/core` as a dep**

In root `package.json`, add to `"dependencies"`:
```json
"@ctxloom/core": "*"
```

(The `*` version works because of the workspace protocol; npm resolves it to `packages/core` locally.)

- [ ] **Step 3: Reinstall**

Run: `npm install`
Expected: no errors. Workspace symlink re-verified.

- [ ] **Step 4: Build and inspect bundle size**

```bash
npm run build
ls -la dist/index.js
```

Record the size. It should be larger than before (previously had `require`-able relative paths; now all core is inlined).

- [ ] **Step 5: Confirm no external `@ctxloom/core` import remains in dist**

Run:
```bash
grep -c "@ctxloom/core" dist/index.js || echo "zero matches — noExternal worked"
```

Expected: zero or only comment-level matches. Any live `require('@ctxloom/core')` in the output means `noExternal` failed.

- [ ] **Step 6: Smoke-run from dist**

```bash
node dist/index.js --help
```

Expected: identical output to before.

- [ ] **Step 7: Run full test suite one last time**

```bash
npm test
```

Expected: green.

- [ ] **Step 8: Commit**

```bash
git add tsup.config.ts package.json package-lock.json
git commit -m "build: inline @ctxloom/core into ctxloom-pro via tsup noExternal"
```

---

## Task 25: Final cleanup and documentation

**Files:**

- Modify: `README.md` — contributor / layout section
- Modify: `package.json` — clean up any stale `"./lib"` export if it references old `src/lib/`
- Delete: any leftover empty directories under `src/`

- [ ] **Step 1: Verify `src/` is at expected shape**

Run: `ls src/`
Expected: `index.ts`, `server.ts`, `dashboard.ts`, `setup/` — and nothing else.

If any subdirectory lingers (e.g., an empty `lib/` stub left by git), remove it:
```bash
rmdir src/lib src/utils src/grammars src/ast src/db src/indexer src/graph src/git src/rules src/license src/security src/review src/tools src/workers src/watcher 2>/dev/null || true
```

Expected: no errors (dirs should already be gone after `git mv`).

- [ ] **Step 2: Update root `package.json` `exports` field**

The old value was:
```json
"exports": {
  ".": "./dist/index.js",
  "./lib": "./dist/lib/index.js"
}
```

`./lib` no longer corresponds to `src/lib/` (now in core). Two options:
1. Remove the `./lib` sub-export entirely (simplest, is no one consuming it externally today).
2. Repoint to `./dist/packages/core/src/lib/index.js` — only if an external consumer needs it.

Pick option 1 — remove the `./lib` entry. Final:
```json
"exports": {
  ".": "./dist/index.js"
}
```

- [ ] **Step 3: Update README contributor section**

Find the section describing the repo layout (search for "structure" or "layout"). Replace it with:

```markdown
## Repository Layout

```
contextmesh/
├── packages/
│   ├── core/              # shared library (@ctxloom/core — private)
│   └── mcp-client/        # stdio client helper (@ctxloom/mcp-client — private)
├── apps/
│   ├── dashboard/         # web dashboard (React + Express)
│   └── pr-bot/            # GitHub App for PR reviews
├── src/                   # CLI / MCP server entry for ctxloom-pro
│   ├── index.ts
│   ├── server.ts
│   ├── dashboard.ts
│   └── setup/
├── tests/
├── benchmarks/
└── docs/
```

Apps and future integrations import from `@ctxloom/core`. Internal deep imports are not supported — anything not re-exported from `packages/core/src/index.ts` is considered internal.
```

- [ ] **Step 4: Smoke-test a fresh install path**

Simulate a clean install:
```bash
rm -rf node_modules dist
npm install
npm run build
npm test
node dist/index.js --help
```

Expected: all green, help text prints.

- [ ] **Step 5: Verify branch-level diff summary**

```bash
git diff --stat main...HEAD | tail -5
git log --oneline main...HEAD
```

Expected: ~25 commits, clean migration history.

- [ ] **Step 6: Commit docs**

```bash
git add README.md package.json
git commit -m "docs: document new packages/core layout post-extraction"
```

---

## Task 26: Open PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/packages-core-extraction
```

- [ ] **Step 2: Create PR**

```bash
gh pr create --title "refactor: extract packages/core and packages/mcp-client" --body "$(cat <<'EOF'
## Summary

Phase 0.1 of the missing-addons roadmap.

- Extracts 15 library subdirectories from `src/` into a private `@ctxloom/core` workspace package
- Adds `@ctxloom/mcp-client` for future apps that spawn ctxloom as a child process
- Updates `apps/dashboard` and `apps/pr-bot` to consume `@ctxloom/core` via workspace-private imports
- Published `ctxloom-pro` bundle is unchanged for end users (`noExternal: ['@ctxloom/core']` inlines core at build time)

Spec: `docs/superpowers/specs/2026-04-24-packages-core-extraction-design.md`
Plan: `docs/superpowers/plans/2026-04-24-packages-core-extraction.md`

## Test plan

- [ ] `npm test` green at root
- [ ] `npm test -w @ctxloom/dashboard` green
- [ ] `npm test -w ctxloom-pr-bot` green
- [ ] `npm run build` succeeds and `dist/index.js` runs `--help`
- [ ] Smoke-installed tarball (`npm pack && npm install ./ctxloom-pro-1.0.5.tgz`) still runs
- [ ] `grep -rn "from '\.\./\.\./\.\./src" apps/` returns zero matches (outside dist/)
EOF
)"
```

Record the PR URL for follow-up.

---

## Self-Review

**1. Spec coverage check:**
- Section 4 (target structure) → Tasks 1, 2, 6–20, 25
- Section 5 (public API) → Task 22
- Section 6 (mcp-client) → Task 2
- Section 7 Step 1 (scaffold) → Task 1
- Section 7 Step 2 (switch apps) → Tasks 4, 5
- Section 7 Step 3 (15 subdir moves) → Tasks 6–20
- Section 7 Step 4 (curate API) → Task 22
- Section 7 Step 5 (shrink src) → Task 23
- Section 7 Step 6 (cleanup) → Task 25
- Section 8 (testing) → Task 3 + per-task `npm test` gates
- Section 9 (consumer breakage) → Tasks 4, 5
- Section 10 (rollback) → implicit via per-task commits
- Section 13 (success criteria) → final verification in Task 25 Step 4

All spec sections covered. ✅

**2. Placeholder scan:**
- Task 14, 15, 16, 17: use "Standard recipe" but include the full commands inline. ✅
- Every `git commit -m` has an actual message. ✅
- Every code step shows complete code to paste. ✅
- No "handle edge cases" or "add validation" hand-waves. ✅

**3. Type consistency:**
- `DependencyGraph`, `GitOverlayStore`, `RepoRegistry`, etc. are named identically across all tasks.
- Task 22 notes that exact names must match what's actually exported — any mismatch gets caught by the build and fixed in Task 22 Step 2.

**4. Known adaptations:**
- Task 21 Step 3 documents the tsup output path gotcha and selects the stub-file workaround inline.
- Task 22 Step 2 explicitly says names may need adaptation; the build is the enforcer.

Ready for execution.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-24-packages-core-extraction.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for a 26-task migration where each task is mechanical but cumulative errors are costly.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Best if you want to watch every step live.

Which approach?
