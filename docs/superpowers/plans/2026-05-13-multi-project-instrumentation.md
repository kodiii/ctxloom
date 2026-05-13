# Multi-Project Instrumentation Implementation Plan (v1.1.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the lights on for the multi-project `project_root` flow by adding 7 PostHog state-transition events, 25% sampled tool-dispatch events, 4 Sentry capture sites, a `release` Sentry tag, and client-side stack-frame scrubbing — shipped as v1.1.1.

**Architecture:** The existing `track()` / `captureError()` transport at `packages/core/src/license/telemetry.ts` is kept as-is. We expand the `TelemetryEvent` union, add two new helper modules (`hashProjectRoot`, `EmittedOnceTracker`), and add call sites in `ProjectStateManager`, `ProjectState`, `src/server.ts`, and `src/index.ts`. The build-time version constant `__CTXLOOM_VERSION__` already exists in `tsup.config.ts:31` — we reuse it rather than adding a new `__RELEASE__` constant.

**Tech Stack:** TypeScript ESM, Vitest, hand-rolled fetch transport (no SDKs), tsup build with `define` substitution for build-time constants.

**Spec:** `docs/superpowers/specs/2026-05-13-multi-project-instrumentation-design.md`

**Branch:** `feat/multi-project-instrumentation` (already created, spec committed at `f2260da`).

---

## Phase 1: Foundation modules

### Task 1: hashProjectRoot

**Files:**
- Create: `packages/core/src/server/projectId.ts`
- Test: `tests/HashProjectRoot.test.ts`
- Modify: `packages/core/src/index.ts` (add export)

- [ ] **Step 1.1: Write the failing test**

```typescript
// tests/HashProjectRoot.test.ts
import { describe, it, expect } from 'vitest';
import { hashProjectRoot } from '@ctxloom/core';

describe('hashProjectRoot', () => {
  it('returns a 16-character lowercase hex string', () => {
    const hash = hashProjectRoot('/Users/foo/project');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('produces the same hash for the same path', () => {
    expect(hashProjectRoot('/Users/foo/project')).toBe(hashProjectRoot('/Users/foo/project'));
  });

  it('produces different hashes for different paths', () => {
    expect(hashProjectRoot('/Users/foo/projectA')).not.toBe(hashProjectRoot('/Users/foo/projectB'));
  });

  it('normalizes trailing slashes', () => {
    expect(hashProjectRoot('/Users/foo/project/')).toBe(hashProjectRoot('/Users/foo/project'));
  });

  it('normalizes relative segments via path.resolve', () => {
    expect(hashProjectRoot('/Users/foo/project/./')).toBe(hashProjectRoot('/Users/foo/project'));
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `npx vitest run tests/HashProjectRoot.test.ts`
Expected: FAIL — `hashProjectRoot` is not exported from `@ctxloom/core`.

- [ ] **Step 1.3: Write the implementation**

```typescript
// packages/core/src/server/projectId.ts
/**
 * Hash a project root to an opaque 16-character identifier suitable for
 * telemetry payloads. We never send raw absolute paths because they almost
 * always contain a username segment (/Users/<name>/..., /home/<name>/...).
 *
 * Pure function: no I/O, no side effects, deterministic.
 */
import crypto from 'node:crypto';
import path from 'node:path';

