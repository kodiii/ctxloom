/**
 * Funnel milestone markers — one-shot gates for trial → activate → review
 * conversion events.
 *
 * Each function returns `true` the first time it's called for its scope
 * (global home dir for install, project dir for first review), and `false`
 * thereafter. The persistence model is identical to {@link shouldShowTelemetryNotice}:
 * a small marker file containing the ISO timestamp, mode 0o600.
 *
 * Why marker files instead of PostHog dedup?
 *
 *   PostHog can dedup by `distinct_id` after the fact, but that means every
 *   CLI invocation pays the network cost just for the server to throw the
 *   event away. Local markers stop the event at the source, which keeps
 *   PostHog ingest costs proportional to actual users (not invocations) and
 *   makes the "happened-once" semantic explicit in the codebase.
 *
 * Best-effort guarantee
 *
 *   If the marker write fails (disk full, read-only fs, permissions), the
 *   function returns `true` anyway. Better to over-fire the milestone a
 *   handful of times than to silently miss the first run for a user whose
 *   filesystem briefly hiccupped — the funnel metric matters more than the
 *   strict uniqueness invariant.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const INSTALL_MARKER = 'installed_at';
const FIRST_REVIEW_MARKER = 'first_review_at';

function writeMarker(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, new Date().toISOString(), { mode: 0o600 });
}

/**
 * Returns true the first time the CLI runs on this machine, false on every
 * subsequent invocation. Tracked via `~/.ctxloom/installed_at`.
 *
 * Fire `install_completed` from the call site when this returns true.
 */
export function shouldEmitInstallCompleted(home?: string): boolean {
  const root = home ?? os.homedir();
  const marker = path.join(root, '.ctxloom', INSTALL_MARKER);
  if (existsSync(marker)) return false;
  try {
    writeMarker(marker);
  } catch {
    // best-effort — fire the event anyway
  }
  return true;
}

/**
 * Returns true the first time `ctxloom review-suggest` (or any review-class
 * command) runs against this project, false afterwards. Tracked via
 * `<projectRoot>/.ctxloom/first_review_at`.
 *
 * Fire `first_review_run` from the call site when this returns true.
 */
export function shouldEmitFirstReviewRun(projectRoot: string): boolean {
  const marker = path.join(projectRoot, '.ctxloom', FIRST_REVIEW_MARKER);
  if (existsSync(marker)) return false;
  try {
    writeMarker(marker);
  } catch {
    // best-effort — fire the event anyway
  }
  return true;
}
