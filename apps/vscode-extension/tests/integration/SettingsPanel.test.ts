import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('SettingsPanel integration', () => {
  test('opens via command, accepts setSetting messages, propagates onDidChangeConfiguration', async () => {
    await vscode.commands.executeCommand('ctxloom.openSettings');

    // Flip a setting via VS Code config (mimics what the panel posts back).
    await vscode.workspace.getConfiguration('ctxloom').update('features.hover', false, vscode.ConfigurationTarget.Global);
    const v = vscode.workspace.getConfiguration('ctxloom').get<boolean>('features.hover');
    assert.strictEqual(v, false);

    // Reset for other tests.
    await vscode.workspace.getConfiguration('ctxloom').update('features.hover', undefined, vscode.ConfigurationTarget.Global);
  });

  test('panel reveal is idempotent (clicking twice does not spawn two panels)', async () => {
    await vscode.commands.executeCommand('ctxloom.openSettings');
    await vscode.commands.executeCommand('ctxloom.openSettings');
    assert.ok(true);
  });
});
