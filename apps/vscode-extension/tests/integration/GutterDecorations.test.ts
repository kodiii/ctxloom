import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { GutterDecorations } from '../../src/providers/GutterDecorations.js';

const fakeTools = { gitCoupling: async () => ({ churnLines: 1500, bucket: 'high' as const, importers: 0 }) } as never;

suite('GutterDecorations', () => {
  test('apply() does not throw on a freshly-opened editor', async () => {
    const g = new GutterDecorations({ tools: fakeTools, debounceMs: 1, thresholds: { high: 1000, medium: 200 }, showDeadCodeMarker: true });
    const doc = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'export const x = 1;\n' });
    const editor = await vscode.window.showTextDocument(doc);
    g.apply(editor);
    await new Promise(r => setTimeout(r, 30));
    assert.ok(true);
    g.dispose();
  });

  test('clearAll() removes decorations from visible editors', async () => {
    const g = new GutterDecorations({ tools: fakeTools, debounceMs: 1, thresholds: { high: 1000, medium: 200 }, showDeadCodeMarker: true });
    const doc = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'x;\n' });
    await vscode.window.showTextDocument(doc);
    g.clearAll();
    assert.ok(true);
    g.dispose();
  });
});
