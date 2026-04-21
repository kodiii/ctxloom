/**
 * Lightweight fire-and-forget telemetry.
 *
 * PostHog: tracks funnel events (trial_started, license_activated, etc.)
 * Sentry:  captures unexpected errors in the license module
 *
 * Both are no-ops when the env vars are absent. Never throws.
 */

const POSTHOG_HOST = 'https://eu.i.posthog.com';
const POSTHOG_KEY = process.env['POSTHOG_API_KEY'] ?? 'phc_xAusXPkHxhjhzRguxcyylLO6s5Hn1ZNNeThATGP4Dlf';
const SENTRY_DSN = process.env['SENTRY_DSN'] ?? 'https://e52f4c5fdc82eca82dadb4261e474069@o4508531702497280.ingest.de.sentry.io/4511256875368528';

export type TelemetryEvent =
  | 'trial_started'
  | 'license_activated'
  | 'license_deactivated'
  | 'license_expired'
  | 'license_gate_hit'
  | 'license_revoked';

export function track(
  event: TelemetryEvent,
  distinctId: string,
  props: Record<string, unknown> = {},
): void {
  if (!POSTHOG_KEY) return;
  void sendPostHog(event, distinctId, props);
}

export function captureError(err: unknown, context: Record<string, unknown> = {}): void {
  if (!SENTRY_DSN) return;
  void sendSentry(err, context);
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
          ...props,
        },
      }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // fire-and-forget — telemetry must never break the CLI
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
        tags: { runtime: 'node', component: 'cli-license' },
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
