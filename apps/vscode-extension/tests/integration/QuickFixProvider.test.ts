import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { CtxloomQuickFixProvider } from '../../src/providers/QuickFixProvider.js';

const fakeTools = { applyRefactor: async () => ({ ok: true }) } as never;

suite('QuickFixProvider', () => {
  test('produces an Apply action only for ctxloom-source diagnostics', async () => {
    const p = new CtxloomQuickFixProvider(fakeTools);
    const doc = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'x;\n' });
    const ctxDiag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), 'cycle', vscode.DiagnosticSeverity.Error);
    ctxDiag.source = 'ctxloom'; ctxDiag.code = 'no-cycle';
    const tsDiag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), 'ts error', vscode.DiagnosticSeverity.Error);
    tsDiag.source = 'ts';
    const actions = p.provideCodeActions(
      doc,
      new vscode.Range(0, 0, 0, 1),
      { only: vscode.CodeActionKind.QuickFix, triggerKind: vscode.CodeActionTriggerKind.Invoke, diagnostics: [ctxDiag, tsDiag] } as never,
      new vscode.CancellationTokenSource().token,
    ) as vscode.CodeAction[];
    assert.strictEqual(actions.length, 1);
    assert.match(actions[0].title, /no-cycle/);
  });
});
