import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { CodeHealthView } from '../../src/providers/CodeHealthView.js';

const fakeTools = {
  knowledgeGaps: async () => ({ isolated: [], deadCode: ['x.ts'], untestedHubs: [] }),
  hubNodes: async () => [{ file: 'h.ts', importers: 12 }],
  communityList: async () => ({ count: 4 }),
} as never;

suite('CodeHealthView', () => {
  test('renders dead code, hub files, communities counts and an action link', async () => {
    const v = new CodeHealthView(fakeTools, () => 'http://localhost:7842');
    await v.refresh();
    const root = (await v.getChildren())![0];
    const sections = await v.getChildren(root);
    assert.match(sections![0].label, /Dead code \(1\)/);
    assert.match(sections![1].label, /Hub files \(1\)/);
    assert.match(sections![2].label, /Communities \(4\)/);
    assert.strictEqual(sections![3].isAction, true);
  });
});
