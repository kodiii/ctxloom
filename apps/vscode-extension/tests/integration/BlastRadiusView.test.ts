import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { BlastRadiusView } from '../../src/providers/BlastRadiusView.js';

const fakeTools = { blastRadius: async () => ({ direct: ['b.ts', 'c.ts'], transitive: ['d.ts'], historical: [] }) } as never;

suite('BlastRadiusView', () => {
  test('refreshFor populates 3 sections with correct counts', async () => {
    const v = new BlastRadiusView(fakeTools);
    const doc = await vscode.workspace.openTextDocument({ language: 'typescript', content: '' });
    await v.refreshFor(doc.uri);
    const root = (await v.getChildren())![0];
    const sections = await v.getChildren(root);
    assert.match(sections![0].label, /^Direct importers \(2\)/);
    assert.match(sections![1].label, /^Transitive \(1\)/);
    assert.match(sections![2].label, /^Historical coupling \(0\)/);
  });
});
