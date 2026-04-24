# Design Spec: `packages/core/` Extraction

**Date:** 2026-04-24
**Status:** Draft — pending user review
**Scope:** Phase 0.1 of the missing-addons roadmap. Extract shared code from `src/` into a private workspace package so that future apps (VS Code extension, Slack bot, Linear/Jira integrations, AI reviewer) can depend on it cleanly, without forcing us to publish a public `@ctxloom/core` package before there's external demand.

---

## 1. Problem

Today, `src/` in this repo does two jobs:

1. **Library work** — graph engine, AST parsing, git mining, risk scoring, MCP tool handlers, rules engine, indexing.
2. **Binary work** — the CLI and MCP server entry point (`src/index.ts`).

Existing apps (`apps/dashboard`, `apps/pr-bot`) reach into `src/` via relative paths like `../../../src/graph/DependencyGraph.ts`. This works but:

- It couples every app tightly to the layout of `src/` — any internal reorganisation breaks consumers.
- There is no package boundary, so apps can deep-import anything, including internals that were never intended as API.
- Future apps (VS Code extension, Slack/Linear integrations, AI reviewer) will each invent their own relative-path traversal, multiplying the coupling.
- A future JetBrains plugin or community port would need a stable consumable surface, and we currently have none.

## 2. Goal

Create a single internal package (`packages/core/`) that every app in this monorepo consumes via `@ctxloom/core`, with a curated public API. Keep it private to this workspace for now — flip to published later if and when external demand appears.

## 3. Non-goals

- **Not** publishing `@ctxloom/core` to npm in this phase.
- **Not** rewriting any tool, parser, or graph logic — this is a pure move.
- **Not** adding changesets, docs site, or telemetry (those are Phase 0.2, 0.3, 0.4 — descoped).
- **Not** stabilising a public API contract — the surface may still churn freely because all consumers live in this repo.

## 4. Target structure

```
contextmesh/
├── packages/
│   ├── core/                       # NEW
│   │   ├── src/
│   │   │   ├── lib/               # moved from src/lib/
│   │   │   ├── utils/             # moved from src/utils/
│   │   │   ├── grammars/          # moved from src/grammars/
│   │   │   ├── ast/               # moved from src/ast/
│   │   │   ├── db/                # moved from src/db/
│   │   │   ├── indexer/           # moved from src/indexer/
│   │   │   ├── graph/             # moved from src/graph/
│   │   │   ├── git/               # moved from src/git/
│   │   │   ├── rules/             # moved from src/rules/
│   │   │   ├── license/           # moved from src/license/
│   │   │   ├── security/          # moved from src/security/
│   │   │   ├── review/            # moved from src/review/
│   │   │   ├── tools/             # moved from src/tools/
│   │   │   ├── workers/           # moved from src/workers/
│   │   │   ├── watcher/           # moved from src/watcher/
│   │   │   └── index.ts           # curated public exports
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── mcp-client/                 # NEW — thin wrapper for apps
│       ├── src/index.ts
│       ├── package.json
│       └── tsconfig.json
├── apps/
│   ├── dashboard/                  # updated imports
│   └── pr-bot/                     # updated imports
├── src/                            # shrinks to CLI/server entries + setup
│   ├── index.ts                   # CLI entry (imports from @ctxloom/core)
│   ├── server.ts                  # MCP server boot
│   ├── dashboard.ts               # `ctxloom dashboard` CLI shortcut
│   └── setup/                     # first-run setup flows
├── tests/                          # unchanged location, imports updated
├── benchmarks/                     # unchanged
└── package.json                    # workspaces: ["packages/*", "apps/*"]
```

## 5. `@ctxloom/core` public API (initial)

Defined in `packages/core/src/index.ts`. Apps import only from this entry point. Deep imports are blocked via the `exports` field in the package.json.

```typescript
// Graph primitives
export { DependencyGraph, CallGraphIndex, GraphExporter } from './graph';
export type { GraphNode, GraphEdge, EdgeConfidence } from './graph/types';

// Parsing
export { ASTParser } from './ast';
export type { ParsedSymbol, Language } from './ast/types';

// Git overlay
export { GitHistoryMiner, RiskScorer, CouplingAnalyzer } from './git';

// Indexing (vector + keyword)
export { Embedder, VectorStore, HybridSearch } from './indexer';

// Persistence
export { openDb } from './db';

// Tools — each tool's handler is exported for programmatic use
export * as tools from './tools';

// Rules engine
export { RulesEngine, parseRulesYaml } from './rules';

// License + security subsystems (consumed by pr-bot and dashboard)
export { verifyLicense } from './license';
export { runSecurityChecks } from './security';

// Review helpers (shared between pr-bot and CLI)
export { renderReviewSummary } from './review';

// Config loader — apps need to read .ctxloom.yml
export { loadCtxloomConfig } from './utils/config';
```

