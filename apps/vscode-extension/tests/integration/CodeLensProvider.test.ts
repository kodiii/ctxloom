import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { CtxloomCodeLensProvider } from '../../src/providers/CodeLensProvider.js';
import { TtlCache } from '../../src/shared/cache.js';

const fakeTools = { riskOverlay: async () => ({ file: 'a.ts', score: 0.42, label: 'medium', topOwner: 'alice' }) } as never;

suite('CodeLensProvider — file-top', () => {
  test('emits a single lens at line 0 with risk score and owner', async () => {
    const p = new CtxloomCodeLensProvider({ tools: fakeTools, cache: new TtlCache({ ttlMs: 30_000 }) });
    const doc = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'export const x = 1;\n' });
    const lenses = await p.provideCodeLenses(doc, new vscode.CancellationTokenSource().token);
    assert.strictEqual(lenses.length, 1);
    assert.match(lenses[0].command!.title, /risk 0\.42 \(medium\) · @alice/);
  });
});
