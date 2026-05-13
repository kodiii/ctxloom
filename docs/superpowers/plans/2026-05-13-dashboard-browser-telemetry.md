# Dashboard Browser Telemetry (PR-B, v1.1.3)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Tasks use `- [ ]`.

**Goal:** Wire `dashboard_loaded` (once per session) and `dashboard_page_viewed` (per route) browser events from the React dashboard. Hand-rolled `track()` + `captureError()` in the client; both go through a dashboard-server proxy that forwards to PostHog/Sentry via the existing `@ctxloom/core` transport — so the browser inherits the v1.1.2 UUID identity, alias-once migration, release tag, and `CTXLOOM_NO_TELEMETRY` opt-out for free.

**Branch:** `feat/dashboard-browser-telemetry`

**Non-goals (deferred):** project-switch tracking, search/graph-click events, React ErrorBoundary → Sentry. Explicitly out of scope for this PR.

---

## Architecture

```
Browser                       Dashboard server                    PostHog/Sentry
─────────                     ────────────────                    ──────────────
track(event, props)  ─POST─►  /api/telemetry/event   ─core.track─►  posthog.com
captureError(err)    ─POST─►  /api/telemetry/error   ─core.cap.─►  sentry.io
                              /api/telemetry/identity returns { enabled }
                              (false if CTXLOOM_NO_TELEMETRY=1)
```

