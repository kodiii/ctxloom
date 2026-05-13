# Multi-project support via per-tool `project_root` parameter

**Status:** Design approved, pending implementation plan
**Issue:** [#70](https://github.com/kodiii/ctxloom/issues/70)
**Author:** Brainstormed 2026-05-12 (Claude session, transcript at `~/.claude/projects/-Users-ricardoribeiro-GitHub-contextmesh/`)
**Target release:** v1.1.0 (planned next foundational release after the v1.0.x bugfix line)

## Background

A single ctxloom MCP server process is locked to one `PROJECT_ROOT` for its lifetime. The root is resolved once at server boot from `CTXLOOM_ROOT` env or `process.cwd()`. Every tool call operates against that frozen root.

This breaks every workflow where a user works on more than one project from the same AI tool:

- **Claude Desktop** reads only `~/Library/Application Support/Claude/claude_desktop_config.json`. Project-scoped `.mcp.json` is ignored entirely, so `ctxloom init` does nothing for Desktop users — they are permanently pinned to whatever `CTXLOOM_ROOT` (or fallback cwd) was set at boot.
- **Claude Code CLI** honors project-scoped `.mcp.json`, but switching to a different project mid-session does not restart the MCP server. Whichever root the daemon booted with sticks.
- **Cursor / VS Code / Windsurf** behave similarly.

Repro that motivated this design: in a fresh Claude Desktop session, `ctx_search` returned `ENOENT: no such file or directory, mkdir '/.ctxloom'` because the global Desktop config had no `CTXLOOM_ROOT` and Claude.app's cwd is `/`. The workaround (hand-edit Desktop config, full relaunch per project switch) is unacceptable for the kind of multi-project ergonomics ctxloom advertises.

[tirth8205/code-review-graph](https://github.com/tirth8205/code-review-graph) hit the same problem and solved it cleanly without depending on the MCP `roots` spec. Their pattern: every tool's input schema exposes an optional `repo_root` parameter, plus a registry at `~/.code-review-graph/registry.json` mapping aliases to paths. A tiny resolver runs per call: explicit param → CLI flag → cwd. ctxloom already has a `RepoRegistry` for `ctx_cross_repo_search`; we just need to broaden its consumers.

## Goals

- Let a single MCP server process serve any project the agent points it at — no server restart, no config rewrite, no client-specific magic.
- Work with every existing MCP client today (Claude Desktop, Claude Code CLI, Cursor, VS Code, Windsurf, Continue, Aider) without waiting for MCP `roots` capability adoption.
- Zero breaking change for users who don't care about multi-project (existing `CTXLOOM_ROOT` env / `.mcp.json` flow keeps working identically).
- First-touch latency is bounded and visible — agents can tell the user *why* a call took a moment.
- Memory bounded — server doesn't OOM after touching N projects.

## Non-goals

- MCP `roots` capability negotiation. Deferred to Phase 4 (when ≥1 production client ships it).
- Sharing graph memory between the MCP server process and the dashboard process. Bigger refactor, separate effort.
- Multi-tenant security sandboxing across roots. Users still trust their own projects.
- Replacing `ctx_cross_repo_search`. That tool already spans multiple roots in one call — Phase 1 doesn't change it.

## Architecture overview

### 1. The parameter

Every tool's input schema gets an optional `project_root: string` field.

```ts
project_root: {
  type: 'string',
  description:
    'Absolute path or registered alias of the project to operate on. ' +
    'Falls back to CTXLOOM_ROOT env, then server cwd. ' +
    'Register aliases with `ctxloom register <path> --alias <name>`.',
}
```

**Resolution order, applied per tool call:**

1. Explicit `project_root` arg.
   - **If the value contains no path separator** (no `/`, no leading `~`, no drive letter like `C:`), treat it strictly as an alias lookup. If `findByAlias` misses, return `<error code="alias_not_found" alias="..." did_you_mean="[...]" />` — do not silently fall through to relative-path resolution. Rationale: `project_root="my-api"` is ambiguous (alias? folder named `my-api` under cwd?); making aliases require the no-separator shape eliminates the ambiguity and makes alias misses loud instead of silently routing to a different folder.
   - **If the value contains a path separator**, skip alias lookup and resolve as a path (handles `~`, relative, absolute). The resolved absolute path is then optionally enriched with alias metadata via `findByPath` for logging/status, but resolution always wins.
2. `CTXLOOM_ROOT` env var (same as today).
3. Server's `process.cwd()` (same fallback as today).

Naming rationale:
- `project_root` matches snake_case used by every existing input field (`detail_level`, `changed_files`, `entry_file`).
- Same name as the output field `<project_root>` already emitted by `ctx_status` (`packages/core/src/tools/status.ts:18`). Input ↔ output symmetry.
- Not `repo` or `root` — too generic; could be a git root, workspace root, or monorepo subpath.

### 2. State management — `Map<absoluteRoot, ProjectState>` + LRU

Each touched project gets its own `ProjectState`:

```ts
interface ProjectState {
  projectRoot: string;        // canonical absolute path
  dbPath: string;
  storePromise: Promise<VectorStore> | null;
  parserPromise: Promise<ASTParser> | null;
  graphPromise: Promise<DependencyGraph> | null;
  skeletonizerPromise: Promise<Skeletonizer> | null;
  ruleManager: RuleManager | null;
  overlay: GitOverlayStore | null;
  watcher: FileWatcher | null;
  vectorsInitialized: boolean; // set by vector-tools' lazy init
  lastTouchedAt: number;       // ms epoch, for LRU
  pinned: boolean;             // server-boot default; never evicted
}
```

The server holds `Map<string, ProjectState>` keyed by canonical absolute root.

**Cap: 5 active projects by default.** Overridable via `CTXLOOM_MAX_PROJECTS=N`. Justification:
- Most developers do not actively switch between more than 3–4 codebases in a single AI session.
- A warm `ProjectState` holds a parsed `DependencyGraph` (~10–50 MB for mid-size repos) plus tree-sitter + ONNX residents; multiplying by 10+ would breach a 4 GB process budget on smaller machines.
- The env var gives advanced users an escape hatch.

**Eviction (on inserting the 6th project):**

1. Find the LRU entry that isn't `pinned`.
2. `await state.watcher?.stop()` — release OS-level FSEvents/inotify subscriptions.
3. `await state.storePromise?.then(s => s.close())` — release LanceDB FDs (reuses `VectorStore.close()` shipped in v1.0.29).
4. Drop references to graph / parser / skeletonizer / ruleManager / overlay. On-disk state (`.ctxloom/graph-snapshot.json`, `vectors.lancedb/`, `git-overlay.json`) stays — a future re-warm is cheap because `DependencyGraph.loadSnapshot()` short-circuits the parse pass.
5. Remove from the map.

**The default project is pinned — when one exists.** Server boot resolves a candidate default from `CTXLOOM_ROOT` env or cwd, then validates it. Validation rules (all must hold):

- Path exists and is a directory.
- Path is not the filesystem root (`/` on POSIX, drive root on Windows). This is the Claude Desktop bug we triggered before #66 landed: Claude.app launches the MCP server with cwd=`/`, and `CTXLOOM_ROOT` is unset in the global Desktop config, so the resolved default ends up at `/`. Pinning that would replay the same bug just from a different code path.
- Either (a) path contains a `.ctxloom/` directory (already initialized), or (b) path contains a recognizable project marker (`.git`, `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `setup.py`, `pom.xml`, `build.gradle`).

If validation passes, the default is pinned and warmed at boot (same as today's behavior). If validation fails, the server enters **"no-default" mode**: any tool call without an explicit `project_root` returns:

```xml
<error code="no_default_project"
       attempted_root="/"
       reason="filesystem root is not a valid project"
       resolution_chain="env:CTXLOOM_ROOT→unset, fallback_cwd→/"
       hint="Set CTXLOOM_ROOT in your MCP server config, or pass project_root explicitly. Registered aliases: ['contextmesh', 'projectb', 'api']." />
```

This makes the failure mode discoverable and actionable instead of mysteriously hanging or auto-indexing `/`. Subsequent projects discovered via `project_root` are unpinned and LRU-eligible.

**Concurrency:** the existing singleton-promise idiom (deduping concurrent first-call requests) carries over per-project. Two MCP tool calls that both reference a cold root trigger exactly one warmup.

### 3. First-touch behavior — two-tier auto-index

When a tool is called against a `project_root` the server has never seen before:

**Tier 1 — Graph (fast, ~5s typical):**
1. Validate path. Must exist, be a directory, be readable. If not, return a structured error.
2. Try to load from disk. If `.ctxloom/graph-snapshot.json` exists, `loadSnapshot()` runs in <1s.
3. Otherwise, `buildFromDirectory()` parses the tree. Synchronous block on the calling tool.
4. Annotate the response with `<ctxloom_indexing>` so the agent can tell the user why this call was slow.

Tier 1 reuses the existing logic in `DependencyGraph.buildFromDirectory()` (`packages/core/src/graph/DependencyGraph.ts:59`), which already short-circuits to `loadSnapshot()` when a snapshot exists (line 71). We are not inventing this behavior — we are calling it per-root instead of globally.

**Tier 2 — Vector embeddings (deferred until needed):**

Only 4 tools need vectors: `ctx_search`, `ctx_full_text_search` (hybrid mode), `ctx_similar_files`, `ctx_cross_repo_search`. So:

- Graph-only tools return immediately after Tier 1 completes.
- Vector tools, on first call against a cold root, additionally run the embedding pass before responding. The 30s–2min cost lands here, only when the agent actually asks for semantic search.
- `state.vectorsInitialized` flag gates this; vector tools check it, run the pass if cold, then set it.

**Response envelope** (genuinely new — no equivalent in the codebase today):

```xml
<ctxloom_indexing first_touch="true" project_root="/Users/.../projectB"
                  tier="graph" duration_ms="4823" files_indexed="847" />
<!-- normal tool output here -->
```

For Tier 2 the envelope reports `tier="vectors"` and `records="N"` instead of `files_indexed`.

For Phase 1 the indexing is synchronous; the calling tool waits. MCP's `progressToken` streaming is deferred — it would require propagating the token through every tool's dispatch path, a separate refactor.

**Failure shapes** (note: ctxloom tools today emit errors as plain text via the MCP server's `CallToolRequest` handler. The structured `<error>` and `<warning>` elements below are a **new convention introduced by Phase 1**, scoped to project-resolution and indexing failures. Existing tool error paths are unchanged):

- Path doesn't exist → `<error code="project_root_not_found" path="..." resolution_chain="alias:foo→null, env:CTXLOOM_ROOT→/set, fallback_cwd→/" />`
- Path exists but unreadable → `<error code="project_root_unreadable" path="..." detail="EACCES" />`
- Path exists but no parseable source files → build empty graph, return tool result with `<warning code="no_parseable_sources" reason="directory has 0 files matching supported language extensions" />`
- Alias not found → `<error code="alias_not_found" alias="foo" did_you_mean="['fooproject', 'foobar']" />` with Levenshtein-fuzzy suggestions over registry aliases.

### 4. Registry + alias UX

**Extend `RegisteredRepo`** in `packages/core/src/tools/cross-repo-search.ts`:

```ts
export interface RegisteredRepo {
  root: string;
  dbPath: string;
  name: string;
  alias?: string;          // NEW — optional, validated as ^[a-z0-9-]{1,40}$
  registeredAt: string;
}
```

**Add lookup helpers** to `RepoRegistry`:

```ts
findByAlias(alias: string): RegisteredRepo | null
findByPath(absPath: string): RegisteredRepo | null   // canonical-path comparison
```

The MCP server's `resolveProjectRoot` calls `findByAlias` first, then falls through to path resolution.

**CLI changes** in `src/index.ts`:

- `ctxloom register [<path>] [--alias <name>]` — adds the alias flag. Validates: `^[a-z0-9-]{1,40}$`, no collisions with existing aliases, no shadowing of CLI subcommand names (`repos`, `register`, `setup`, `index`, etc. — prevent users from registering an alias that could be confused with a verb).
- `ctxloom repos` — adds an `alias` column to the printed table.

**Dashboard touch points** (additive, no regressions):

- `apps/dashboard/server/projects.ts` — add `alias?: string` to `DashboardProject`. `listProjects()` propagates the field from the registry entry.
- `apps/dashboard/client/src/components/ProjectSwitcher.tsx` — display alias as the primary label when present, falling back to `name`. One-line UI tweak.
- The dashboard's existing `slugFor()` (`projects.ts:58`) is unchanged. URL routing is dashboard-internal; aliases are user-facing.
- The dashboard's `switchContext` in-place-mutation pattern (`loader.ts:50`) is unchanged. The dashboard remains single-context per session by design — only one human is looking at it at a time.

**Migration:** existing `repos.json` entries are forward-compatible. The dashboard's `readRegistry()` (`projects.ts:63`) already filters by `typeof r.root === 'string'` and ignores unknown fields. A pre-1.1 dashboard reading a 1.1-written registry just doesn't see the alias.

### 5. `ctx_status` shape

Existing top-level tags continue to describe the default/pinned project. New tags are appended.

```xml
<ctx_status>
  <!-- Existing — unchanged shape, describes the default/pinned project.
       Omitted entirely when the server is in no-default mode (see §2). -->
  <project_root>/Users/ricardo/GitHub/contextmesh</project_root>
  <database>/Users/ricardo/GitHub/contextmesh/.ctxloom/vectors.lancedb</database>
  <graph status="ready" edges="1982" nodes="147" />
  <vector_store status="ready" records="448" />
  <ast_parser status="ready" />

  <!-- New in Phase 1 -->
  <active_projects count="3" max="5">
    <project root="/Users/ricardo/GitHub/contextmesh" alias="contextmesh"
             pinned="true" graph="ready" vectors="ready"
             last_touched_at="2026-05-12T17:59:34Z" />
    <project root="/Users/ricardo/GitHub/projectB" alias="projectb"
             pinned="false" graph="ready" vectors="cold"
             last_touched_at="2026-05-12T18:02:11Z" />
    <project root="/Users/ricardo/work/api-server" alias="api"
             pinned="false" graph="building" vectors="cold"
             last_touched_at="2026-05-12T18:02:48Z" />
  </active_projects>

  <registered_projects count="5">
    <project root="/Users/ricardo/GitHub/contextmesh" alias="contextmesh" name="contextmesh" />
    <project root="/Users/ricardo/GitHub/projectB" alias="projectb" name="projectB" />
    <project root="/Users/ricardo/work/api-server" alias="api" name="api-server" />
    <project root="/Users/ricardo/work/marketing-site" alias="marketing" name="marketing-site" />
    <project root="/Users/ricardo/code/blog" name="blog" />
  </registered_projects>
</ctx_status>
```

- `active_projects.count` / `max` makes the LRU cap visible — agent can warn the user *"you're at 5/5, the next project will evict your least-recently-used one."*
- `graph` enum: `ready | building | error | cold`.
- `vectors` enum: `ready | building | cold`.
- `registered_projects` is the full registry, NOT filtered to active. Lets the agent answer *"what aliases can I use?"* without a separate tool call.

`ctx_status` accepts the same `project_root` parameter as every other tool. If passed, it returns status for only that project. If omitted, it returns the full multi-project view above.

### 6. Observability

Every tool dispatch logs the resolved root at debug, alias at info if used:

```
[info] tool.dispatch tool=ctx_blast_radius project_root=/Users/.../projectB alias=projectb cached=true
```

LRU events log at info:

```
[info] project.evicted root=/Users/.../oldproj reason=lru_cap_reached pinned=false ttl_seconds=412
[info] project.first_touch root=/Users/.../projectB alias=projectb tier=graph duration_ms=4823 files=847
[info] project.first_touch root=/Users/.../projectB tier=vectors duration_ms=37120 records=812
```

The existing FD-soft-limit log added in v1.0.31 stays put — independent feature.

### 7. Kill switch — `CTXLOOM_DISABLE_MULTIPROJECT=1`

A safety net for users who hit a Phase 1 regression and need to fall back to v1.0.31's exact behavior without waiting for a patch release.

When set to `1`:

- `project_root` parameter is ignored by every tool (treated as if omitted). The server logs `[warn] multiproject.disabled tool=… ignored_project_root=…` so the agent can detect the mismatch.
- `ctxloom register --alias` still writes the alias to disk (so it survives the disable), but `findByAlias` returns `null` to MCP-side resolvers.
- LRU cap is forced to 1; the singleton-style boot from v1.0.31 is restored.
- `ctx_status` emits only the legacy top-level fields. The new `<active_projects>` and `<registered_projects>` blocks are omitted.
- Dashboard is unaffected (the dashboard is a separate process with its own state machine).

Documented in the troubleshooting section of the README and surfaced in the boot-time log when set:

```
[warn] multiproject disabled via CTXLOOM_DISABLE_MULTIPROJECT=1 — falling back to v1.0.31 single-project behavior
```

## Back-compat matrix

| Surface | v1.0.31 behavior | After Phase 1 | Breaking? |
|---|---|---|---|
| `CTXLOOM_ROOT` env | sets `projectRoot` for the whole server | sets the *default/pinned* project | No — semantics unchanged when `project_root` param omitted |
| `.mcp.json` from `ctxloom init` | binds server to one project | same — that project becomes the default | No |
| Tools called without `project_root` | use the boot root | use the boot root | No |
| Existing `ctx_status` XML schema | top-level fields | top-level fields preserved, new tags appended | No — additive |
| `RepoRegistry` JSON shape | `{root, dbPath, name, registeredAt}` | adds optional `alias` | No — readers ignore unknown fields |
| Dashboard's `listProjects()` | reads registry | reads registry + surfaces `alias` if present | No — alias is optional in UI |
| `bin/ctxloom.cjs` FD bump | bumps before loading entry | unchanged | No |
| `ServerContext.projectRoot` field | string, frozen at boot | string, still the default/pinned project | No — most internal callers can stay on `ctx.projectRoot` |
| `ServerContext.getStore/getGraph/...` | `() => Promise<…>` | `(root?: string) => Promise<…>` | **Internally signature-extended** but optional arg, callers passing nothing keep working |
| `CTXLOOM_DISABLE_MULTIPROJECT` env | not recognized | kill switch — forces v1.0.31 behavior | No — net-new env var, default unset behaves as Phase 1 |
| New env: `CTXLOOM_MAX_PROJECTS` | not recognized | overrides LRU cap of 5 | No — net-new env var |

## Acceptance criteria

- [ ] Every tool's input schema has an optional `project_root` parameter, documented in the description
- [ ] A user can call any tool with `project_root="/abs/path/to/other/project"` and get correct results without restarting the server
- [ ] When `project_root` is omitted, behavior is identical to v1.0.31 (`CTXLOOM_ROOT` env, then cwd) — **except** when the resolved default fails validation (filesystem root, doesn't exist, no project markers), in which case the server enters no-default mode and returns the `no_default_project` error
- [ ] Server starting with `cwd=/` and no `CTXLOOM_ROOT` no longer attempts to auto-index `/`; instead all tool calls without explicit `project_root` return a structured `no_default_project` error
- [ ] Per-root state is cached so the second call to the same project is fast (no re-parse, no re-snapshot-load)
- [ ] First-touch indexing returns a `<ctxloom_indexing>` envelope wrapping the tool response so the agent can explain the latency
- [ ] LRU eviction at the configured cap closes LanceDB connections, stops the file watcher, drops graph references; on-disk state is preserved
- [ ] `ctxloom register --alias <name>` validates `^[a-z0-9-]{1,40}$`, rejects collisions, rejects subcommand-name shadowing
- [ ] `ctxloom repos` prints aliases when present
- [ ] `ctx_status` reports the resolved default project, all active projects with state, and the full registry with aliases
- [ ] Dashboard `ProjectSwitcher` displays alias when present
- [ ] `CTXLOOM_DISABLE_MULTIPROJECT=1` falls back to v1.0.31 single-project behavior; `project_root` parameter is ignored with a clear warning log
- [ ] Tests cover:
  - (a) parameter wins over env, (b) env wins over cwd
  - (c) two consecutive calls to different roots both succeed and don't cross-contaminate (verifies `buildFromDirectory` is safe to call multiple times in one process)
  - (d) the same root reuses cached state (no re-parse, no re-snapshot-load)
  - (e) LRU evicts the right entry, (f) eviction does not affect the pinned default
  - (g) cold root with no `.ctxloom/` auto-builds the graph and emits `<ctxloom_indexing tier="graph" first_touch="true">`
  - (h) vector-tool first-call against a cold root triggers Tier 2 indexing and emits `<ctxloom_indexing tier="vectors" first_touch="true">`
  - (i) two parallel calls to the same cold root only trigger ONE warmup (singleton-promise concurrency dedup)
  - (j) `ctxloom register --alias` rejects invalid aliases (`^[a-z0-9-]{1,40}$`), collisions with existing aliases, and shadowing of CLI subcommand names
  - (k) Server boot with `cwd=/` and no `CTXLOOM_ROOT` enters no-default mode and emits the documented `no_default_project` error on tool calls without `project_root`
  - (l) `CTXLOOM_DISABLE_MULTIPROJECT=1` produces identical behavior to v1.0.31 for an existing single-project user
- [ ] `bin/ctxloom.cjs`, `ctxloom setup`, `ctxloom init`, and the publish smoke test all continue to pass without modification

## Out of scope (deferred to later phases or separate issues)

- **Phase 4 — MCP `roots` capability.** Once at least one client ships it in production, listen for `notifications/roots/list_changed` and auto-fill `project_root` so the agent doesn't have to track it. Pure quality-of-life on top of Phase 1.
- Marketing page rewrite. Once Phase 1 ships, file a follow-up issue against [ContextMeshApp](https://github.com/kodiii/ContextMeshApp) to revise `GettingStarted.tsx` (drop the misleading "MCP clients merge per-project config" footer paragraph; explain `--alias` in Step 4; update tool count to actual).
- Telemetry events for project switches / evictions. Worth doing, not a blocker.
- Shared graph memory between MCP server and dashboard process. Larger refactor, would need daemon/IPC.
- Auto-discovering projects from `~/Library/Application Support/Claude/recent-workspaces.json` or equivalent. Out of scope, possibly never.

## Risks and open questions

- **LRU cap of 5 may be too high or too low.** Best guess based on developer-session heuristics; revisit after dogfooding.
- **`vectors=cold` may not be discoverable enough.** Some agents may not surface the cold state to the user before invoking a search tool that will then take 30s. Consider a future telemetry-driven nudge to pre-warm vectors when a project enters the active set.
- **Alias shadowing CLI subcommands.** The blocklist needs to be kept in sync with new subcommands added to `src/index.ts`. Phase 1 hardcodes the list; future work could pull it from the actual switch statement.
- **`buildFromDirectory()` is currently called only once per server lifetime.** Calling it multiple times (per cold root) may surface latent bugs around module-level state inside `DependencyGraph` or its dependencies (`ASTParser`, `TsPathsResolver`). Phase 1 needs to verify that two consecutive `buildFromDirectory` calls against different roots do not cross-contaminate. The existing `tests/FileWatcher.test.ts` flakiness on a clean `main` checkout suggests there may already be such state. To be checked during implementation.

## Prior art

- [tirth8205/code-review-graph](https://github.com/tirth8205/code-review-graph) — `code_review_graph/main.py` `_resolve_repo_root`, `code_review_graph/registry.py`. Resolution order matches ours exactly; their registry is identical in spirit but they support alias lookup on every tool call, which we mirror here.

## Related ctxloom work

- PR #66 (v1.0.31) — `bin/ctxloom.cjs` FD bump. Same theme: cross-tool ergonomics that fail silently in Claude Desktop.
- PR #61 (v1.0.28) — paging / `detail_level` on `ctx_community_list` and `ctx_wiki_generate`. Established the `detail_level: "standard" | "minimal"` pattern that we should consider applying to the new multi-project `<active_projects>` block in `ctx_status` if it gets too large.
