/**
 * Minimal structured logger for ctxloom.
 *
 * Writes JSON lines to stderr (to avoid polluting MCP stdio transport on stdout).
 * Log level is controlled by the LOG_LEVEL environment variable:
 *   debug | info | warn | error  (default: info)
 *
 * Format: {"ts":"2026-01-01T00:00:00.000Z","level":"info","msg":"...","context":"..."}
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export declare const logger: {
    debug: (msg: string, extra?: Record<string, unknown>) => void;
    info: (msg: string, extra?: Record<string, unknown>) => void;
    warn: (msg: string, extra?: Record<string, unknown>) => void;
    error: (msg: string, extra?: Record<string, unknown>) => void;
};
//# sourceMappingURL=logger.d.ts.map