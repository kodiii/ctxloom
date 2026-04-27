import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('Activation orchestration', () => {
  test('extension activates without throwing even when CLI is missing', async function() {
    this.timeout(30_000);
    const ext = vscode.extensions.getExtension('ctxloom.ctxloom-vscode');
    assert.ok(ext);
    await ext!.activate();
    // If activation threw, this assertion would never run.
    assert.ok(true);
  });

  test('Open Settings command registers regardless of CLI install state', async function() {
    const ext = vscode.extensions.getExtension('ctxloom.ctxloom-vscode');
    await ext!.activate();
    const cmds = await vscode.commands.getCommands(true);
    assert.ok(cmds.includes('ctxloom.openSettings'));
  });

  test('Restart Server command is registered and callable', async function() {
    const ext = vscode.extensions.getExtension('ctxloom.ctxloom-vscode');
    await ext!.activate();
    // Calling it should not throw, even if the CLI install fails downstream.
    await vscode.commands.executeCommand('ctxloom.restartServer');
    assert.ok(true);
  });
});
