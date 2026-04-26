import * as vscode from 'vscode';
import type { Tools } from '../client/tools.js';
import type { Logger } from '../shared/logger.js';

export interface CommandDeps { tools: Tools | null; logger: Logger; getDashboardUrl(): string }

export function registerCommands(context: vscode.ExtensionContext, deps: CommandDeps): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ctxloom.copyContextPacket', async (args?: { file?: string; symbol?: string }) => {
      if (!deps.tools) { vscode.window.showWarningMessage('ctxloom server not available.'); return; }
      const editor = vscode.window.activeTextEditor;
      const file = args?.file ?? (editor ? vscode.workspace.asRelativePath(editor.document.uri) : null);
      const symbol = args?.symbol ?? '';
      if (!file) { vscode.window.showWarningMessage('Open a file first.'); return; }
      try {
        const packet = await deps.tools.contextPacket(file, symbol);
        await vscode.env.clipboard.writeText(packet.text);
        vscode.window.showInformationMessage(`Copied ${formatTokens(packet.skeletonTokens)} tokens (${packet.reductionPercent}% reduced)`);
      } catch (err) {
        deps.logger.error(`copyContextPacket failed: ${String(err)}`);
        vscode.window.showErrorMessage('Could not generate context packet.');
      }
    }),
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
