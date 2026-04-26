import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { CtxloomDiagnosticsProvider } from '../../src/providers/DiagnosticsProvider.js';

function fakeTools(violations: any[]) { return { rulesCheck: async () => violations } as never; }

suite('DiagnosticsProvider', () => {
  test('produces a Diagnostic for each violation with the right severity', async () => {
    const p = new CtxloomDiagnosticsProvider(fakeTools([
      { file: 'a.ts', line: 2, col: 1, endLine: 2, endCol: 5, rule: 'no-cycle', message: 'cyclic import', severity: 'error' },
    ]));
    const doc = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'export const x = 1;\nimport y from "./y";\n' });
    await p.refresh(doc.uri);
    const diags = vscode.languages.getDiagnostics(doc.uri);
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0].severity, vscode.DiagnosticSeverity.Error);
    assert.strictEqual(diags[0].source, 'ctxloom');
    p.dispose();
  });

  test('clear() removes diagnostics for a uri', async () => {
    const p = new CtxloomDiagnosticsProvider(fakeTools([{ file: 'a.ts', line: 1, col: 1, endLine: 1, endCol: 2, rule: 'r', message: 'm', severity: 'info' }]));
    const doc = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'x;\n' });
    await p.refresh(doc.uri);
    assert.strictEqual(vscode.languages.getDiagnostics(doc.uri).length, 1);
    p.clear(doc.uri);
    assert.strictEqual(vscode.languages.getDiagnostics(doc.uri).length, 0);
    p.dispose();
  });
});
