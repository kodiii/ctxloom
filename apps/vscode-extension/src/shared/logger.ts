import * as vscode from 'vscode';
import { reportError } from './telemetry.js';

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  show(): void;
  dispose(): void;
}

export function createOutputLogger(): Logger {
  const channel = vscode.window.createOutputChannel('ctxloom');
  function ts(): string { return new Date().toISOString(); }
  function write(level: string, msg: string): void {
    channel.appendLine(`[${ts()}] ${level} ${msg}`);
  }
  return {
    info:  m => write('INFO', m),
    warn:  m => write('WARN', m),
    error: m => {
      write('ERROR', m);
      // Forward to Sentry when telemetry is enabled. `reportError`
      // resolves the level and silently no-ops otherwise.
      void reportError(new Error(m), { source: 'logger' });
    },
    show:  () => channel.show(true),
    dispose: () => channel.dispose(),
  };
}