**Note on concrete symbol names:** the exported names above are the intended public surface. Actual symbol names in the existing `src/` may differ (e.g., `verifyLicense` might be `LicenseManager.verify()`). During Step 4 of the migration, the public API is curated by matching actual existing symbols — no renames happen during extraction; if a rename is desired it becomes a follow-up PR.

**Export discipline:** anything not re-exported from `index.ts` is internal. Enforced by setting `"exports": { ".": "./src/index.ts" }` in the package's `package.json`, which blocks subpath imports from consumers.

## 6. `@ctxloom/mcp-client`

A thin companion package used by apps that need to talk to a running ctxloom MCP server (vs importing core directly). Two shapes:

- **In-process** — the app imports the core library directly (used by `apps/pr-bot`, `apps/dashboard`).
- **Out-of-process** — the app spawns `ctxloom-pro` as a child, speaks MCP JSON-RPC over stdio (used by `apps/vscode-extension`, `apps/integrations/*`, future AI reviewer).

The mcp-client package wraps the out-of-process case:

```typescript
// packages/mcp-client/src/index.ts
export function spawnServer(opts?: { cwd?: string; env?: Record<string, string> }): McpClient;
export class McpClient {
  callTool(name: string, args: unknown): Promise<ToolResult>;
  close(): Promise<void>;
}
```

This isolates apps from the exact command and protocol details, so if we change how the server boots, only mcp-client needs updating.

## 7. Migration strategy — incremental with re-exports

Chosen over a single big-bang commit because each step stays small and reviewable, tests remain green throughout, and the work can pause partway without leaving the repo in a broken state.

### Step 1 — Scaffold the packages (no code moved)

- Create `packages/core/` with a stub `src/index.ts` that does `export * from '../../src/graph'` etc. The old `src/` is untouched; core is a thin pass-through.
- Create `packages/mcp-client/` with a stub `spawnServer()` that wraps the existing bin.
- Update root `package.json` workspaces to `["packages/*", "apps/*"]`.
- Wire tsconfig `paths` so TypeScript resolves `@ctxloom/core` to the stub during development.
- Commit: `chore(packages): scaffold core and mcp-client workspaces`.

### Step 2 — Switch apps to import from `@ctxloom/core`

- Update every import in `apps/dashboard/` and `apps/pr-bot/` that reaches into `../../../src/` to use `@ctxloom/core` instead.
- Apps now consume the stub, which still forwards to `src/`. No behaviour change.
- Run `npm test` in each app — must be green.
- Commit: `refactor(apps): consume @ctxloom/core instead of relative src imports`.

### Step 3 — Move one subdirectory at a time

Full inventory of `src/` as of 2026-04-24:

**Library code — moves to `packages/core/`:**

1. `src/lib/` (generic utilities — lowest coupling, move first)
2. `src/utils/`
3. `src/grammars/` (tree-sitter grammar manifests)
4. `src/ast/` (depends on grammars)
5. `src/db/` (persistence layer)
6. `src/indexer/` (depends on db + ast)
7. `src/graph/` (depends on ast)
8. `src/git/` (depends on graph)
9. `src/rules/` (depends on graph)
10. `src/license/` (standalone subsystem; moves with core)
11. `src/security/` (standalone checks)
12. `src/review/` (review helpers used by pr-bot)
13. `src/tools/` (depends on everything above — move last)
14. `src/workers/` (background workers invoked by tools)
15. `src/watcher/` (file watcher, depends on graph)

**Stays at `src/`:**

- `src/index.ts` — CLI / MCP server entry
- `src/server.ts` — MCP server class (imports from core; stays because it wires the server boot)
- `src/dashboard.ts` — CLI shortcut that launches `apps/dashboard`
- `src/setup/` — first-run setup flows (tied to the CLI, not the library)

For each move:

- Move files with `git mv` to preserve history.
- Update every internal import within core to use relative paths.
- Update the stub `packages/core/src/index.ts` to export from the new location (no longer `../../src/`).
- Update `tests/` imports that touched the moved subdirectory.
- Run `npm test && npm run build`. Must be green.
- Commit: `refactor(core): move <subdir> into packages/core`.

