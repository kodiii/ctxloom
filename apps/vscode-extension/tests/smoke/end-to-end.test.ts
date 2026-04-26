import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('Extension smoke (real ctxloom child)', () => {
  test('extension activates without errors and responds to commands', async function() {
    this.timeout(60_000);
    // Wait briefly for the activation chain to settle (server spawn + LicenseGate).
    await new Promise(r => setTimeout(r, 5_000));

    // Open Settings command exists and is callable.
    await vscode.commands.executeCommand('ctxloom.openSettings');

    // Hover should not throw on an import line in b.ts.
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'fixture workspace not loaded');
    const bUri = vscode.Uri.joinPath(folder!.uri, 'b.ts');
    const doc = await vscode.workspace.openTextDocument(bUri);
    await vscode.window.showTextDocument(doc);
    const pos = new vscode.Position(0, 24);
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', bUri, pos);
    assert.ok(Array.isArray(hovers));
  });
});
