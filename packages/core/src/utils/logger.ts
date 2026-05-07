/**
 * Minimal structured logger for ctxloom.
 *
 * Two output modes:
 *   - "json" (default, for MCP server): writes JSON lines to stderr — keeps
 *     the MCP stdio transport on stdout uncorrupted, gives downstream
 *     log processors structured fields.
 *   - "cli" (interactive commands): suppresses info/debug entirely;
 *     warn and error pretty-print as colored single-line messages so
 *     they blend with the styled CLI output (see src/cli/format.ts).
 *
 * Mode is auto-detected at write time via process.argv.length:
 *   - bare `ctxloom` (argv.length === 2)  → MCP server, JSON mode
 *   - `ctxloom <command>` (argv.length > 2) → interactive CLI, cli mode
 * Detection at write time (not module-load) means ESM import hoisting
 * can't race the toggle.
 *
 * Override: CTXLOOM_LOG_MODE=cli|json forces a specific mode.
 *
 * Log level is controlled by the LOG_LEVEL environment variable:
 *   debug | info | warn | error  (default: info)
 *
 * JSON format: {"ts":"...","level":"info","msg":"...",...extra}
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogMode = 'json' | 'cli';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
} as const;

function getConfiguredLevel(): LogLevel {
  const raw = (process.env['LOG_LEVEL'] ?? 'info').toLowerCase();
  return (raw in LEVELS ? raw : 'info') as LogLevel;
}

function getMode(): LogMode {
  // Explicit override wins.
  if (process.env['CTXLOOM_LOG_MODE'] === 'cli') return 'cli';
  if (process.env['CTXLOOM_LOG_MODE'] === 'json') return 'json';
  // Auto-detect: CLI argv = human-facing command; bare = MCP server.
  return process.argv.length > 2 ? 'cli' : 'json';
}

function isTTY(): boolean {
  return (process.stderr as { isTTY?: boolean }).isTTY === true;
}

function writeJson(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
  const entry: Record<string, unknown> = { ts: new Date().toISOString(), level, msg };
  if (extra) Object.assign(entry, extra);
  process.stderr.write(JSON.stringify(entry) + '\n');
}

function writeCli(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
  // CLI mode: suppress info/debug entirely (they're noise during
  // interactive commands). Warn/error pretty-print as a single colored
  // line that blends with the styled CLI output.
  if (level === 'debug' || level === 'info') return;

  const color = level === 'error' ? ANSI.red : ANSI.yellow;
  const icon = level === 'error' ? (isTTY() ? '✗' : 'X') : (isTTY() ? '⚠' : '!');
  const prefix = isTTY() ? `${color}${icon}${ANSI.reset}` : icon;

  let line = `  ${prefix} ${msg}`;
  if (extra && Object.keys(extra).length > 0) {
    const pairs = Object.entries(extra)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ');
    const dim = isTTY() ? `${ANSI.dim}${pairs}${ANSI.reset}` : pairs;
    line += ` ${dim}`;
  }
  process.stderr.write(line + '\n');
}

function write(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[getConfiguredLevel()]) return;
  if (getMode() === 'cli') {
    writeCli(level, msg, extra);
  } else {
    writeJson(level, msg, extra);
  }
}

export const logger = {
  debug: (msg: string, extra?: Record<string, unknown>): void => write('debug', msg, extra),
  info:  (msg: string, extra?: Record<string, unknown>): void => write('info',  msg, extra),
  warn:  (msg: string, extra?: Record<string, unknown>): void => write('warn',  msg, extra),
  error: (msg: string, extra?: Record<string, unknown>): void => write('error', msg, extra),
};
