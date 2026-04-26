import * as vscode from 'vscode';
import type { Tools } from '../client/tools.js';

export class CtxloomQuickFixProvider implements vscode.CodeActionProvider {
  static readonly providedKinds = [vscode.CodeActionKind.QuickFix];

  constructor(private readonly tools: Tools) {}

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    ctx: vscode.CodeActionProviderMetadata & { diagnostics?: readonly vscode.Diagnostic[] },
    _token: vscode.CancellationToken,
  ): vscode.CodeAction[] {
    const fromCtx = (ctx as unknown as { diagnostics?: readonly vscode.Diagnostic[] }).diagnostics ?? [];
    const ours = fromCtx.filter(d => d.source === 'ctxloom');
    return ours.map(d => {
      const action = new vscode.CodeAction(
        `Apply suggested refactor for ${d.code ?? 'rule'}`,
        vscode.CodeActionKind.QuickFix,
      );
      action.diagnostics = [d];
      action.command = {
        command: 'ctxloom.applyRefactor',
        title: 'Apply ctxloom refactor',
        arguments: [
          {
            file: vscode.workspace.asRelativePath(document.uri),
            rule: d.code,
            range: {
              startLine: d.range.start.line,
              startCol: d.range.start.character,
              endLine: d.range.end.line,
              endCol: d.range.end.character,
            },
          },
        ],
      };
      return action;
    });
  }
}

export async function applyRefactorCommand(
  tools: Tools | null,
  args: { file: string; rule: string | undefined; range: { startLine: number; startCol: number; endLine: number; endCol: number } },
): Promise<void> {
  if (!tools) {
    vscode.window.showWarningMessage('ctxloom server not available.');
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    `Apply ctxloom refactor for ${args.rule ?? 'rule'}?`,
    { modal: true },
    'Apply',
    'Cancel',
  );
  if (choice !== 'Apply') return;
  const result = await tools.applyRefactor(args);
  if (!result.ok) {
    vscode.window.showErrorMessage(result.message ?? 'Refactor failed.');
    return;
  }
  vscode.window.showInformationMessage('Refactor applied.');
}
