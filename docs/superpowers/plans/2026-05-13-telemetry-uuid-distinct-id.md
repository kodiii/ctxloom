# Telemetry UUID distinct_id Migration (PR-A, v1.1.2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Tasks are checkbox (`- [ ]`) tracked.

**Goal:** Replace `os.hostname()` as the PostHog/Sentry `distinct_id` with a stable v4 UUID persisted at `~/.ctxloom/distinct_id`. Drop the `distinctId` parameter from `track()` (breaking API change). On first run after migration, send PostHog `$create_alias` so historical hostname-keyed events stay attributed to the same user. Ship as v1.1.2.

**Why:** Hostname changes when users rename machines and differs across multiple machines per user — it's the wrong primary key. Industry-standard telemetry tooling (npm, VS Code, fish-shell) all use a random anonymous UUID.

**Branch:** `feat/telemetry-uuid-distinct-id`

**Tech Stack:** TypeScript ESM, Vitest, hand-rolled fetch transport, Node `crypto.randomUUID()`.

---

## Phase 1: DistinctIdStore module

### Task 1: Create `DistinctIdStore`

**Files:**
- Create: `packages/core/src/license/DistinctIdStore.ts`
- Test: `tests/DistinctIdStore.test.ts`
- Modify: `packages/core/src/index.ts` (export)

