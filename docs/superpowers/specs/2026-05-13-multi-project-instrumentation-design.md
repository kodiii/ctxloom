# Multi-Project Instrumentation Design (v1.1.1)

**Status:** Approved
**Target release:** v1.1.1 (patch)
**Branch:** `feat/multi-project-instrumentation`
**Related:** Issue #70 / PR #71 (v1.1.0 multi-project feature)

## Goal

Turn the lights on for the multi-project `project_root` flow shipped in v1.1.0. Today the only Sentry capture site is `main().catch()` and the only PostHog events are six license-funnel events. The entire MCP server runtime, including the new resolver / state manager / first-touch indexing paths, is silent. v1.1.1 adds:

- **PostHog:** state-transition events for project resolution, first-touch indexing, eviction, alias registration, kill switch, structured resolver failures, plus 25% sampled `tool_dispatched` events.
- **Sentry:** capture every non-structured error thrown during MCP tool dispatch, plus indexing failures and dispose-path failures. Embed `release` tag in each captured event so the Sentry UI groups by version. Client-side scrub `/Users/<name>/` and `/home/<name>/` from stack frames before transmission.

## Non-goals (deferred to follow-up PRs — see end of doc)

- Distinct-id schema migration (still `os.hostname()` for v1.1.1 to preserve existing license funnels) — **PR-A**
- Dashboard-side telemetry (browser SDK in `apps/dashboard/`) — **PR-B**
- Sentry CLI sourcemap upload (gives source-resolved stack traces in the Sentry UI) — **PR-C**

## Decisions locked in

| Decision | Choice |
|---|---|
| Project-path PII | SHA-256 the canonical absolute path, send first 16 hex chars as `project_id` |
| Event volume | State transitions + structured resolver failures + 25% sampled tool dispatch |
| Sentry scope | All non-structured errors thrown during tool dispatch, plus indexing/dispose failures |
| Sentry stack-frame scrubbing | Client-side replace `/Users/<seg>/` and `/home/<seg>/` with `/Users/~/` and `/home/~/` before send |
| Sentry release correlation | Embed `release` (semver from `package.json`) as a tag on every captured event |
| Opt-out | Existing `CTXLOOM_NO_TELEMETRY=1` / `DO_NOT_TRACK=1` (no new env vars) |
| Distinct ID | `os.hostname()` — unchanged from v1.1.0 |

## Architecture

The existing `packages/core/src/license/telemetry.ts` already provides `track()` and `captureError()` with the right semantics (fire-and-forget, opt-out, build-time key injection via tsup `define`). We keep the transport, expand the event union, and add call sites.

Three module-level additions:

1. **`hashProjectRoot(absPath: string): string`** — new helper in `packages/core/src/server/projectId.ts`. Pure function: canonicalize path with `path.resolve()`, SHA-256, return first 16 hex chars. All multi-project events carry the result as `project_id`.

2. **`TelemetryEvent` union expansion** — add the v1.1.1 event names. Closed union catches typos and keeps the catalog discoverable from `@ctxloom/core`.

3. **Per-server `EmittedOnceTracker`** — small in-memory `Set<string>` to enforce "fire once per session per project" for `project_resolved` and `multi_project_active`. Lives next to `FirstTouchTracker` in `packages/core/src/server/`.

The telemetry module's home stays at `packages/core/src/license/telemetry.ts` for v1.1.1 to keep the diff minimal — a rename to `observability/telemetry.ts` is a separate refactor PR.

## Event catalog

All events carry `distinct_id = os.hostname()` and `properties.$lib = 'ctxloom-cli'`. New events:

| Event | Fired when | Properties |
|---|---|---|
| `project_resolved` | First successful `resolveOrDefault()` per `(root, session)` pair | `project_id`, `source` (`'alias'`/`'arg-path'`/`'env'`/`'cwd'`), `via_alias` (bool) |
| `project_first_touch` | First-touch indexing completes (graph or vectors) | `project_id`, `tier` (`'graph'`/`'vectors'`), `duration_ms`, `nodes?`, `edges?` |
| `project_evicted` | `ProjectStateManager.evictLRU()` disposes a state | `project_id`, `pinned_count`, `cap` |
| `alias_registered` | `case 'register':` succeeds with `--alias` in the CLI | `alias_length`, `was_collision` (always `false` when this fires) |
| `multi_project_active` | `manager.list().length` transitions from 1 → ≥2 (fires once per session) | `active_count`, `cap` |
| `kill_switch_active` | `startServer()` boot when `CTXLOOM_DISABLE_MULTIPROJECT=1` | `cap` (always `1`) |
| `project_resolution_failed` | Fired from the `CallToolRequest` handler catch when a structured resolver error is returned (NOT sent to Sentry — these are user mistakes, not bugs) | `error_code` (`'alias_not_found'`/`'no_default_project'`/`'project_root_not_found'`/`'project_root_unreadable'`), `had_arg` (bool) |
| `tool_dispatched` | 25% sampled, after successful tool dispatch | `project_id`, `tool` (the tool name), `duration_ms` |