- The browser fetches `/api/telemetry/identity` on app boot. If `enabled: false`, the client `track()` / `captureError()` short-circuit.
- The client does NOT receive the distinct_id — it just posts events to the proxy and the server resolves the identity via the existing module-level cache in `@ctxloom/core`.
- The proxy validates the event name against a hardcoded allowlist (NOT the full TelemetryEvent union — we don't want the browser firing `license_revoked`).

---

## Phase 1: Core type additions

### Task 1: Extend TelemetryEvent union with dashboard events

**File:** `packages/core/src/license/telemetry.ts`

Add to the union:
```typescript
  // v1.1.3 dashboard events
  | 'dashboard_loaded'
  | 'dashboard_page_viewed';
```

Add a type test to `tests/TelemetryEventUnion.test.ts`:
```typescript
expectTypeOf<'dashboard_loaded'>().toMatchTypeOf<TelemetryEvent>();
expectTypeOf<'dashboard_page_viewed'>().toMatchTypeOf<TelemetryEvent>();
```

**Commit:** `feat(telemetry): add dashboard_loaded + dashboard_page_viewed to TelemetryEvent union`

---

## Phase 2: Dashboard server proxy endpoints

### Task 2: `GET /api/telemetry/identity`

**File:** `apps/dashboard/server/routes/telemetry.ts` (new)

```typescript
import { Router } from 'express';

export function buildTelemetryRouter(): Router {
  const router = Router();

  router.get('/identity', (_req, res) => {
    const disabled =
      process.env.CTXLOOM_NO_TELEMETRY === '1' ||
      process.env.DO_NOT_TRACK === '1';
    res.json({ enabled: !disabled });
  });

  return router;
}
```

Wire in `apps/dashboard/server/index.ts`:
```typescript
import { buildTelemetryRouter } from './routes/telemetry.js';
// ...
app.use('/api/telemetry', buildTelemetryRouter());
```

### Task 3: `POST /api/telemetry/event`

Extend the same router with a POST handler:

```typescript
import { track } from '@ctxloom/core';

const DASHBOARD_EVENT_ALLOWLIST = new Set<string>([
  'dashboard_loaded',
  'dashboard_page_viewed',
]);

router.post('/event', express.json(), (req, res) => {
  const { event, props } = req.body ?? {};
  if (typeof event !== 'string' || !DASHBOARD_EVENT_ALLOWLIST.has(event)) {
    res.status(400).json({ error: 'invalid event' });
    return;
  }
  const sanitizedProps =
    props && typeof props === 'object' && !Array.isArray(props)
      ? (props as Record<string, unknown>)
      : {};
  track(event as 'dashboard_loaded' | 'dashboard_page_viewed', {
    ...sanitizedProps,
    surface: 'dashboard',
  });
  res.status(204).end();
});
```

The `surface: 'dashboard'` property lets us filter dashboard events from CLI events in PostHog.

### Task 4: `POST /api/telemetry/error`

```typescript
import { captureError } from '@ctxloom/core';

router.post('/error', express.json(), (req, res) => {
  const { message, stack, context } = req.body ?? {};
  if (typeof message !== 'string' || message.length === 0 || message.length > 2000) {
    res.status(400).json({ error: 'invalid message' });
    return;
  }
  const err = new Error(message);
  if (typeof stack === 'string' && stack.length > 0 && stack.length <= 10000) {
    err.stack = stack;
  }
  const sanitizedContext =
    context && typeof context === 'object' && !Array.isArray(context)
      ? (context as Record<string, unknown>)
      : {};
  captureError(err, { ...sanitizedContext, surface: 'dashboard' });
  res.status(204).end();
});
```

**Tests** (`apps/dashboard/tests/telemetry-routes.test.ts`):
- `GET /api/telemetry/identity` → `{ enabled: true }` by default, `{ enabled: false }` when `CTXLOOM_NO_TELEMETRY=1`
- `POST /api/telemetry/event` → 204 with valid event, 400 with bad event name, 400 with unknown event
- `POST /api/telemetry/error` → 204 with valid message, 400 with empty/oversize message

**Commit:** `feat(dashboard): server-side telemetry proxy endpoints (identity/event/error)`

---

## Phase 3: Client-side telemetry library

### Task 5: Create `apps/dashboard/client/src/lib/telemetry.ts`

```typescript
type DashboardEvent = 'dashboard_loaded' | 'dashboard_page_viewed';

let enabled: boolean | null = null;
let initPromise: Promise<void> | null = null;

async function ensureInit(): Promise<void> {
  if (enabled !== null) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const res = await fetch('/api/telemetry/identity', { credentials: 'same-origin' });
      if (!res.ok) {
        enabled = false;
        return;
      }
      const body = (await res.json()) as { enabled?: boolean };
      enabled = body.enabled === true;
    } catch {
      enabled = false;
    }
  })();
  return initPromise;
}

export async function track(event: DashboardEvent, props: Record<string, unknown> = {}): Promise<void> {
  await ensureInit();
  if (!enabled) return;
  try {
    await fetch('/api/telemetry/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ event, props }),
      // keepalive lets the request complete even if the user navigates away
      keepalive: true,
    });
  } catch {
    // fire-and-forget
  }
}

export async function captureError(err: unknown, context: Record<string, unknown> = {}): Promise<void> {
  await ensureInit();
  if (!enabled) return;
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  try {
    await fetch('/api/telemetry/error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ message, stack, context }),
      keepalive: true,
    });
  } catch {
    // fire-and-forget
  }
}
```

### Task 6: Wire `dashboard_loaded` and `dashboard_page_viewed`

**File:** `apps/dashboard/client/src/App.tsx`

Use `useEffect` for one-shot mount events and `useLocation` for route changes:

```typescript
import { useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { track } from './lib/telemetry';
// ... existing imports

function TelemetryGate() {
  const location = useLocation();

  useEffect(() => {
    void track('dashboard_loaded');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void track('dashboard_page_viewed', { path: location.pathname });
  }, [location.pathname]);

  return null;
}

export default function App() {
  return (
    <>
      <TelemetryGate />
      <Routes>
        {/* ...existing routes unchanged... */}
      </Routes>
    </>
  );
}
```

**Tests** (`apps/dashboard/tests/client-telemetry.test.tsx`):
- Mock `fetch`. Render `<App />` inside a `MemoryRouter`. Assert one `dashboard_loaded` POST and one `dashboard_page_viewed` POST on initial mount.
- Navigate to another route. Assert one additional `dashboard_page_viewed` with the new path.
- Mock `/api/telemetry/identity` returning `enabled: false`. Assert no `/event` calls.

**Commit:** `feat(dashboard): wire dashboard_loaded + dashboard_page_viewed client events`

---

## Phase 4: Release

### Task 7: Bump to v1.1.3, CHANGELOG, push PR

- `package.json`: `1.1.2` → `1.1.3`
- `CHANGELOG.md`: new `[1.1.3] — <date>` section
- Run `npm test && npm run build`
- Open PR

PR body template:

```
## Summary

PR-B from the v1.1.1 deferred follow-ups. The React dashboard now fires two PostHog events through a dashboard-server proxy:

- `dashboard_loaded` — once per session, on initial app mount
- `dashboard_page_viewed` — on every route change (path is the only payload)

**Architecture:** Browser → /api/telemetry/{event,error,identity} → @ctxloom/core transport → PostHog/Sentry. The browser doesn't see the PostHog write-key and doesn't know the distinct_id; it just posts events to its own server and the proxy resolves identity via the existing v1.1.2 UUID cache. Inherits the alias-once flow, release tag, opt-out, and scrubbing for free.

**Server endpoints:**
- `GET /api/telemetry/identity` — returns `{ enabled: boolean }` (false when CTXLOOM_NO_TELEMETRY=1 or DO_NOT_TRACK=1)
- `POST /api/telemetry/event` — validates against a 2-event allowlist (browser cannot fire license_*), forwards to core.track
- `POST /api/telemetry/error` — validates message length, forwards to core.captureError

Out of scope (intentionally deferred):
- Project-switch tracking
- Search and graph-node-click events
- React ErrorBoundary auto-capture

## Test plan
- [x] `npm test` — passes
- [x] `npm run build` — clean
- [ ] Manual: `ctxloom dashboard`, open the page, navigate between tabs, verify dashboard_loaded fires once + dashboard_page_viewed fires per route in PostHog
- [ ] Manual: `CTXLOOM_NO_TELEMETRY=1 ctxloom dashboard`, verify no network calls to /api/telemetry/event
```

**Commit:** `chore(release): bump to v1.1.3 + CHANGELOG entry for dashboard browser telemetry`
