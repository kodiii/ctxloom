import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('Commands', () => {
  test('all 11 ctxloom commands are registered', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const cmd of [
      'ctxloom.openSettings', 'ctxloom.activateLicense', 'ctxloom.startTrial', 'ctxloom.showLicenseStatus',
      'ctxloom.deactivateLicense', 'ctxloom.openDashboard', 'ctxloom.showBlastRadius', 'ctxloom.showOwners',
      'ctxloom.copyContextPacket', 'ctxloom.refreshCodeHealth', 'ctxloom.restartServer',
    ]) assert.ok(all.includes(cmd), `${cmd} not registered`);
  });
});
