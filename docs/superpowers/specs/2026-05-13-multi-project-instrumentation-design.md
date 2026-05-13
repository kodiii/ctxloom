# Multi-Project Instrumentation Design (v1.1.1)

**Status:** Approved
**Target release:** v1.1.1 (patch)
**Branch:** `feat/multi-project-instrumentation`
**Related:** Issue #70 / PR #71 (v1.1.0 multi-project feature)

## Goal

Turn the lights on for the multi-project `project_root` flow shipped in v1.1.0. Today the only Sentry capture site is `main().catch()` and the only PostHog events are six license-funnel events. The entire MCP server runtime, including the new resolver / state manager / first-touch indexing paths, is silent. v1.1.1 adds:

- **PostHog:** state-transition events for project resolution, first-touch indexing, eviction, alias registration, kill switch, plus 10% sampled `tool_dispatched` events.
- **Sentry:** capture every non-structured error thrown during MCP tool dispatch, plus indexing failures and dispose-path failures. Sentry release tagging + sourcemap upload so stack traces resolve to TypeScript source.

## Non-goals (deferred to follow-up PRs — see end of doc)

- Distinct-id schema migration (still `os.hostname()` for v1.1.1 to preserve existing license funnels)
- Dashboard-side telemetry (browser SDK in `apps/dashboard/`)

## Decisions locked in

| Decision | Choice |
|---|---|
| Project-path PII | SHA-256 the canonical absolute path, send first 16 hex chars as `project_id` |
| Event volume | State transitions only, plus 10% sampled tool dispatch |
| Sentry scope | All non-structured errors thrown during tool dispatch, plus indexing/dispose failures |
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
| `tool_dispatched` | 10% sampled, after successful tool dispatch | `project_id`, `tool` (the tool name), `duration_ms` |

### Sampling

`tool_dispatched` uses `Math.random() < 0.1`. No per-tool deduplication, no per-session bias — straight uniform sampling. Acceptable for "which tools are popular" coarse-grained analytics; not suitable for precise per-call counting.

## Error capture sites

Five Sentry capture sites are added or extended:

| Site | File | Behavior |
|---|---|---|
| `CallToolRequest` handler catch | `src/server.ts` | Existing block catches resolver errors and returns structured XML. Extend: if the thrown error is **not** a structured resolver error (`alias_not_found` / `no_default_project` / `project_root_not_found` / `project_root_unreadable`), call `captureError(err, { tool, project_id? })`. Structured errors are user mistakes and stay Sentry-free. |
| `ensureVectorsInitialized()` rejection | `packages/core/src/server/ProjectState.ts` | `captureError(err, { project_id, phase: 'vector_init' })` before re-throwing. Existing reject path is preserved. |
| `initGraph()` failure | `src/server.ts` | `captureError(err, { project_id, phase: 'graph_init' })` in the `getGraph` getter promise. |
| `evictLRU()` dispose path | `packages/core/src/server/ProjectStateManager.ts` | Wrap the fire-and-forget `Promise.resolve(this.onDispose(state)).catch(...)` with a Sentry catch: `captureError(err, { project_id, phase: 'dispose' })`. |
| `main().catch()` | `src/index.ts` | Existing — unchanged. |

## Sentry release tagging + sourcemap upload

The bundle currently ships as a single minified file. Sentry shows `/dist/index.cjs:42:1337` for every frame — barely useful. v1.1.1 adds:

1. `tsup.config.ts` — enable `sourcemap: true` for production builds.
2. `prepublishOnly` script chain gains a step: `sentry-cli releases new $VERSION && sentry-cli releases files $VERSION upload-sourcemaps ./dist --url-prefix '~/dist'`.
3. Telemetry payload at error time — embed `release: $VERSION` from `package.json` as a Sentry tag so traces map to the right release.
4. New GitHub Actions secret: `SENTRY_AUTH_TOKEN`. `SENTRY_ORG` and `SENTRY_PROJECT` go in `package.json` as constants since they're not secret.
5. The Sentry CLI install is gated on the secret being present — local `npm publish` without `SENTRY_AUTH_TOKEN` logs a warning and continues, so contributor publishes don't break.

The `release` tag on the captured error becomes the primary correlation key between PostHog (which sees `properties.release`) and Sentry (which sees `tags.release`).

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
| `packages/core/src/license/telemetry.ts` | Expand `TelemetryEvent` union; add `release` to all event payloads; add `release` Sentry tag |
| `packages/core/src/server/ProjectState.ts` | Sentry capture in `ensureVectorsInitialized()` reject path |
| `packages/core/src/server/ProjectStateManager.ts` | Fire `project_evicted`; wrap dispose with Sentry catch |
| `src/server.ts` | Fire `project_resolved`, `multi_project_active`, `project_first_touch`, `tool_dispatched`, `kill_switch_active`; Sentry capture in handler catch for non-structured errors and `initGraph` failures |
| `src/index.ts` | Fire `alias_registered` after successful registration |
| `packages/core/src/index.ts` | Export `hashProjectRoot`, `EmittedOnceTracker` |
| `tsup.config.ts` | Enable `sourcemap: true`; add `define` for `__RELEASE__` from package.json |
| `package.json` | Add `prepublishOnly` step for sourcemap upload; add `sentry-cli` to devDependencies; add `sentryOrg` / `sentryProject` constants |
| `.github/workflows/*.yml` (if present) | Pass `SENTRY_AUTH_TOKEN` through to publish step |

Approximate footprint: ~200 LoC source, ~100 LoC tests, ~30 LoC build config, 1 new GitHub Actions secret.

## Testing

| Test file | What it verifies |
|---|---|
| `tests/HashProjectRoot.test.ts` | Same path → same hash; different paths → different hashes; 16 hex chars; trailing-slash normalization |
| `tests/EmittedOnceTracker.test.ts` | First call returns `true`, subsequent calls return `false`; per-key isolation; `reset()` clears |
| `tests/TelemetryOptOut.test.ts` | `CTXLOOM_NO_TELEMETRY=1` short-circuits both `track` and `captureError` (verify or extend) |
| `tests/MultiProjectTelemetry.test.ts` | Mock `track`/`captureError`; drive `ProjectStateManager` + `resolveOrDefault` through real flows; assert event names and property shape; no real network |
| Existing 715 tests | Must stay green |

Mocking strategy: use Vitest's `vi.mock('@ctxloom/core', ...)` to replace `track` and `captureError` with spies. No network in tests.

## Error handling

The instrumentation itself must never break the CLI:

- `track()` / `captureError()` are already fire-and-forget — they catch all internals.
- `hashProjectRoot()` is pure CPU and synchronous — cannot throw under normal use, but the call sites still wrap in `try`/`catch` and fall back to `'unknown'` if it somehow does.
- Sentry CLI failure during `prepublishOnly` is non-fatal — the publish proceeds without sourcemaps and logs a warning.

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

---

## Open assumptions

These are assumptions I'm making without verifying. Flag if any are wrong:

1. **The PostHog free tier covers expected v1.1.1 volume.** Estimate: 5–20 state events/session + ~10 sampled tool_dispatched/session, across an estimated install base. Free tier is 1M events/month — should be comfortable.
2. **Sentry release tagging works with tsup-bundled CommonJS output.** Sentry CLI supports both ESM and CJS sourcemaps; the bundle is currently CJS per `tsup.config.ts`. Will verify during implementation; if not, fall back to manual sourcemap upload.
3. **`SENTRY_AUTH_TOKEN` can be added to the repo's GitHub Actions secrets.** Requires the user to run `gh secret set SENTRY_AUTH_TOKEN` once.