### Sampling

`tool_dispatched` uses `Math.random() < 0.25`. No per-tool deduplication, no per-session bias — straight uniform sampling. 25% (rather than 10%) keeps rare-tool visibility realistic: a tool called ~5 times across the install base in a month gives ~1.25 expected events, vs. 0.5 at 10%. Acceptable for "which tools are popular" coarse-grained analytics; not suitable for precise per-call counting.

## Error capture sites

Five Sentry capture sites are added or extended:

| Site | File | Behavior |
|---|---|---|
| `CallToolRequest` handler catch | `src/server.ts` | Existing block catches resolver errors and returns structured XML. Extend: if the thrown error is **not** a structured resolver error (`alias_not_found` / `no_default_project` / `project_root_not_found` / `project_root_unreadable`), call `captureError(err, { tool, project_id? })`. Structured errors are user mistakes and stay Sentry-free. |
| `ensureVectorsInitialized()` rejection | `packages/core/src/server/ProjectState.ts` | `captureError(err, { project_id, phase: 'vector_init' })` before re-throwing. Existing reject path is preserved. |
| `initGraph()` failure | `src/server.ts` | `captureError(err, { project_id, phase: 'graph_init' })` in the `getGraph` getter promise. |
| `evictLRU()` dispose path | `packages/core/src/server/ProjectStateManager.ts` | Wrap the fire-and-forget `Promise.resolve(this.onDispose(state)).catch(...)` with a Sentry catch: `captureError(err, { project_id, phase: 'dispose' })`. |
| `main().catch()` | `src/index.ts` | Existing — unchanged. |

## Sentry release tagging + stack-frame scrubbing

Two pieces ship in v1.1.1; sourcemap upload is deferred to PR-C so v1.1.1 is not blocked on the `SENTRY_AUTH_TOKEN` GitHub Actions secret.

### `release` tag (v1.1.1, in this spec)

Embed `release: <semver from package.json>` as a Sentry tag on every captured event. Implementation:

1. `tsup.config.ts` — add `__RELEASE__` to the `define` substitution, sourced from `process.env.npm_package_version` at build time.
2. `telemetry.ts` — read `__RELEASE__` and inject as `tags.release` in the Sentry payload, alongside the existing `runtime: 'node'` and `component` tags.
3. Same `release` value goes into PostHog event `properties.release` so the two backends correlate.

This gives the Sentry UI "errors by release" grouping immediately, with no infrastructure dependencies. Stack traces still point at `/dist/index.cjs:42:1337` (no sourcemaps), but you can at least filter by version.

### Stack-frame scrubbing (v1.1.1, in this spec)

`parseStack()` already extracts `{ filename, lineno, function }` from `Error.stack`. Pre-transmission, replace:

- `/Users/<segment>/` → `/Users/~/`
- `/home/<segment>/` → `/home/~/`
- `C:\\Users\\<segment>\\` → `C:\\Users\\~\\` (Windows safety)

`<segment>` is the first path component after the prefix (the username). The rest of the path is preserved. ~5 LoC. Acts as a defense-in-depth layer alongside any Sentry-side scrubbing the project may already have.

### Sourcemap upload (DEFERRED to PR-C)

See "Follow-up PRs" at the end of this doc. Once sourcemaps are uploaded, stack traces show original TS file + line, which makes the captured errors dramatically more useful to debug. Decoupled from v1.1.1 so we ship without waiting on the auth-token setup.

## PII discipline

