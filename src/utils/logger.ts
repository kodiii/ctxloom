/**
 * Minimal structured logger for ContextMesh.
 *
 * Writes JSON lines to stderr (to avoid polluting MCP stdio transport on stdout).
 * Log level is controlled by the LOG_LEVEL environment variable:
 *   debug | info | warn | error  (default: info)
 *
 * Format: {"ts":"2026-01-01T00:00:00.000Z","level":"info","msg":"...","context":"..."}
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getConfiguredLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return (raw in LEVELS ? raw : 'info') as LogLevel;
}

function write(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[getConfiguredLevel()]) return;

  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
  };
  if (extra) {
    Object.assign(entry, extra);
  }

  process.stderr.write(JSON.stringify(entry) + '\n');
}

export const logger = {
  debug: (msg: string, extra?: Record<string, unknown>) => write('debug', msg, extra),
  info:  (msg: string, extra?: Record<string, unknown>) => write('info',  msg, extra),
  warn:  (msg: string, extra?: Record<string, unknown>) => write('warn',  msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => write('error', msg, extra),
};
