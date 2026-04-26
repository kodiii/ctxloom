import * as assert from 'node:assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'ctxloom.ctxloom-vscode';
const EXPECTED_COMMANDS = [
  'ctxloom.openSettings', 'ctxloom.activateLicense', 'ctxloom.startTrial', 'ctxloom.showLicenseStatus',
  'ctxloom.deactivateLicense', 'ctxloom.openDashboard', 'ctxloom.showBlastRadius', 'ctxloom.showOwners',
  'ctxloom.copyContextPacket', 'ctxloom.refreshCodeHealth', 'ctxloom.restartServer',
];

suite('Commands', () => {
  test('all 11 ctxloom commands are registered after activation', async function() {
    this.timeout(30_000);

    // Activation is async (dynamic import of @ctxloom/core loads ML deps);
    // wait for it before checking the command registry.
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    if (ext) {
      await ext.activate();
    } else {
      // Fallback: extension may be self-loaded via the test harness rather than via
      // the marketplace extension id. Trigger activation by invoking openSettings.
      try { await vscode.commands.executeCommand('ctxloom.openSettings'); } catch { /* no-op */ }
    }

    // Poll briefly in case some commands register slightly after the activate() promise resolves.
    let missing: string[] = [];
    for (let attempt = 0; attempt < 20; attempt++) {
      const all = await vscode.commands.getCommands(true);
      missing = EXPECTED_COMMANDS.filter(c => !all.includes(c));
      if (missing.length === 0) break;
      await new Promise(r => setTimeout(r, 250));
    }
    assert.deepStrictEqual(missing, [], `commands not registered: ${missing.join(', ')}`);
  });
});
