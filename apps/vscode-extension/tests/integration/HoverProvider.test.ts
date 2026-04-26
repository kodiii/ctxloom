import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { CtxloomHoverProvider } from '../../src/providers/HoverProvider.js';
import type { Tools } from '../../src/client/tools.js';
import { TtlCache } from '../../src/shared/cache.js';

function fakeTools(): Tools {
  return {
    riskOverlay: async () => ({ file: 'b.ts', score: 0.42, label: 'medium', topOwner: 'alice' }),
    blastRadius: async () => ({ direct: ['x.ts', 'y.ts'], transitive: ['z.ts'], historical: [] }),
  } as unknown as Tools;
}

suite('HoverProvider', () => {
  test('renders risk + owner + blast count for an import path', async () => {
    const provider = new CtxloomHoverProvider({ tools: fakeTools(), cache: new TtlCache({ ttlMs: 30_000 }), dashboardUrl: 'http://localhost:7842' });
    const doc = await vscode.workspace.openTextDocument({ language: 'typescript', content: "import { x } from './b.ts';\n" });
    const pos = new vscode.Position(0, 24); // inside './b.ts'
    const hover = await provider.provideHover(doc, pos, new vscode.CancellationTokenSource().token);
    assert.ok(hover);
    const text = (hover!.contents[0] as vscode.MarkdownString).value;
    assert.match(text, /alice/);
    assert.match(text, /0\.42/);
    assert.match(text, /3 files/); // direct(2) + transitive(1)
  });

  test('returns null when not hovering an import string', async () => {
    const provider = new CtxloomHoverProvider({ tools: fakeTools(), cache: new TtlCache({ ttlMs: 30_000 }), dashboardUrl: 'http://localhost:7842' });
    const doc = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'const x = 1;\n' });
    const hover = await provider.provideHover(doc, new vscode.Position(0, 6), new vscode.CancellationTokenSource().token);
    assert.strictEqual(hover, null);
  });
});