| Sent | Not sent |
|---|---|
| `project_id` (16-char SHA-256) | Absolute paths |
| `source` (`'alias'`/`'arg-path'`/`'env'`/`'cwd'`) | Repo names |
| `tool` (tool name, e.g. `ctx_architecture_overview`) | Alias strings (only `alias_length`) |
| `alias_length` (integer) | MCP request payloads |
| `tier`, `duration_ms`, `nodes`, `edges`, counts | Working-directory contents |
| `release` (semver from package.json) | Environment variables other than the opt-out flag values |

Sentry stack frames will contain file paths from the user's local checkout. This is accepted risk for error context; Sentry server-side scrubbing can mask `/Users/<name>/` patterns if needed (configurable in the Sentry project, not the client).

## Files touched

| File | Change |
|---|---|
| `packages/core/src/server/projectId.ts` | New: `hashProjectRoot()` |
| `packages/core/src/server/EmittedOnceTracker.ts` | New: small Set-based per-session emission guard |
| `packages/core/src/license/telemetry.ts` | Expand `TelemetryEvent` union; add `release` to all event payloads and Sentry tags; add client-side stack-frame scrubbing in `parseStack()` |
| `packages/core/src/server/ProjectState.ts` | Sentry capture in `ensureVectorsInitialized()` reject path |
| `packages/core/src/server/ProjectStateManager.ts` | Fire `project_evicted`; wrap dispose with Sentry catch |
| `src/server.ts` | Fire `project_resolved`, `multi_project_active`, `project_first_touch`, `tool_dispatched`, `kill_switch_active`, `project_resolution_failed`; Sentry capture in handler catch for non-structured errors and `initGraph` failures |
| `src/index.ts` | Fire `alias_registered` after successful registration |
| `packages/core/src/index.ts` | Export `hashProjectRoot`, `EmittedOnceTracker` |
| `tsup.config.ts` | Add `define` for `__RELEASE__` from `npm_package_version` |

Approximate footprint: ~210 LoC source, ~110 LoC tests, ~10 LoC build config. No new GitHub Actions secret in v1.1.1.

## Testing

| Test file | What it verifies |
|---|---|
| `tests/HashProjectRoot.test.ts` | Same path → same hash; different paths → different hashes; 16 hex chars; trailing-slash normalization |
| `tests/EmittedOnceTracker.test.ts` | First call returns `true`, subsequent calls return `false`; per-key isolation; `reset()` clears |
| `tests/TelemetryOptOut.test.ts` | `CTXLOOM_NO_TELEMETRY=1` short-circuits both `track` and `captureError` (verify or extend) |
| `tests/TelemetryStackScrubbing.test.ts` | `parseStack()` redacts `/Users/<name>/` and `/home/<name>/` and `C:\\Users\\<name>\\`; preserves the rest of the path |
| `tests/TelemetryRelease.test.ts` | Captured event includes `tags.release = <package.json version>` |
| `tests/MultiProjectTelemetry.test.ts` | Mock `track`/`captureError`; drive `ProjectStateManager` + `resolveOrDefault` through real flows; assert event names and property shape including `project_resolution_failed`; no real network |
| Existing 715 tests | Must stay green |

Mocking strategy: use Vitest's `vi.mock('@ctxloom/core', ...)` to replace `track` and `captureError` with spies. No network in tests.

## Error handling

The instrumentation itself must never break the CLI:

- `track()` / `captureError()` are already fire-and-forget — they catch all internals.
- `hashProjectRoot()` is pure CPU and synchronous — cannot throw under normal use, but the call sites still wrap in `try`/`catch` and fall back to `'unknown'` if it somehow does.
- Stack-frame scrubbing in `parseStack()` operates on already-parsed frame strings; if the regex doesn't match (Windows, custom path) the frame passes through unscrubbed rather than throwing.
- The `__RELEASE__` build-time constant falls back to the literal string `'unknown'` if `npm_package_version` is missing during build, so a contributor doing a non-npm-script build still produces a working bundle.

## Release plan

Single PR, single feature branch (`feat/multi-project-instrumentation`), v1.1.1 patch bump. After merge: follow the existing release protocol exactly (`/Users/ricardoribeiro/.claude/projects/-Users-ricardoribeiro-GitHub-contextmesh/memory/project_release_protocol.md`).

After v1.1.1 publishes, the two follow-up PRs below should be filed before any new feature work.

---

## Follow-up PRs (post-v1.1.1)

These are intentionally deferred from v1.1.1. Each is its own focused PR.