**Spec for `DistinctIdStore`:**
- `getOrCreateDistinctId()` — pure side-effect helper:
  - Path: `~/.ctxloom/distinct_id` (JSON: `{ "id": "<uuid>", "alias_pending"?: "<old_hostname>" }`)
  - If file exists and `id` is a valid UUID → return record as-is
  - Else generate v4 UUID, record current `os.hostname()` as `alias_pending`, mkdir + write with `mode: 0o600` atomically, return record
  - On any read/parse error: regenerate (don't crash telemetry)
- `markAliasSent(id)` — rewrites file with `alias_pending` removed
- Both sync (file I/O is tiny and only happens once per process boot ideally — we'll cache in telemetry.ts)

**Test cases:**
1. Returns the same id on two consecutive calls in a temp HOME
2. Creates a v4-shaped UUID (regex: `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`)
3. Sets `alias_pending` to `os.hostname()` on first create
4. Reuses existing id from disk if file present (no overwrite)
5. Regenerates if file is corrupt/unparseable
6. `markAliasSent` removes `alias_pending` from disk
7. File permissions are 0o600 (POSIX only; skip on Windows)

**Commit:** `feat(telemetry): add DistinctIdStore for stable anonymous distinct_id`

---

## Phase 2: Telemetry transport changes

### Task 2: Drop `distinctId` param + add `$create_alias` on first call

**File:** `packages/core/src/license/telemetry.ts`

**Spec:**
- `track(event: TelemetryEvent, props?: Record<string, unknown>): void` — no more `distinctId` parameter
- Module-level cache `let cachedDistinctId: { id: string; alias_pending?: string } | null = null`
- Lazy: first `track()` call loads via `getOrCreateDistinctId()`, caches, then proceeds
- If `cachedDistinctId.alias_pending` set: fire a separate PostHog `$create_alias` event with `distinct_id: cachedDistinctId.id` and `properties.alias: alias_pending`, then call `markAliasSent` to clear the flag. Best-effort — failure leaves `alias_pending` for next attempt.
- `captureError` signature unchanged (Sentry doesn't need a distinct_id; but include the UUID in `extra` for cross-referencing) — passes `{ ...context, distinct_id: cachedDistinctId?.id }` to Sentry payload
- `parseStack` and `scrubPath` unchanged

**Test cases (new file `tests/TelemetryDistinctId.test.ts`):**
1. `track('project_evicted', {...})` calls fetch with `body.distinct_id` matching the UUID, not the hostname
2. First `track()` after install fires both `$create_alias` (with `alias` = `os.hostname()` and `distinct_id` = new UUID) AND the original event
3. Second `track()` call does NOT re-fire `$create_alias`
4. Existing TelemetryRelease test still passes (signature shim if needed)

**Existing tests to update** (signature change is breaking):
- `tests/TelemetryRelease.test.ts` — drop `'test-host'` arg from `track('trial_started', 'test-host', { email })`
- `tests/AliasRegisteredTelemetry.test.ts` — drop `os.hostname()` arg
- `tests/ProjectEvictedTelemetry.test.ts` — assertion `body.distinct_id` should match the UUID, not `os.hostname()`
- `tests/MultiProjectTelemetry.test.ts` — same

**Commit:** `feat(telemetry)!: drop distinctId param, resolve UUID internally, alias-once on migration`

---

## Phase 3: Migrate call sites

### Task 3: Update all 15 call sites

Strip the `os.hostname()` argument from every `track()` call in:
- `src/index.ts` — 5 calls (lines 233, 277, 320, 356, 600)
- `src/server.ts` — 9 calls (lines 204, 214, 316, 339, 366, 382, 399, 412, 469)
- `packages/core/src/server/ProjectStateManager.ts` — 1 call (line 112)

If `os` is no longer used elsewhere in any of these files after the migration, remove the `import os from 'node:os'` line too (verify per file).

Run `npm test && npm run build` after each file. Expected: all tests pass with updated assertions from Task 2.

**Commit:** `refactor(telemetry): drop os.hostname() distinctId arg from all 15 call sites`

---

## Phase 4: Integration test + release

### Task 4: Integration test for migration flow

**File:** `tests/DistinctIdMigration.test.ts`

Test the full migration flow end-to-end:
1. Set `HOME` to a temp dir. Verify `~/.ctxloom/distinct_id` does not exist.
2. Call `track('project_evicted', { project_id: 'abc', pinned_count: 0, cap: 2 })`.
3. Assert two fetch calls fired: one with `event: '$create_alias'` and `properties.alias: os.hostname()`, one with `event: 'project_evicted'`.
4. Read the on-disk file: `alias_pending` field must be gone, `id` is a valid UUID.
5. Call `track()` again — assert only ONE fetch call this time (no second alias).

**Commit:** `test(telemetry): end-to-end migration + alias-once integration test`

### Task 5: Bump to v1.1.2, CHANGELOG, push PR

- `package.json`: `1.1.1` → `1.1.2`
- `CHANGELOG.md`: new `[1.1.2] — 2026-05-13` section noting the breaking-but-internal API change (track signature) and the migration behavior
- Run `npm test && npm run build` — clean
- Push branch, open PR with the body below

**PR body:**
```
## Summary

PR-A from the v1.1.1 deferred follow-ups. Migrates `distinct_id` from `os.hostname()` to a stable v4 UUID at `~/.ctxloom/distinct_id`, so users who rename their machines or work across multiple machines remain a single user in PostHog.

**Breaking (internal):** `track(event, distinctId, props)` → `track(event, props)`. Internal-only API; not exposed via the CLI surface.

**Migration:** On first `track()` after upgrade, ctxloom sends a PostHog `$create_alias` event to merge the user's old `os.hostname()` history with their new UUID. Best-effort and idempotent — if the alias call fails, it retries on the next event until success.

## Test plan
- [x] `npm test` — passes
- [x] `npm run build` — clean
- [ ] Manual: delete `~/.ctxloom/distinct_id`, run one `ctxloom` command with telemetry on, confirm both `$create_alias` and the event arrive in PostHog
- [ ] Manual: run a second `ctxloom` command, confirm only the event fires (no second alias)
```

**Commit:** `chore(release): bump to v1.1.2 + CHANGELOG entry for distinct_id UUID migration`

---

## Self-review

| Spec item | Plan task |
|---|---|
| DistinctIdStore module | Task 1 |
| track() signature change | Task 2 |
| `$create_alias` migration | Task 2 |
| captureError carries distinct_id in `extra` | Task 2 |
| All 15 call sites updated | Task 3 |
| Existing tests updated for new signature | Task 2 |
| Integration test | Task 4 |
| Version bump + release | Task 5 |
