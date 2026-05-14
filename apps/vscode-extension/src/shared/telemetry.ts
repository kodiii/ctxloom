/**
 * Extension-side telemetry adapter.
 *
 * Resolves the effective telemetry state from three layered sources,
 * in decreasing precedence:
 *   1. Universal opt-out env vars (CTXLOOM_NO_TELEMETRY=1, DO_NOT_TRACK=1)
 *   2. The VS Code setting `ctxloom.telemetry.enabled`
 *   3. The VS Code setting `ctxloom.telemetry.level`
 *
 * Forwards crash reports to `@ctxloom/core`'s captureError when the
 * resolved level is `error` or `all`. PostHog usage analytics from
 * the extension are reserved for a future change — `all` is currently
 * equivalent to `error` until that lands.
 *
 * Loading @ctxloom/core is best-effort: in environments where the CLI
 * tarball hasn't been downloaded yet, the import fails and we silently
 * no-op. We never block the UI on telemetry.
 */
import * as vscode from 'vscode';

export type TelemetryLevel = 'off' | 'error' | 'all';

export interface ResolvedTelemetry {
  /** Final level after applying env vars + settings. */
  level: TelemetryLevel;
  /** Set when an env var forced the level to `off`. UI shows a banner. */
  disabledByEnv?: { variable: 'CTXLOOM_NO_TELEMETRY' | 'DO_NOT_TRACK' };
}

export function resolveTelemetry(): ResolvedTelemetry {
  if (process.env['CTXLOOM_NO_TELEMETRY'] === '1') {
    return { level: 'off', disabledByEnv: { variable: 'CTXLOOM_NO_TELEMETRY' } };
  }
  if (process.env['DO_NOT_TRACK'] === '1') {
    return { level: 'off', disabledByEnv: { variable: 'DO_NOT_TRACK' } };
  }
  const cfg = vscode.workspace.getConfiguration('ctxloom');
  const enabled = cfg.get<boolean>('telemetry.enabled') ?? false;
  if (!enabled) return { level: 'off' };
  const raw = cfg.get<string>('telemetry.level') ?? 'off';
  const level: TelemetryLevel =
    raw === 'all' || raw === 'error' || raw === 'off' ? raw : 'off';
  return { level };
}

// Minimal structural type of what we actually call. Avoids a
// `typeof import('@ctxloom/core')` which trips TS1542 on a
// CommonJS-built extension importing an ESM-only package.
interface CoreLike {
  captureError(err: unknown, context?: Record<string, unknown>): void;
}

// Cached lazy-import promise. @ctxloom/core lives in the CLI tarball
// which is downloaded on first activation; before that, the require()
// fails. We retry on every call rather than caching the failure so
// telemetry comes online once the tarball lands.
let corePromise: Promise<CoreLike | null> | null = null;
async function loadCore(): Promise<CoreLike | null> {
  if (corePromise) return corePromise;
  corePromise = (async () => {
    try {
      const mod = (await import('@ctxloom/core')) as unknown as CoreLike;
      return mod;
    } catch {
      corePromise = null; // allow retry on next call
      return null;
    }
  })();
  return corePromise;
}

/**
 * Forward an extension crash to Sentry, respecting the resolved
 * telemetry state. No-op if telemetry is off or @ctxloom/core can't be
 * loaded. Never throws — telemetry must not be able to crash the
 * extension.
 */
export async function reportError(err: unknown, context: Record<string, unknown> = {}): Promise<void> {
  try {
    const state = resolveTelemetry();
    if (state.level === 'off') return;
    const core = await loadCore();
    if (!core) return;
    core.captureError(err, { ...context, component: 'vscode-extension' });
  } catch {
    // swallow — telemetry plumbing must never escape
  }
}
