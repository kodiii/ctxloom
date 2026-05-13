/**
 * Lightweight fire-and-forget telemetry.
 *
 * PostHog: tracks funnel events (trial_started, license_activated, etc.)
 * Sentry:  captures unexpected errors in the license module
 *
 * Telemetry is opt-out: set CTXLOOM_NO_TELEMETRY=1 (or DO_NOT_TRACK=1) to
 * disable both backends. Both are also no-ops when their env vars are
 * absent — never throws, never blocks user commands.
 *
 * Build-time injection: real users get the production keys baked in via
 * tsup's `define` substitution at build time (see tsup.config.ts). The
 * fallbacks here are intentionally empty so a fresh source build with no
 * keys configured is silent (development default), and so the public
 * source repo never contains live keys.
 */

import { getOrCreateDistinctId, markAliasSent, type DistinctIdRecord } from './DistinctIdStore.js';

const TELEMETRY_DISABLED =
  process.env['CTXLOOM_NO_TELEMETRY'] === '1' ||
  process.env['DO_NOT_TRACK'] === '1';

// __TELEMETRY_POSTHOG_KEY__ / __TELEMETRY_SENTRY_DSN__ are tsup `define`
// constants substituted at build time. In source they're typed as the
// empty string; the published bundle has the real values inlined.
declare const __TELEMETRY_POSTHOG_KEY__: string | undefined;
declare const __TELEMETRY_SENTRY_DSN__: string | undefined;
declare const __CTXLOOM_VERSION__: string | undefined;
const CTXLOOM_VERSION =
  typeof __CTXLOOM_VERSION__ === 'string' && __CTXLOOM_VERSION__.length > 0
    ? __CTXLOOM_VERSION__
    : 'dev';

const POSTHOG_HOST = 'https://eu.i.posthog.com';
const POSTHOG_KEY =
  process.env['POSTHOG_API_KEY'] ??
  (typeof __TELEMETRY_POSTHOG_KEY__ === 'string' ? __TELEMETRY_POSTHOG_KEY__ : '');
const SENTRY_DSN =
  process.env['SENTRY_DSN'] ??
  (typeof __TELEMETRY_SENTRY_DSN__ === 'string' ? __TELEMETRY_SENTRY_DSN__ : '');

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

// Module-level cache — populated on first track()/captureError() call.
// Reset across test runs by vi.resetModules().
let cachedDistinctId: DistinctIdRecord | null = null;

function resolveDistinctId(): DistinctIdRecord | null {
  if (cachedDistinctId) return cachedDistinctId;
  try {
    cachedDistinctId = getOrCreateDistinctId();
    return cachedDistinctId;
  } catch {
    return null;
  }
}

export function track(event: TelemetryEvent, props: Record<string, unknown> = {}): void {
  if (TELEMETRY_DISABLED || !POSTHOG_KEY) return;
  const record = resolveDistinctId();
  if (!record) return;
  void sendPostHog(event, record.id, props);
  if (record.alias_pending) {
    const oldAlias = record.alias_pending;
    void sendAlias(record.id, oldAlias);
  }
}

export function captureError(err: unknown, context: Record<string, unknown> = {}): void {
  if (TELEMETRY_DISABLED || !SENTRY_DSN) return;
  const record = resolveDistinctId();
  const augmented = record ? { ...context, distinct_id: record.id } : context;
  void sendSentry(err, augmented);
}

async function sendPostHog(
  event: string,
  distinctId: string,
  props: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch(`${POSTHOG_HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: POSTHOG_KEY,
        distinct_id: distinctId,
        event,
        properties: {
          $lib: 'ctxloom-cli',
          release: CTXLOOM_VERSION,
          ...props,
        },
      }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // fire-and-forget — telemetry must never break the CLI
  }
}

async function sendAlias(newId: string, oldAlias: string): Promise<void> {
  try {
    const res = await fetch(`${POSTHOG_HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: POSTHOG_KEY,
        distinct_id: newId,
        event: '$create_alias',
        properties: {
          $lib: 'ctxloom-cli',
          release: CTXLOOM_VERSION,
          alias: oldAlias,
        },
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      try { markAliasSent(); } catch { /* best-effort */ }
      if (cachedDistinctId) cachedDistinctId = { id: cachedDistinctId.id };
    }
  } catch {
    // fire-and-forget; retries on next track()
  }
}

async function sendSentry(err: unknown, context: Record<string, unknown>): Promise<void> {
  try {
    const dsn = parseDsn(SENTRY_DSN);
    if (!dsn) return;

    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;

    await fetch(`https://${dsn.host}/api/${dsn.projectId}/store/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${dsn.key}`,
      },
      body: JSON.stringify({
        event_id: crypto.randomUUID().replace(/-/g, ''),
        timestamp: new Date().toISOString(),
        platform: 'node',
        level: 'error',
        exception: {
          values: [
            {
              type: err instanceof Error ? err.constructor.name : 'Error',
              value: message,
              stacktrace: stack ? { frames: parseStack(stack) } : undefined,
            },
          ],
        },
        extra: context,
        tags: { runtime: 'node', component: 'cli-license', release: CTXLOOM_VERSION },
      }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // fire-and-forget
  }
}

function parseDsn(dsn: string): { host: string; key: string; projectId: string } | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, '');
    return { host: url.hostname, key: url.username, projectId };
  } catch {
    return null;
  }
}

function scrubPath(filename: string): string {
  return filename
    .replace(/^\/Users\/[^/]+\//, '/Users/~/')
    .replace(/^\/home\/[^/]+\//, '/home/~/')
    .replace(/^([A-Z]:\\\\Users\\\\)[^\\]+\\\\/, '$1~\\\\')
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
