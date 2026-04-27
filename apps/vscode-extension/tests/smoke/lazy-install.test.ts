import * as assert from 'node:assert';
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';

suite('Lazy-install smoke (real GitHub Releases)', () => {
  // Smoke test requires the `cli-v0.0.0-test` GitHub Release tag with platform
  // tarballs to be published. It is opt-in via CTXLOOM_SMOKE=1 so default CI
  // does not fail before the tag exists.
  const SMOKE_ENABLED = process.env.CTXLOOM_SMOKE === '1';

  test('downloads + verifies + installs the cli-v0.0.0-test fixture release', async function() {
    if (!SMOKE_ENABLED) {
      this.skip();
      return;
    }
    this.timeout(60_000);

    // Force the installer to fetch from the test tag.
    await vscode.workspace.getConfiguration('ctxloom.cli').update('testReleaseTag', 'cli-v0.0.0-test', vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('ctxloom.cli').update('installPromptDismissed', false, vscode.ConfigurationTarget.Global);

    const ext = vscode.extensions.getExtension('ctxloom.ctxloom-vscode');
    assert.ok(ext);
    await ext!.activate();

    // Wait briefly for any in-progress install to settle.
    await new Promise(r => setTimeout(r, 10_000));

    const globalStorage = (vscode.extensions.getExtension('ctxloom.ctxloom-vscode')!.extensionPath
      .replace(/\/extensions\/[^/]+$/, '/User/globalStorage/ctxloom.ctxloom-vscode'));

    // The fixture install is identifiable by its presence under ctxloom-cli/0.0.0-test/.
    const expected = path.join(globalStorage, 'ctxloom-cli', '0.0.0-test', 'dist', 'index.js');
    assert.ok(fs.existsSync(expected) || fs.existsSync(path.join(globalStorage, 'INSTALLED_VERSION')),
      `expected fixture install at ${expected} (this test requires the cli-v0.0.0-test tag to be published with platform tarballs)`);
  });
});
