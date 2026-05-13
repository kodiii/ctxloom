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

/**
 * Test-only: reset the module-level cache so tests can simulate fresh boots.
 * Vitest can also use `vi.resetModules()` instead.
 */
export function __resetForTests(): void {
  enabled = null;
  initPromise = null;
}
