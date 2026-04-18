/**
 * Minimal structured logger for ctxloom.
 *
 * Writes JSON lines to stderr (to avoid polluting MCP stdio transport on stdout).
 * Log level is controlled by the LOG_LEVEL environment variable:
 *   debug | info | warn | error  (default: info)
 *
 * Format: {"ts":"2026-01-01T00:00:00.000Z","level":"info","msg":"...","context":"..."}
 */
const LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
function getConfiguredLevel() {
    const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
    return (raw in LEVELS ? raw : 'info');
}
function write(level, msg, extra) {
    if (LEVELS[level] < LEVELS[getConfiguredLevel()])
        return;
    const entry = {
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
    debug: (msg, extra) => write('debug', msg, extra),
    info: (msg, extra) => write('info', msg, extra),
    warn: (msg, extra) => write('warn', msg, extra),
    error: (msg, extra) => write('error', msg, extra),
};
//# sourceMappingURL=logger.js.map