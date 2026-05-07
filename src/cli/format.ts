/**
 * format.ts — Tiny terminal-output toolkit for the ctxloom CLI.
 *
 * Wraps picocolors so we have a single place to define the visual
 * vocabulary (colors, icons, layouts) used across CLI commands —
 * trial / activate / status / setup / index / rules / etc.
 *
 * Design rules:
 *   1. Never used by the MCP server path (stdout there is JSON-RPC).
 *      All output here goes to either process.stdout (interactive
 *      messages) or process.stderr (errors / warnings).
 *   2. Respects NO_COLOR / FORCE_COLOR via picocolors auto-detection.
 *   3. Plain ASCII fallback when not a TTY (CI, redirected output) —
 *      icons degrade to plain characters, no ANSI escapes.
 *   4. Every helper returns a string; emitting is the caller's job.
 *      Keeps testing easy and lets callers compose output.
 */
import pc from 'picocolors';

const isTTY = (process.stdout as { isTTY?: boolean }).isTTY === true;

/** Icons — Unicode in a TTY, ASCII fallback otherwise. */
export const icons = {
  success: isTTY ? '✓' : 'OK',
  error: isTTY ? '✗' : 'X',
  warn: isTTY ? '⚠' : '!',
  info: isTTY ? '›' : '>',
  bullet: isTTY ? '•' : '*',
  arrow: isTTY ? '→' : '->',
  spinner: isTTY ? '⏳' : '...',
} as const;

/** Single-line styled status messages. */
export function success(msg: string): string {
  return `${pc.green(icons.success)} ${msg}`;
}
export function error(msg: string): string {
  return `${pc.red(icons.error)} ${msg}`;
}
export function warn(msg: string): string {
  return `${pc.yellow(icons.warn)} ${msg}`;
}
export function info(msg: string): string {
  return `${pc.cyan(icons.info)} ${msg}`;
}
export function pending(msg: string): string {
  return `${pc.dim(icons.spinner)} ${pc.dim(msg)}`;
}

/** Inline text styles — for embedding inside larger strings. */
export const style = {
  bold: (s: string): string => pc.bold(s),
  dim: (s: string): string => pc.dim(s),
  brand: (s: string): string => pc.magenta(s),
  highlight: (s: string): string => pc.cyan(s),
  link: (s: string): string => pc.cyan(pc.underline(s)),
  warn: (s: string): string => pc.yellow(s),
  error: (s: string): string => pc.red(s),
  success: (s: string): string => pc.green(s),
} as const;

/**
 * Render a section header — a title above a horizontal rule.
 *
 * Used at the start of multi-step commands to anchor the user.
 *
 *   ctxloom · Trial
 *   ────────────────────────────
 */
export function header(title: string): string {
  const brand = pc.bold(pc.magenta('ctxloom'));
  const sep = pc.dim('·');
  const rule = isTTY ? pc.dim('─'.repeat(Math.min(40, title.length + 12))) : '-'.repeat(40);
  return `\n  ${brand} ${sep} ${pc.bold(title)}\n  ${rule}\n`;
}

/**
 * Render a key/value table — aligned, dimmed labels, normal values.
 *
 *   Tier      Team
 *   Status    Active
 *   Expires   in 365 days · 2027-05-07
 *
 * Pass an empty string as the value to skip a row (lets callers
 * conditionally include rows without if-branching the call site).
 */
export function kvTable(rows: ReadonlyArray<readonly [string, string]>): string {
  const visibleRows = rows.filter(([, v]) => v !== '');
  if (visibleRows.length === 0) return '';
  const labelWidth = Math.max(...visibleRows.map(([k]) => k.length));
  const lines = visibleRows.map(([k, v]) => `  ${pc.dim(k.padEnd(labelWidth))}  ${v}`);
  return lines.join('\n');
}

/**
 * Render a "next step" panel — the call-to-action a command emits at
 * the end of a flow (e.g. "after activation, run `ctxloom setup`").
 */
export function nextStep(label: string, command: string): string {
  return `\n  ${pc.dim('Next:')} ${label}\n  ${pc.cyan('$')} ${pc.bold(command)}\n`;
}

/**
 * Render a friendly error block with optional remediation hints.
 *
 *   ✗ Activation failed.
 *
 *     • Double-check the key from your purchase email.
 *     • Or buy a license at https://ctxloom.com/pricing
 */
export function errorBlock(title: string, hints: ReadonlyArray<string> = []): string {
  const head = `\n${error(pc.bold(title))}\n`;
  if (hints.length === 0) return head;
  const body = hints.map(h => `  ${pc.dim(icons.bullet)} ${h}`).join('\n');
  return `${head}\n${body}\n`;
}