Roughly 15 commits for Step 3, each small and self-contained. Order respects the dependency chain above so every intermediate state compiles.

### Step 4 — Curate the public API

- Replace the pass-through `packages/core/src/index.ts` with the curated exports defined in Section 5.
- Add `"exports": { ".": "./src/index.ts" }` to `packages/core/package.json` to block deep imports.
- Run `npm run build` — any consumer that was deep-importing an internal surfaces as a build error now. Fix by adding the required symbol to the public export, or by refactoring the consumer if the import was genuinely into an internal.
- Commit: `refactor(core): lock public API surface`.

### Step 5 — Shrink `src/`

- At this point `src/` should contain only:
  - `src/index.ts` — the MCP server / CLI entry, which imports from `@ctxloom/core`.
  - Possibly some top-level glue (e.g., CLI flag parsing).
- Update the published package (`ctxloom-pro`) to declare `@ctxloom/core` as a workspace dep via `"dependencies": { "@ctxloom/core": "*" }`.
- When `ctxloom-pro` is built for npm, bundle core in via **tsup `noExternal: ['@ctxloom/core']`** (decided). This means `@ctxloom/core` gets inlined into the `dist/` of `ctxloom-pro` at build time — users installing `ctxloom-pro` see no difference, and `@ctxloom/core` itself remains unpublished. Rejected alternative: publishing core as a separate npm package was discussed and deferred (see Section 2 "Non-goals").
- Commit: `refactor(src): reduce root src to MCP server entry only`.

### Step 6 — Clean up

- Remove any dead re-export files left over.
- Update `tsup.config.ts` and `tsconfig.json` paths to reflect the final layout.
- Update `README.md` contributor section with the new layout.
- Commit: `chore: clean up after core extraction`.

## 8. Testing strategy

- Existing tests in `tests/` stay where they are. Their imports update during Step 3.
- `npm test && npm run build` at the root must pass after every commit in the migration.
- Add one smoke test per app under `apps/<name>/tests/smoke.test.ts` that imports from `@ctxloom/core` and exercises a single tool end-to-end. These smoke tests are the tripwire that catches a broken public export.
- The benchmark suite in `benchmarks/` runs as it does today; its imports update as part of Step 3.

## 9. What breaks for consumers

- `apps/dashboard/server/loader.ts` currently does `import { DependencyGraph } from '../../../src/graph/DependencyGraph'` → becomes `import { DependencyGraph } from '@ctxloom/core'`.
- Same pattern for `apps/pr-bot/`.
- Anyone with an external fork that deep-imports `contextmesh/src/` will have to update — documented in CHANGELOG.
- Published consumers of `ctxloom-pro` on npm are unaffected: the binary still installs and runs identically; the internal restructure is invisible.

## 10. Rollback

Every step is an independent commit. If a step breaks something that can't be fixed quickly:

- `git revert <sha>` undoes that step. Previous steps are still valid because of the re-export stub.
- At no point is the repo in a half-migrated state where apps are broken — the stub in Step 1 ensures apps keep working from Step 2 through Step 5.

## 11. Open questions

None outstanding. The structure, API, and migration sequence are all agreed in the brainstorming discussion preceding this spec.

## 12. Out of scope — to be tracked separately

- **Phase 0.2**: `changesets` for versioning.
- **Phase 0.3**: Docs site at `apps/docs/`.
- **Phase 0.4**: Opt-in telemetry.
- Publishing `@ctxloom/core` to npm (deferred until external demand appears).
- Any feature work (Phase 1+). This spec covers only the extraction.

## 13. Success criteria

1. `packages/core/` exists and compiles. ✅
2. `apps/dashboard` and `apps/pr-bot` import only from `@ctxloom/core`, no deep `../../../src/` paths. ✅
3. `ctxloom-pro` binary still installs from npm and behaves identically. ✅
4. `npm test` at the root is green. ✅
5. `src/` contains only the MCP server entry and any thin CLI glue. ✅
6. `packages/core/package.json` `exports` field blocks deep imports. ✅
7. A new app directory can be scaffolded and consume core with one import line: `import { ... } from '@ctxloom/core'`. ✅

## 14. Next step

After this spec is approved, run the `writing-plans` skill to generate a task-by-task implementation plan with explicit commits, file diffs, and test gates.
