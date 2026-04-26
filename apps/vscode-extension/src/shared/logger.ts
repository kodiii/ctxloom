import * as vscode from 'vscode';

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
    error: m => write('ERROR', m),
    show:  () => channel.show(true),
    dispose: () => channel.dispose(),
  };
}