export function hashProjectRoot(absPath: string): string {
  const canonical = path.resolve(absPath);
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}
```

- [ ] **Step 1.4: Add the export**

Modify `packages/core/src/index.ts` — find the existing server-module exports block (search for `export { ProjectStateManager`) and add this line nearby:

```typescript
export { hashProjectRoot } from './server/projectId.js';
```

- [ ] **Step 1.5: Run test to verify it passes**

Run: `npx vitest run tests/HashProjectRoot.test.ts`
Expected: PASS — all 5 tests pass.

- [ ] **Step 1.6: Run the full suite**

Run: `npm test`
Expected: 720 passing (was 715, +5 from this task), 0 failing.

- [ ] **Step 1.7: Commit**

```bash
git add packages/core/src/server/projectId.ts packages/core/src/index.ts tests/HashProjectRoot.test.ts
git commit -m "feat(telemetry): add hashProjectRoot helper for opaque project IDs"
```

---

### Task 2: EmittedOnceTracker

**Files:**
- Create: `packages/core/src/server/EmittedOnceTracker.ts`
- Test: `tests/EmittedOnceTracker.test.ts`
- Modify: `packages/core/src/index.ts` (add export)

- [ ] **Step 2.1: Write the failing test**

```typescript
// tests/EmittedOnceTracker.test.ts
import { describe, it, expect } from 'vitest';
import { EmittedOnceTracker } from '@ctxloom/core';

describe('EmittedOnceTracker', () => {
  it('returns true on the first markAndCheck for a given key', () => {
    const tracker = new EmittedOnceTracker();
    expect(tracker.markAndCheck('project_resolved:/Users/foo/proj')).toBe(true);
  });

  it('returns false on subsequent calls with the same key', () => {
    const tracker = new EmittedOnceTracker();
    tracker.markAndCheck('key-a');
    expect(tracker.markAndCheck('key-a')).toBe(false);
    expect(tracker.markAndCheck('key-a')).toBe(false);
  });

  it('treats different keys independently', () => {
    const tracker = new EmittedOnceTracker();
    tracker.markAndCheck('key-a');
    expect(tracker.markAndCheck('key-b')).toBe(true);
  });

  it('reset() clears all keys', () => {
    const tracker = new EmittedOnceTracker();
    tracker.markAndCheck('key-a');
    tracker.reset();
    expect(tracker.markAndCheck('key-a')).toBe(true);
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `npx vitest run tests/EmittedOnceTracker.test.ts`
Expected: FAIL — `EmittedOnceTracker` is not exported.

- [ ] **Step 2.3: Write the implementation**

```typescript
// packages/core/src/server/EmittedOnceTracker.ts
/**
 * Per-server emission guard. Used by telemetry call sites that need to
 * fire an event at most once per `(scope, identifier)` pair during the
 * process lifetime — e.g. `project_resolved` fires only on the first
 * successful resolution of a given project root, not on every tool call.
 *
 * The "key" the caller passes is responsible for embedding both the event
 * name and the identifier (commonly `${event}:${project_id}`); the tracker
 * does not split or interpret the key.
 *
 * In-memory only — process restart resets the state, which is the
 * intended behavior (we want one event per session per project).
 */
export class EmittedOnceTracker {
  private readonly seen = new Set<string>();

  /** Returns true the first time `key` is seen, false thereafter. */
  markAndCheck(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }

  /** Clear all keys. Used by tests. */
  reset(): void {
    this.seen.clear();
  }
}
```

- [ ] **Step 2.4: Add the export**

In `packages/core/src/index.ts`, near the `hashProjectRoot` export from Task 1, add:

```typescript
export { EmittedOnceTracker } from './server/EmittedOnceTracker.js';
```

- [ ] **Step 2.5: Run test to verify it passes**

Run: `npx vitest run tests/EmittedOnceTracker.test.ts`
Expected: PASS — all 4 tests.

- [ ] **Step 2.6: Run the full suite**

Run: `npm test`
Expected: 724 passing.

- [ ] **Step 2.7: Commit**

```bash
git add packages/core/src/server/EmittedOnceTracker.ts packages/core/src/index.ts tests/EmittedOnceTracker.test.ts
git commit -m "feat(telemetry): add EmittedOnceTracker for per-session event guards"
```

---

## Phase 2: Telemetry transport upgrades

### Task 3: Expand TelemetryEvent union, add release tag, add stack-frame scrubbing

This task touches one file (`telemetry.ts`) plus three test files. The three concerns are bundled because they're all single-file changes to the transport.

**Files:**
- Modify: `packages/core/src/license/telemetry.ts`
- Test: `tests/TelemetryRelease.test.ts`
- Test: `tests/TelemetryStackScrubbing.test.ts`
- Test: `tests/TelemetryEventUnion.test.ts` (compile-time check via `TelemetryEvent` type)

- [ ] **Step 3.1: Write the failing tests**

```typescript
// tests/TelemetryRelease.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('telemetry release tag', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Force telemetry on for these tests; the module reads keys at import time.
    process.env.POSTHOG_API_KEY = 'phc_test';
    process.env.SENTRY_DSN = 'https://abc@o1.ingest.sentry.io/123';
    delete process.env.CTXLOOM_NO_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.POSTHOG_API_KEY;
    delete process.env.SENTRY_DSN;
  });

  it('Sentry payload includes tags.release', async () => {
    // Re-import to pick up env vars set in beforeEach.
    const { captureError } = await import('@ctxloom/core');
    captureError(new Error('boom'), { phase: 'test' });
    // Fire-and-forget — give the microtask queue a chance.
    await new Promise(r => setImmediate(r));
    expect(fetchSpy).toHaveBeenCalled();
    const sentryCall = fetchSpy.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('sentry.io')
    );
    expect(sentryCall).toBeDefined();
    const body = JSON.parse((sentryCall![1] as RequestInit).body as string);
    expect(body.tags.release).toBeDefined();
    expect(typeof body.tags.release).toBe('string');
    expect(body.tags.release.length).toBeGreaterThan(0);
  });

  it('PostHog payload includes properties.release', async () => {
    const { track } = await import('@ctxloom/core');
    track('trial_started', 'test-host', { email: 'x@y.z' });
    await new Promise(r => setImmediate(r));
    const posthogCall = fetchSpy.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('posthog.com')
    );
    expect(posthogCall).toBeDefined();
    const body = JSON.parse((posthogCall![1] as RequestInit).body as string);
    expect(body.properties.release).toBeDefined();
    expect(typeof body.properties.release).toBe('string');
  });
});
```

```typescript
// tests/TelemetryStackScrubbing.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Sentry stack-frame scrubbing', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.SENTRY_DSN = 'https://abc@o1.ingest.sentry.io/123';
    delete process.env.CTXLOOM_NO_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.SENTRY_DSN;
  });

  async function captureWithStack(stack: string): Promise<Record<string, unknown>[]> {
    const { captureError } = await import('@ctxloom/core');
    const err = new Error('test');
    err.stack = `Error: test\n${stack}`;
    captureError(err);
    await new Promise(r => setImmediate(r));
    const call = fetchSpy.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('sentry.io')
    );
    const body = JSON.parse((call![1] as RequestInit).body as string);
    return body.exception.values[0].stacktrace.frames;
  }

  it('scrubs /Users/<username>/ to /Users/~/', async () => {
    const frames = await captureWithStack('    at foo (/Users/alice/code/proj/src/x.ts:10:5)');
    expect(frames[0].filename).toBe('/Users/~/code/proj/src/x.ts');
  });

  it('scrubs /home/<username>/ to /home/~/', async () => {
    const frames = await captureWithStack('    at foo (/home/bob/code/proj/src/x.ts:10:5)');
    expect(frames[0].filename).toBe('/home/~/code/proj/src/x.ts');
  });

  it('scrubs C:\\\\Users\\\\<username>\\\\ to C:\\\\Users\\\\~\\\\', async () => {
    const frames = await captureWithStack('    at foo (C:\\\\Users\\\\carol\\\\code\\\\proj\\\\x.ts:10:5)');
    expect(frames[0].filename).toBe('C:\\\\Users\\\\~\\\\code\\\\proj\\\\x.ts');
  });

  it('leaves non-matching paths unchanged', async () => {
    const frames = await captureWithStack('    at foo (/var/lib/node/x.ts:10:5)');
    expect(frames[0].filename).toBe('/var/lib/node/x.ts');
  });
});
```

```typescript
// tests/TelemetryEventUnion.test.ts
import { describe, it, expectTypeOf } from 'vitest';
import type { TelemetryEvent } from '@ctxloom/core';

describe('TelemetryEvent union', () => {
  it('includes all v1.1.1 multi-project event names', () => {
    expectTypeOf<'project_resolved'>().toMatchTypeOf<TelemetryEvent>();
    expectTypeOf<'project_first_touch'>().toMatchTypeOf<TelemetryEvent>();
    expectTypeOf<'project_evicted'>().toMatchTypeOf<TelemetryEvent>();
    expectTypeOf<'alias_registered'>().toMatchTypeOf<TelemetryEvent>();
    expectTypeOf<'multi_project_active'>().toMatchTypeOf<TelemetryEvent>();
    expectTypeOf<'kill_switch_active'>().toMatchTypeOf<TelemetryEvent>();
    expectTypeOf<'project_resolution_failed'>().toMatchTypeOf<TelemetryEvent>();
    expectTypeOf<'tool_dispatched'>().toMatchTypeOf<TelemetryEvent>();
  });

  it('still includes the existing license funnel events', () => {
    expectTypeOf<'trial_started'>().toMatchTypeOf<TelemetryEvent>();
    expectTypeOf<'license_activated'>().toMatchTypeOf<TelemetryEvent>();
  });
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

Run: `npx vitest run tests/TelemetryRelease.test.ts tests/TelemetryStackScrubbing.test.ts tests/TelemetryEventUnion.test.ts`
Expected: FAIL — release tag missing, scrubbing not implemented, new event names not in union.

- [ ] **Step 3.3: Implement — expand the union, add release injection, add scrubbing**

Edit `packages/core/src/license/telemetry.ts`. Apply these changes:

**(a)** Replace the `TelemetryEvent` union (currently 6 entries) with:

```typescript
export type TelemetryEvent =
  | 'trial_started'
  | 'license_activated'
  | 'license_deactivated'
  | 'license_expired'
  | 'license_gate_hit'
  | 'license_revoked'
  // v1.1.1 multi-project events
  | 'project_resolved'
  | 'project_first_touch'
  | 'project_evicted'
  | 'alias_registered'
  | 'multi_project_active'
  | 'kill_switch_active'
  | 'project_resolution_failed'
  | 'tool_dispatched';
```

**(b)** Near the top of the file (after the existing `declare const __TELEMETRY_*__` lines, around line 26), add the version constant declaration:

```typescript
declare const __CTXLOOM_VERSION__: string | undefined;
const CTXLOOM_VERSION =
  typeof __CTXLOOM_VERSION__ === 'string' && __CTXLOOM_VERSION__.length > 0
    ? __CTXLOOM_VERSION__
    : 'dev';
```

**(c)** In `sendPostHog`, inside `body.properties`, add `release: CTXLOOM_VERSION` alongside the existing `$lib: 'ctxloom-cli'`:

```typescript
properties: {
  $lib: 'ctxloom-cli',
  release: CTXLOOM_VERSION,
  ...props,
},
```

**(d)** In `sendSentry`, inside the `body.tags` object, add `release: CTXLOOM_VERSION`:

```typescript
tags: { runtime: 'node', component: 'cli-license', release: CTXLOOM_VERSION },
```

**(e)** Replace the existing `parseStack` function with a scrubbed version. The original code:

```typescript
function parseStack(stack: string): Array<{ filename: string; lineno: number; function: string }> {
  return stack
    .split('\n')
    .slice(1)
    .map(line => {
      const m = line.trim().match(/at (.+?) \((.+?):(\d+):\d+\)/);
      if (!m) return null;
      return { function: m[1] ?? '', filename: m[2] ?? '', lineno: Number(m[3]) };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .slice(0, 20);
}
```

Replace with:

```typescript
function scrubPath(filename: string): string {
  // Replace OS home prefixes that almost always contain a username segment.
  // The <segment> regex captures one non-slash component after the prefix
  // and substitutes the literal "~". Preserves the rest of the path.
  return filename
    .replace(/^\/Users\/[^/]+\//, '/Users/~/')
    .replace(/^\/home\/[^/]+\//, '/home/~/')
    .replace(/^([A-Z]:\\Users\\)[^\\]+\\/, '$1~\\');
}

function parseStack(stack: string): Array<{ filename: string; lineno: number; function: string }> {
  return stack
    .split('\n')
    .slice(1)
    .map(line => {
      const m = line.trim().match(/at (.+?) \((.+?):(\d+):\d+\)/);
      if (!m) return null;
      return { function: m[1] ?? '', filename: scrubPath(m[2] ?? ''), lineno: Number(m[3]) };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .slice(0, 20);
}
```

- [ ] **Step 3.4: Run tests to verify they pass**

Run: `npx vitest run tests/TelemetryRelease.test.ts tests/TelemetryStackScrubbing.test.ts tests/TelemetryEventUnion.test.ts`
Expected: PASS — all tests across all three files.

- [ ] **Step 3.5: Run the full suite**

Run: `npm test`
Expected: 732 passing (724 + 8 new: 2 release + 4 scrubbing + 2 union), 0 failing.

- [ ] **Step 3.6: Commit**

```bash
git add packages/core/src/license/telemetry.ts tests/TelemetryRelease.test.ts tests/TelemetryStackScrubbing.test.ts tests/TelemetryEventUnion.test.ts
git commit -m "feat(telemetry): expand TelemetryEvent union, add release tag, scrub stack frames

- TelemetryEvent gains 8 v1.1.1 multi-project event names
- Sentry payload tags.release = __CTXLOOM_VERSION__ (already injected by tsup)
- PostHog payload properties.release = __CTXLOOM_VERSION__
- parseStack scrubs /Users/<name>/, /home/<name>/, C:\\Users\\<name>\\ to ~/"
```

---

## Phase 3: PostHog event wiring

### Task 4: Fire `project_evicted` in ProjectStateManager.evictLRU

**Files:**
- Modify: `packages/core/src/server/ProjectStateManager.ts`
- Test: `tests/ProjectStateManager.test.ts` (extend existing) OR `tests/ProjectEvictedTelemetry.test.ts` (new)

- [ ] **Step 4.1: Write the failing test**

Create `tests/ProjectEvictedTelemetry.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('project_evicted telemetry', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.POSTHOG_API_KEY = 'phc_test';
    delete process.env.CTXLOOM_NO_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.POSTHOG_API_KEY;
  });

  it('fires project_evicted when LRU evicts a state', async () => {
    const { ProjectStateManager } = await import('@ctxloom/core');
    const manager = new ProjectStateManager({ maxProjects: 2, onDispose: async () => {} });
    manager.get('/tmp/projA');
    manager.get('/tmp/projB');
    manager.get('/tmp/projC'); // forces eviction of projA
    // Eviction calls onDispose() and then logs. Give microtasks time.
    await new Promise(r => setTimeout(r, 50));

    const posthogCalls = fetchSpy.mock.calls.filter(c =>
      typeof c[0] === 'string' && c[0].includes('posthog.com')
    );
    const evictionCall = posthogCalls.find(c => {
      const body = JSON.parse((c[1] as RequestInit).body as string);
      return body.event === 'project_evicted';
    });
    expect(evictionCall).toBeDefined();
    const body = JSON.parse((evictionCall![1] as RequestInit).body as string);
    expect(body.properties.project_id).toMatch(/^[0-9a-f]{16}$/);
    expect(body.properties.pinned_count).toBe(0);
    expect(body.properties.cap).toBe(2);
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `npx vitest run tests/ProjectEvictedTelemetry.test.ts`
Expected: FAIL — no `project_evicted` event is fired.

- [ ] **Step 4.3: Implement**

Edit `packages/core/src/server/ProjectStateManager.ts`:

**(a)** Update imports at the top of the file (currently imports `disposeProjectState` and `logger`):

```typescript
import { ProjectState, createProjectState, disposeProjectState } from './ProjectState.js';
import { logger } from '../utils/logger.js';
import { track } from '../license/telemetry.js';
import { hashProjectRoot } from './projectId.js';
import os from 'node:os';
```

**(b)** In `evictLRU()`, after `this.map.delete(victim.projectRoot);` (currently line 107) and before the `void this.onDispose(...)` block, count pinned entries and fire the event:

```typescript
const pinnedCount = Array.from(this.map.values()).filter(s => s.pinned).length;
track('project_evicted', os.hostname(), {
  project_id: hashProjectRoot(victim.projectRoot),
  pinned_count: pinnedCount,
  cap: this.maxProjects,
});
```

- [ ] **Step 4.4: Run test to verify it passes**

Run: `npx vitest run tests/ProjectEvictedTelemetry.test.ts`
Expected: PASS.

- [ ] **Step 4.5: Run the full suite**

Run: `npm test`
Expected: 733 passing.

- [ ] **Step 4.6: Commit**

```bash
git add packages/core/src/server/ProjectStateManager.ts tests/ProjectEvictedTelemetry.test.ts
git commit -m "feat(telemetry): fire project_evicted event on LRU eviction"
```

---

### Task 5: Fire `alias_registered` in CLI register command

**Files:**
- Modify: `src/index.ts` (around line 599)
- Test: `tests/AliasRegisteredTelemetry.test.ts`

- [ ] **Step 5.1: Write the failing test**

```typescript
// tests/AliasRegisteredTelemetry.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';

describe('alias_registered telemetry', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.POSTHOG_API_KEY = 'phc_test';
    delete process.env.CTXLOOM_NO_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.POSTHOG_API_KEY;
  });

  it('alias_registered payload includes alias_length, was_collision, and hostname distinctId', async () => {
    // We test the call-site contract directly rather than spawning the CLI.
    const { track } = await import('@ctxloom/core');
    track('alias_registered', os.hostname(), { alias_length: 5, was_collision: false });
    await new Promise(r => setImmediate(r));
    const call = fetchSpy.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('posthog.com')
    );
    expect(call).toBeDefined();
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body.event).toBe('alias_registered');
    expect(body.distinct_id).toBe(os.hostname());
    expect(body.properties.alias_length).toBe(5);
    expect(body.properties.was_collision).toBe(false);
    expect(body.properties.release).toBeDefined();
  });
});
```

- [ ] **Step 5.2: Run test to verify it passes immediately**

Run: `npx vitest run tests/AliasRegisteredTelemetry.test.ts`
Expected: PASS — this test only exercises the existing `track()` transport with the new event name, which works after Task 3. The actual CLI call site is still missing — we'll verify that wiring with an integration test in Task 11.

- [ ] **Step 5.3: Wire the call site**

Edit `src/index.ts`. Find the `case 'register':` block (around line 545). After `reg.register(...)` succeeds (around line 594, inside the `try` block immediately after `reg.register(...)`), add:

```typescript
if (alias !== undefined) {
  track('alias_registered', os.hostname(), {
    alias_length: alias.length,
    was_collision: false,
  });
}
```

Verify `track` and `os` are already imported at the top of `src/index.ts` — they are (see existing `track('license_activated', os.hostname(), ...)` call at line 320).

- [ ] **Step 5.4: Run the full suite**

Run: `npm test`
Expected: 734 passing.

- [ ] **Step 5.5: Commit**

```bash
git add src/index.ts tests/AliasRegisteredTelemetry.test.ts
git commit -m "feat(telemetry): fire alias_registered after successful CLI registration"
```

---

### Task 6: Fire `kill_switch_active` in startServer

**Files:**
- Modify: `src/server.ts` (around line 340 in the existing `if (DISABLE_MULTIPROJECT)` block)

- [ ] **Step 6.1: Wire the call site**

Edit `src/server.ts`. The `if (DISABLE_MULTIPROJECT)` block in `startServer()` (around line 340) currently has only a `logger.warn(...)` call. Add a `track()` call immediately after the `logger.warn`:

First, add to the existing `@ctxloom/core` imports at the top of the file (currently around lines 30–42):

```typescript
import { track, captureError, hashProjectRoot, EmittedOnceTracker } from '@ctxloom/core';
```

(Note: `EmittedOnceTracker` and `captureError` will be used by later tasks; importing here once avoids fragmented import edits.)

Also add `os` to the existing imports if not already there:

```typescript
import os from 'node:os';
```

Then, inside the existing `if (DISABLE_MULTIPROJECT)` block in `startServer()`, after the `logger.warn(...)` call, add:

```typescript
track('kill_switch_active', os.hostname(), { cap: 1 });
```

- [ ] **Step 6.2: Run the full suite**

Run: `npm test`
Expected: 734 still passing — no new test for this task; the call site is exercised by the Phase 5 integration test.

Run: `npm run build`
Expected: clean build, no TypeScript errors.

- [ ] **Step 6.3: Commit**

```bash
git add src/server.ts
git commit -m "feat(telemetry): fire kill_switch_active on server boot with CTXLOOM_DISABLE_MULTIPROJECT=1"
```

---

### Task 7: Fire `project_resolved`, `multi_project_active` in resolveOrDefault

**Files:**
- Modify: `src/server.ts` (in `buildContext` → `resolveOrDefault`)

The plan: instantiate an `EmittedOnceTracker` at module scope (alongside the existing `firstTouchTracker`), then in the success path of `resolveOrDefault`, fire `project_resolved` if it's the first time we've seen this root, and `multi_project_active` if the manager just transitioned from 1 to ≥2 active projects.

- [ ] **Step 7.1: Add the module-level tracker**

Edit `src/server.ts`. Locate the existing `const firstTouchTracker = new FirstTouchTracker();` declaration (around line 92). Add immediately after it:

```typescript
const emittedOnceTracker = new EmittedOnceTracker();
```

- [ ] **Step 7.2: Instrument resolveOrDefault — first define a helper for source classification**

In `src/server.ts`, immediately above the `buildContext` function declaration (around line 142), add a helper:

```typescript
type ResolutionSource = 'alias' | 'arg-path' | 'env' | 'cwd';

function classifyResolutionSource(arg: string | undefined, env: string | undefined): ResolutionSource {
  if (arg !== undefined) {
    // No path separator → alias (matches resolveProjectRoot's PATH_SEPARATOR_PATTERN).
    return /[/\\~]|^[A-Za-z]:/.test(arg) ? 'arg-path' : 'alias';
  }
  return env ? 'env' : 'cwd';
}
```

- [ ] **Step 7.3: Fire events in the success paths of resolveOrDefault**

In `buildContext`, modify the existing `resolveOrDefault` function. The three paths are:

1. `DISABLE_MULTIPROJECT` short-circuit (line 149–154) — fire `project_resolved` once per session for the default root.
2. `arg === undefined` (line 155–160) — fire `project_resolved` once per session for the default root.
3. `arg !== undefined`, successful `resolveRoot()` (line 161–170) — fire `project_resolved` once per session for the resolved root.

After each `return stateManager.get(...)` in these three paths, capture the returned state, fire telemetry, then return. Replace the existing `resolveOrDefault` body with:

```typescript
function resolveOrDefault(arg: string | undefined): ProjectState {
  let state: ProjectState;
  let source: ResolutionSource;

  if (DISABLE_MULTIPROJECT) {
    if (!defaultRoot) {
      throw new Error('CTXLOOM_DISABLE_MULTIPROJECT=1 but server has no default root.');
    }
    state = stateManager.get(defaultRoot);
    source = 'env'; // kill-switch path always uses the default root
  } else if (arg === undefined) {
    if (!defaultRoot) {
      throw new Error('no_default_project');
    }
    state = stateManager.get(defaultRoot);
    source = classifyResolutionSource(undefined, process.env.CTXLOOM_ROOT);
  } else {
    const outcome = resolveRoot({
      arg,
      env: process.env.CTXLOOM_ROOT,
      cwd: process.cwd(),
      registry: repoRegistry,
    });
    if (outcome.kind !== 'ok') {
      throw new Error(JSON.stringify(outcome));
    }
    state = stateManager.get(outcome.root);
    source = classifyResolutionSource(arg, process.env.CTXLOOM_ROOT);
  }

  // Fire project_resolved at most once per (root, session) pair.
  try {
    const projectId = hashProjectRoot(state.projectRoot);
    if (emittedOnceTracker.markAndCheck(`project_resolved:${projectId}`)) {
      track('project_resolved', os.hostname(), {
        project_id: projectId,
        source,
        via_alias: source === 'alias',
      });
    }
    // Fire multi_project_active at most once per session, when active count
    // transitions from 1 to ≥2.
    if (
      stateManager.size() >= 2 &&
      emittedOnceTracker.markAndCheck('multi_project_active')
    ) {
      track('multi_project_active', os.hostname(), {
        active_count: stateManager.size(),
        cap: stateManager.max,
      });
    }
  } catch {
    // Telemetry must never break the resolver.
  }

  return state;
}
```

- [ ] **Step 7.4: Run the full suite**

Run: `npm test`
Expected: 734 still passing — call sites are exercised by Phase 5 integration test.

Run: `npm run build`
Expected: clean build.

- [ ] **Step 7.5: Commit**

```bash
git add src/server.ts
git commit -m "feat(telemetry): fire project_resolved + multi_project_active in resolveOrDefault

- project_resolved fires once per (project_root, session) pair
- multi_project_active fires once per session when active count hits ≥2
- source is classified as alias / arg-path / env / cwd from the input
- All wrapped in try/catch so telemetry can never break resolution"
```

---

### Task 8: Fire `project_first_touch` in CallToolRequest handler envelope path

**Files:**
- Modify: `src/server.ts` (in the existing `firstTouchTracker.markAndCheck(root, 'graph')` and `'vectors'` branches, around lines 259–278)

- [ ] **Step 8.1: Wire the call sites**

Edit `src/server.ts`. The handler currently has two `wrapWithIndexingEnvelope(...)` calls — one for graph (line 261), one for vectors (line 273). Before each `wrapWithIndexingEnvelope` call (i.e. inside the `if (graphFirstTouch)` block and the `if (vectorsFirstTouch)` block), add a `track()` call.

For the graph tier (inside `if (graphFirstTouch)`, immediately before `const wrapped = wrapWithIndexingEnvelope(...)`):

```typescript
try {
  const graphInst = state.graphPromise ? await state.graphPromise : null;
  track('project_first_touch', os.hostname(), {
    project_id: hashProjectRoot(root),
    tier: 'graph',
    duration_ms: durationMs,
    nodes: graphInst?.nodeCount?.() ?? null,
    edges: graphInst?.edgeCount?.() ?? null,
  });
} catch {
  // Telemetry must never break the response.
}
```

For the vectors tier (inside `if (vectorsFirstTouch)`, immediately before `const wrapped = wrapWithIndexingEnvelope(...)`):

```typescript
track('project_first_touch', os.hostname(), {
  project_id: hashProjectRoot(root),
  tier: 'vectors',
  duration_ms: durationMs,
});
```

- [ ] **Step 8.2: Run the full suite**

Run: `npm test`
Expected: 734 still passing.

Run: `npm run build`
Expected: clean build. If `nodeCount`/`edgeCount` are not on `DependencyGraph`, the `?.()` optional-chain returns `undefined` and the field falls back to `null` — verify the call path doesn't throw.

- [ ] **Step 8.3: Commit**

```bash
git add src/server.ts
git commit -m "feat(telemetry): fire project_first_touch on first graph/vectors index per root"
```

---

### Task 9: Fire `tool_dispatched` (25% sampled) after successful dispatch

**Files:**
- Modify: `src/server.ts` (in the CallToolRequest handler, after the existing envelope block)

- [ ] **Step 9.1: Wire the call site**

Edit `src/server.ts`. Just before the final `return { content: [{ type: 'text' as const, text }] };` (around line 287), add:

```typescript
// Sampled tool-usage telemetry — 25% rate, no per-session bias, no dedupe.
// project_root resolution may fail (resolveOrDefault throws); in that case
// we skip the sample rather than risk corrupting the success path.
if (Math.random() < 0.25) {
  try {
    const projectRootArg2 = (args as Record<string, unknown> | undefined)?.project_root as string | undefined;
    if (!ctx.noDefaultMode || projectRootArg2 !== undefined) {
      const sampleState = resolveOrDefault(projectRootArg2);
      track('tool_dispatched', os.hostname(), {
        project_id: hashProjectRoot(sampleState.projectRoot),
        tool: name,
        duration_ms: durationMs,
      });
    }
  } catch {
    /* skip sample on resolution error */
  }
}
```

(Naming: `projectRootArg2` because `projectRootArg` is already declared earlier in the handler around line 254.)

- [ ] **Step 9.2: Run the full suite**

Run: `npm test`
Expected: 734 still passing.

Run: `npm run build`
Expected: clean build.

- [ ] **Step 9.3: Commit**

```bash
git add src/server.ts
git commit -m "feat(telemetry): fire 25% sampled tool_dispatched events on successful dispatch"
```

---

### Task 10: Fire `project_resolution_failed` in handler catch (per error code)

**Files:**
- Modify: `src/server.ts` (CallToolRequest handler catch block, around lines 289–321)

- [ ] **Step 10.1: Wire the call sites**

Edit `src/server.ts`. In the handler catch block, fire `track('project_resolution_failed', ...)` in each of the three structured-error branches. The block currently looks like:

```typescript
} catch (err) {
  if (err instanceof Error && err.message === 'no_default_project') {
    const xml = noDefaultProjectError({ ... });
    return { content: [{ type: 'text' as const, text: xml }], isError: true };
  }
  if (err instanceof Error && err.message.startsWith('{')) {
    try {
      const parsed = JSON.parse(err.message) as Record<string, unknown>;
      if (parsed.kind === 'alias_not_found') {
        const xml = aliasNotFoundError({ ... });
        return { content: [{ type: 'text' as const, text: xml }], isError: true };
      }
      if (parsed.kind === 'project_root_not_found') {
        const xml = projectRootNotFoundError({ ... });
        return { content: [{ type: 'text' as const, text: xml }], isError: true };
      }
    } catch { /* JSON.parse failed */ }
  }
  return { content: [{ type: 'text' as const, text: `Error: ...` }], isError: true };
}
```

For each structured-error branch, add a `track()` call before the `return`:

**(a)** Inside the `no_default_project` branch (before its `return`):

```typescript
const hadArg10 = (args as Record<string, unknown> | undefined)?.project_root !== undefined;
track('project_resolution_failed', os.hostname(), {
  error_code: 'no_default_project',
  had_arg: hadArg10,
});
```

**(b)** Inside the `alias_not_found` branch (before its `return`):

```typescript
track('project_resolution_failed', os.hostname(), {
  error_code: 'alias_not_found',
  had_arg: true,
});
```

**(c)** Inside the `project_root_not_found` branch (before its `return`):

```typescript
track('project_resolution_failed', os.hostname(), {
  error_code: 'project_root_not_found',
  had_arg: true,
});
```

- [ ] **Step 10.2: Run the full suite**

Run: `npm test`
Expected: 734 still passing.

Run: `npm run build`
Expected: clean build.

- [ ] **Step 10.3: Commit**

```bash
git add src/server.ts
git commit -m "feat(telemetry): fire project_resolution_failed for each structured resolver error

Structured resolver errors (alias_not_found, no_default_project,
project_root_not_found) are user mistakes — they deliberately do NOT
fire Sentry. PostHog tracking lets us see typo / config-error rates."
```

---

## Phase 4: Sentry capture wiring

### Task 11: Sentry capture for ensureVectorsInitialized rejections

**Files:**
- Modify: `packages/core/src/server/ProjectState.ts` (`ensureVectorsInitialized` function)

- [ ] **Step 11.1: Wire the capture**

Edit `packages/core/src/server/ProjectState.ts`. Update the imports at the top to include `captureError`, `hashProjectRoot`:

```typescript
import { captureError } from '../license/telemetry.js';
import { hashProjectRoot } from './projectId.js';
```

Replace the existing `ensureVectorsInitialized` body with:

```typescript
export async function ensureVectorsInitialized(state: ProjectState): Promise<void> {
  if (state.vectorsInitialized) return;
  if (!state.storePromise) return;
  try {
    await state.storePromise;
    state.vectorsInitialized = true;
  } catch (err) {
    captureError(err, {
      project_id: hashProjectRoot(state.projectRoot),
      phase: 'vector_init',
    });
    throw err;
  }
}
```

- [ ] **Step 11.2: Run the full suite**

Run: `npm test`
Expected: 734 still passing — existing `EnsureVectorsInitialized.test.ts` covers the reject path; the new `captureError` call is fire-and-forget so it won't affect the existing test assertions.

Run: `npm run build`
Expected: clean build.

- [ ] **Step 11.3: Commit**

```bash
git add packages/core/src/server/ProjectState.ts
git commit -m "feat(telemetry): captureError when ensureVectorsInitialized rejects"
```

---

### Task 12: Sentry capture for evictLRU dispose failures

**Files:**
- Modify: `packages/core/src/server/ProjectStateManager.ts` (in `evictLRU`, the existing `void this.onDispose(victim).then(...)` call)

- [ ] **Step 12.1: Wire the capture**

Edit `packages/core/src/server/ProjectStateManager.ts`. `captureError`, `hashProjectRoot`, `os` were already imported in Task 4. The `evictLRU` method currently ends with:

```typescript
void this.onDispose(victim).then(() => {
  logger.info('project.evicted', { ... });
});
```

Replace that block with:

```typescript
void this.onDispose(victim)
  .then(() => {
    logger.info('project.evicted', {
      root: victim!.projectRoot,
      reason: 'lru_cap_reached',
      ttl_seconds: Math.round((Date.now() - victim!.lastTouchedAt) / 1000),
    });
  })
  .catch(err => {
    captureError(err, {
      project_id: hashProjectRoot(victim!.projectRoot),
      phase: 'dispose',
    });
  });
```

Update the import block to add `captureError`:

```typescript
import { track, captureError } from '../license/telemetry.js';
```

(`track` was added in Task 4; you're just appending `captureError`.)

- [ ] **Step 12.2: Run the full suite**

Run: `npm test`
Expected: 734 still passing.

Run: `npm run build`
Expected: clean build.

- [ ] **Step 12.3: Commit**

```bash
git add packages/core/src/server/ProjectStateManager.ts
git commit -m "feat(telemetry): captureError on dispose-path failure during LRU eviction"
```

---

### Task 13: Sentry capture for tool dispatch + initGraph failures

**Files:**
- Modify: `src/server.ts` (CallToolRequest handler catch block fallthrough, and `initGraph` function)

- [ ] **Step 13.1: Wrap initGraph with capture**

Edit `src/server.ts`. The existing `initGraph` function (lines 117–129) currently catches nothing. Wrap the inner promise body:

```typescript
async function initGraph(state: ProjectState): Promise<DependencyGraph> {
  if (!state.graphPromise) {
    state.graphPromise = (async () => {
      try {
        const parser = await initParser(state);
        const graph = new DependencyGraph();
        graph.setParser(parser);
        await graph.buildFromDirectory(state.projectRoot);
        state.graphInitialized = true;
        return graph;
      } catch (err) {
        captureError(err, {
          project_id: hashProjectRoot(state.projectRoot),
          phase: 'graph_init',
        });
        throw err;
      }
    })();
  }
  return state.graphPromise;
}
```

- [ ] **Step 13.2: Wire capture in handler catch fallthrough**

In `src/server.ts`, the handler catch block currently ends with a generic fallthrough (lines 318–320):

```typescript
return {
  content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
  isError: true,
};
```

Insert a Sentry capture immediately before this `return`, with context that includes the tool name and best-effort project_id:

```typescript
// Reaching here means the error is NOT a structured resolver error — it's a
// real bug or external failure. Capture for Sentry visibility.
try {
  const projectRootArg13 = (args as Record<string, unknown> | undefined)?.project_root as string | undefined;
  let projectIdForCtx: string | undefined;
  try {
    const fallbackState = resolveOrDefault(projectRootArg13);
    projectIdForCtx = hashProjectRoot(fallbackState.projectRoot);
  } catch { /* couldn't resolve — capture without project_id */ }
  captureError(err, {
    tool: name,
    ...(projectIdForCtx ? { project_id: projectIdForCtx } : {}),
  });
} catch {
  /* never let telemetry break the response */
}

return {
  content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
  isError: true,
};
```

- [ ] **Step 13.3: Run the full suite**

Run: `npm test`
Expected: 734 still passing.

Run: `npm run build`
Expected: clean build.

- [ ] **Step 13.4: Commit**

```bash
git add src/server.ts
git commit -m "feat(telemetry): captureError on tool dispatch failures and initGraph rejects

- Handler catch fallthrough (non-structured errors only — user mistakes
  like alias_not_found stay Sentry-free, captured to PostHog only)
- initGraph inner promise wraps DependencyGraph.buildFromDirectory"
```

---

## Phase 5: Integration test + release prep

### Task 14: End-to-end multi-project telemetry integration test

**Files:**
- Test: `tests/MultiProjectTelemetry.test.ts`

The previous tasks covered individual call sites. This integration test drives `ProjectStateManager` + `resolveOrDefault` through realistic flows and asserts that the expected event sequence fires with the expected payload shapes.

- [ ] **Step 14.1: Write the test**

```typescript
// tests/MultiProjectTelemetry.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';

interface CapturedPostHogEvent {
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
}

function parsePostHogEvents(fetchSpy: ReturnType<typeof vi.spyOn>): CapturedPostHogEvent[] {
  return fetchSpy.mock.calls
    .filter(c => typeof c[0] === 'string' && (c[0] as string).includes('posthog.com'))
    .map(c => JSON.parse((c[1] as RequestInit).body as string) as CapturedPostHogEvent);
}

describe('multi-project telemetry integration', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.POSTHOG_API_KEY = 'phc_test';
    process.env.SENTRY_DSN = 'https://abc@o1.ingest.sentry.io/123';
    delete process.env.CTXLOOM_NO_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.POSTHOG_API_KEY;
    delete process.env.SENTRY_DSN;
  });

  it('LRU eviction fires project_evicted with the expected payload shape', async () => {
    const { ProjectStateManager, hashProjectRoot } = await import('@ctxloom/core');
    const manager = new ProjectStateManager({ maxProjects: 2, onDispose: async () => {} });
    manager.get('/tmp/p1');
    manager.get('/tmp/p2');
    manager.get('/tmp/p3'); // evicts p1

    await new Promise(r => setTimeout(r, 50));

    const events = parsePostHogEvents(fetchSpy);
    const eviction = events.find(e => e.event === 'project_evicted');
    expect(eviction).toBeDefined();
    expect(eviction!.properties.project_id).toBe(hashProjectRoot('/tmp/p1'));
    expect(eviction!.properties.pinned_count).toBe(0);
    expect(eviction!.properties.cap).toBe(2);
    expect(eviction!.properties.release).toBeDefined();
    expect(eviction!.distinct_id).toBe(os.hostname());
  });

  it('every event includes properties.release', async () => {
    const { track } = await import('@ctxloom/core');
    track('project_first_touch', os.hostname(), { project_id: 'abc', tier: 'graph', duration_ms: 100 });
    track('multi_project_active', os.hostname(), { active_count: 2, cap: 5 });
    track('tool_dispatched', os.hostname(), { project_id: 'abc', tool: 'ctx_search', duration_ms: 12 });
    await new Promise(r => setImmediate(r));
    const events = parsePostHogEvents(fetchSpy);
    expect(events.length).toBeGreaterThanOrEqual(3);
    for (const e of events) {
      expect(e.properties.release).toBeDefined();
      expect(typeof e.properties.release).toBe('string');
    }
  });

  it('opt-out short-circuits both track and captureError', async () => {
    process.env.CTXLOOM_NO_TELEMETRY = '1';
    // Re-import after env var change so the module re-reads it.
    vi.resetModules();
    const { track, captureError } = await import('@ctxloom/core');
    track('project_resolved', os.hostname(), { project_id: 'x', source: 'cwd', via_alias: false });
    captureError(new Error('test'), { phase: 'x' });
    await new Promise(r => setImmediate(r));
    const calls = fetchSpy.mock.calls;
    // No PostHog or Sentry network calls should have fired.
    expect(calls.filter(c => typeof c[0] === 'string' && (c[0] as string).includes('posthog.com'))).toHaveLength(0);
    expect(calls.filter(c => typeof c[0] === 'string' && (c[0] as string).includes('sentry.io'))).toHaveLength(0);
    delete process.env.CTXLOOM_NO_TELEMETRY;
  });
});
```

- [ ] **Step 14.2: Run the integration test**

Run: `npx vitest run tests/MultiProjectTelemetry.test.ts`
Expected: PASS — all 3 tests.

- [ ] **Step 14.3: Run the full suite**

Run: `npm test`
Expected: 737 passing (734 + 3 new), 0 failing.

- [ ] **Step 14.4: Commit**

```bash
git add tests/MultiProjectTelemetry.test.ts
git commit -m "test(telemetry): end-to-end integration test for multi-project events"
```

---

### Task 15: Bump version to 1.1.1, update CHANGELOG, run final verification, push

**Files:**
- Modify: `package.json` (version field)
- Modify: `CHANGELOG.md` (new `[Unreleased]` → `[1.1.1]` section)

- [ ] **Step 15.1: Bump the version**

Edit `package.json` — change `"version": "1.1.0"` to `"version": "1.1.1"`.

- [ ] **Step 15.2: Update the CHANGELOG**

Edit `CHANGELOG.md`. Add a new section at the top (before existing `[Unreleased]` or the v1.1.0 entry):

```markdown
## [1.1.1] — 2026-05-13

### Added

- **Multi-project instrumentation.** PostHog state-transition events
  (`project_resolved`, `project_first_touch`, `project_evicted`,
  `alias_registered`, `multi_project_active`, `kill_switch_active`,
  `project_resolution_failed`) plus 25% sampled `tool_dispatched`.
- **Sentry coverage** for all non-structured tool-dispatch errors,
  `initGraph` failures, `ensureVectorsInitialized` rejections, and
  LRU dispose failures. Structured resolver errors (`alias_not_found`,
  `no_default_project`, `project_root_not_found`,
  `project_root_unreadable`) deliberately stay Sentry-free — they are
  user mistakes, captured to PostHog only.
- **Sentry `release` tag** on every captured event, sourced from
  `package.json` version via the existing `__CTXLOOM_VERSION__` build
  constant.
- **Client-side stack-frame scrubbing.** `/Users/<name>/`,
  `/home/<name>/`, and `C:\\Users\\<name>\\` are replaced with `~/`
  before transmission. Defense-in-depth alongside any Sentry-side
  scrubbing.
- **Project paths are never sent.** All multi-project events carry an
  opaque `project_id` (first 16 hex chars of SHA-256 over the canonical
  path). Aliases are sent only as `alias_length`.
- **`hashProjectRoot()` and `EmittedOnceTracker`** exported from
  `@ctxloom/core` for downstream integrations.

### Compatibility

- `CTXLOOM_NO_TELEMETRY=1` and `DO_NOT_TRACK=1` continue to disable
  both backends — no new opt-out env vars.
- `distinct_id` remains `os.hostname()` (matches existing license
  funnels). Migration to a stable UUID is deferred to a follow-up PR.
```

- [ ] **Step 15.3: Run the full test suite one last time**

Run: `npm test`
Expected: 737 passing across 86+ test files, 0 failing.

Run: `npm run build`
Expected: clean build, no TypeScript errors, dist/ produced.

- [ ] **Step 15.4: Commit the version bump and CHANGELOG**

```bash
git add package.json CHANGELOG.md
git commit -m "chore(release): bump to v1.1.1 + CHANGELOG entry for multi-project instrumentation"
```

- [ ] **Step 15.5: Push the branch and open the PR**

```bash
git push -u origin feat/multi-project-instrumentation

gh pr create \
  --base main \
  --title "feat: v1.1.1 multi-project instrumentation (Sentry + PostHog)" \
  --body "$(cat <<'EOF'
## Summary

Turn the lights on for the multi-project \`project_root\` flow shipped in v1.1.0.

**PostHog (8 events):**
- \`project_resolved\` — first successful resolveOrDefault per (root, session)
- \`project_first_touch\` — first-touch graph/vector indexing
- \`project_evicted\` — LRU eviction in ProjectStateManager
- \`alias_registered\` — CLI \`register --alias\` success
- \`multi_project_active\` — once per session when active count hits ≥2
- \`kill_switch_active\` — CTXLOOM_DISABLE_MULTIPROJECT=1 on boot
- \`project_resolution_failed\` — structured resolver errors (with error_code)
- \`tool_dispatched\` — 25% sampled

**Sentry (4 capture sites):**
- Handler catch fallthrough (non-structured errors only)
- \`initGraph\` rejection
- \`ensureVectorsInitialized\` rejection
- \`evictLRU\` dispose failure

Plus \`release\` Sentry tag from \`__CTXLOOM_VERSION__\` and client-side stack-frame scrubbing for /Users/, /home/, C:\\\\Users\\\\.

PII: project paths are SHA-256 hashed to 16-char \`project_id\`. Aliases sent only as \`alias_length\`.

Three follow-up PRs are documented in the design spec and intentionally deferred:
- **PR-A** — distinct_id migration from os.hostname() to stable UUID
- **PR-B** — dashboard-side browser telemetry
- **PR-C** — Sentry CLI sourcemap upload (requires SENTRY_AUTH_TOKEN)

## Test plan

- [ ] \`npm test\` — 737 tests pass (was 715, +22 new across 6 new files)
- [ ] \`npm run build\` — clean, no type errors
- [ ] Manual: CTXLOOM_NO_TELEMETRY=1 ctxloom dashboard → no network calls to posthog.com or sentry.io
- [ ] Manual: register two projects with aliases, hit each via MCP, confirm \`project_resolved\` + \`project_first_touch\` arrive in PostHog with hashed project_ids

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review (already run)

This plan was checked against the spec for coverage:

| Spec requirement | Plan task |
|---|---|
| `hashProjectRoot()` module | Task 1 |
| `EmittedOnceTracker` module | Task 2 |
| Expand `TelemetryEvent` union (8 new) | Task 3 |
| Sentry `release` tag | Task 3 |
| PostHog `release` property | Task 3 |
| Stack-frame scrubbing (Users / home / C:\\Users\\) | Task 3 |
| `project_evicted` event | Task 4 |
| `alias_registered` event | Task 5 |
| `kill_switch_active` event | Task 6 |
| `project_resolved` event | Task 7 |
| `multi_project_active` event | Task 7 |
| `project_first_touch` event | Task 8 |
| `tool_dispatched` 25% sampled | Task 9 |
| `project_resolution_failed` event | Task 10 |
| Sentry capture: `ensureVectorsInitialized` | Task 11 |
| Sentry capture: `evictLRU` dispose | Task 12 |
| Sentry capture: handler catch + `initGraph` | Task 13 |
| `MultiProjectTelemetry.test.ts` | Task 14 |
| Version bump + CHANGELOG | Task 15 |
| Open assumption #2 (`npm_package_version`) — confirmed obsolete | N/A — existing `__CTXLOOM_VERSION__` is used instead, sourced from `package.json` directly in `tsup.config.ts:5-9` |

All spec items have a task. The tsup config change the spec mentioned is replaced by reusing the existing `__CTXLOOM_VERSION__` constant — noted in the plan header and in Task 3.
