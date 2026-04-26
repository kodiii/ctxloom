import * as vscode from 'vscode';
import type { Logger } from '../shared/logger.js';

interface McpServerDefinition { type: 'stdio'; label: string; command: string; args: string[]; cwd?: string }

export interface McpBridgeDeps { cliPath: string; cwd: string; logger: Logger }

/**
 * Registers ctxloom as an MCP server with VS Code's experimental MCP API
 * (`vscode.lm.registerMcpServerProvider`, available in 1.95+). Falls back
 * silently when the API is missing.
 */
export class McpBridge {
  private disposable: vscode.Disposable | null = null;

  constructor(private readonly deps: McpBridgeDeps) {}

  register(): void {
    const lm = (vscode as unknown as { lm?: { registerMcpServerProvider?: (id: string, provider: { provideServers: () => McpServerDefinition[] }) => vscode.Disposable } }).lm;
    if (!lm || typeof lm.registerMcpServerProvider !== 'function') {
      this.deps.logger.info('MCP bridge requires VS Code ≥ 1.95 — feature skipped.');
      return;
    }
    this.disposable = lm.registerMcpServerProvider('ctxloom', {
      provideServers: () => [{
        type: 'stdio',
        label: 'ctxloom',
        command: this.deps.cliPath,
        args: [],
        cwd: this.deps.cwd,
      }],
    });
    this.deps.logger.info('MCP bridge registered for AI assistants.');
  }

  dispose(): void { this.disposable?.dispose(); this.disposable = null; }
}
