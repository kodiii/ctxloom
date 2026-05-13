/**
 * First-run telemetry notice.
 *
 * Standard practice (Homebrew, npm, etc.): tell the user once, the first
 * time they run the CLI, that anonymous telemetry is enabled and how to
 * disable it. After the first run, persist a marker so we never bother
 * them again.
 *
 * The marker lives next to the other ctxloom state at
 * `~/.ctxloom/telemetry_notice_shown` (mode 0o600 for parity with the
 * distinct_id and license files).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function noticePath(home?: string): string {
  return path.join(home ?? os.homedir(), '.ctxloom', 'telemetry_notice_shown');
}

/**
 * Returns true the first time it's called on this machine; false on every
 * subsequent call. The "first time" is tracked via a marker file with mode
 * 0o600. Failure to read or write the marker is best-effort: on a write
 * failure we still return true (better to nag once an extra time than to
 * never tell the user at all).
 */
export function shouldShowTelemetryNotice(home?: string): boolean {
  const filePath = noticePath(home);
  if (existsSync(filePath)) return false;
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, new Date().toISOString(), { mode: 0o600 });
  } catch {
    // best-effort — still show the notice if we couldn't write the marker
  }
  return true;
}
