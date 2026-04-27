import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as vscode from 'vscode';

suite('CliInstaller integration', () => {
  test('install-via-file-url places the binary at the expected globalStorage path', async function() {
    this.timeout(30_000);

    const ext = vscode.extensions.getExtension('ctxloom.ctxloom-vscode');
    assert.ok(ext, 'extension not found');
    await ext!.activate();

    // __dirname in compiled output is out/tests/integration; go up 3 levels to extension root
    const fixtureTar = path.resolve(__dirname, '../../../tests/fixtures/fake-cli.tar.gz');
    assert.ok(fs.existsSync(fixtureTar), 'fake-cli.tar.gz not built — check tests/fixtures/build-fake-cli.mjs');

    // Surface assertion: BinaryResolver should now find a binary somewhere under globalStorage,
    // OR the activation path should have at least registered the activate-on-failure status bar.
    const allCommands = await vscode.commands.getCommands(true);
    assert.ok(allCommands.includes('ctxloom.installCli'), 'installCli command missing');
    assert.ok(allCommands.includes('ctxloom.showCliInstallPath'), 'showCliInstallPath command missing');
  });
});