### PR-A: Distinct-id schema migration → stable anonymous ID

**Why deferred from v1.1.1:** The current `distinct_id = os.hostname()` is shared with the existing license funnels (`trial_started`, `license_activated`, `license_gate_hit`). Switching to a UUID would break those funnels' user-counts overnight, and there's no clean PostHog migration without an aliasing window.

**Scope:**
- Generate a stable UUID per install, persist to `~/.ctxloom/distinct-id` (or equivalent).
- Use `posthog-node`'s `alias()` API to bridge `hostname → uuid` over a 30-day window so existing funnels survive.
- Backfill license events to use the new ID after the alias window.
- Document the migration in `CHANGELOG.md`.

**Estimated footprint:** ~80 LoC source, ~40 LoC tests, plus a PostHog-side aliasing config.

**Trigger:** File immediately after v1.1.1 ships and is verified live.

### PR-B: Dashboard-side telemetry

**Why deferred from v1.1.1:** Different surface (browser, not CLI), different transport (PostHog browser SDK vs. our hand-rolled `fetch`), different event taxonomy (page views, ProjectSwitcher clicks, dashboard navigation). Lumping it in would double the v1.1.1 diff and force a Vitest jsdom environment we don't currently use for browser tests.

**Scope:**
- Add `posthog-js` to `apps/dashboard/client/`.
- Init in `apps/dashboard/client/src/main.tsx` with the same opt-out env vars (read from a server endpoint at boot).
- Event catalog: `dashboard_loaded`, `project_switched` (fired from `ProjectSwitcher.tsx`), `alias_used_in_switcher`, `dashboard_error`.
- Wire `Sentry.init` for the browser too — separate DSN or the same one.
- Tests with Vitest + jsdom environment.

**Estimated footprint:** ~120 LoC client, ~60 LoC tests, new build dependency.

**Trigger:** File after PR-A merges, or after the next dashboard feature work — whichever comes first.

### PR-C: Sentry CLI sourcemap upload

**Why deferred from v1.1.1:** Requires a `SENTRY_AUTH_TOKEN` GitHub Actions secret and `sentry-cli` in the publish pipeline. v1.1.1 ships without it so the release isn't blocked on auth-token setup — the `release` tag (already in v1.1.1) gives "errors by version" grouping; sourcemaps just make individual stack frames readable as TS source instead of `/dist/index.cjs:42:1337`.

**Scope:**
- `tsup.config.ts` — enable `sourcemap: true` for production builds.
- `package.json` — add `sentry-cli` to devDependencies; add `prepublishOnly` step: `sentry-cli releases new $npm_package_version && sentry-cli releases files $npm_package_version upload-sourcemaps ./dist --url-prefix '~/dist'`.
- Hard-code `SENTRY_ORG` and `SENTRY_PROJECT` in `package.json` (not secret).
- New GitHub Actions secret `SENTRY_AUTH_TOKEN` exported into the publish job.
- Gate the upload step on `SENTRY_AUTH_TOKEN` being present so local `npm publish` without it logs a warning and continues — contributor publishes don't break.
- Verify with a test publish: the resulting Sentry event for any captured error should show original `.ts` filenames and line numbers.

**Estimated footprint:** ~30 LoC build config, 1 new devDependency, 1 new GitHub Actions secret.

**Trigger:** File immediately after v1.1.1 ships and you've set the `SENTRY_AUTH_TOKEN` secret on the repo (`gh secret set SENTRY_AUTH_TOKEN`). Small patch release (v1.1.2 or v1.1.3 depending on PR-A ordering).

---

## Open assumptions

These are assumptions I'm making without verifying. Flag if any are wrong:

1. **The PostHog free tier covers expected v1.1.1 volume.** Estimate: 5–20 state events/session + ~25 sampled `tool_dispatched`/session + occasional `project_resolution_failed`, across an estimated install base. Free tier is 1M events/month — should be comfortable.
2. **`npm_package_version` is set during `npm publish` builds.** npm sets this env var when running scripts; tsup's `define` substitution should pick it up at build time. If not, fall back to importing `package.json` directly into `tsup.config.ts` and reading `.version`.
3. **The existing telemetry transport handles the volume.** Both `track()` and `captureError()` use `fetch()` with a 4-second timeout per call, fire-and-forget. Adding ~30 events per session multiplies the call count but each one is independent; should be fine. If we see issues we batch later.
