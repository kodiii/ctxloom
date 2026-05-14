import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tools } from '../client/tools.js';
import type { Logger } from '../shared/logger.js';
import type { LicenseGate } from '../license/LicenseGate.js';
import { PreviewPanel } from '../review/PreviewPanel.js';

const execFileAsync = promisify(execFile);

type LicenseOps = {
  startTrial: (email: string) => Promise<{ checkoutUrl: string }>;
  activate: (key: string) => Promise<void>;
  deactivate: () => Promise<void>;
};

export interface CommandDeps {
  tools: Tools | null;
  logger: Logger;
  getDashboardUrl(): string;
  licenseGate: LicenseGate;
  licenseOps: LicenseOps;
  openSettings: () => void;
  refreshHealth: () => void;
  refreshBlast: () => void;
  globalStorageRoot: string;
  manifestCliVersion: () => string;
  triggerCliInstall: () => void;          // Re-runs startServer() — invokes CliInstaller if needed
  resetCliFailureCount: () => void;
  restartServer: () => Promise<void>;
  /** Returns the absolute path to the resolved ctxloom CLI binary. */
  resolveCliBinary: () => string;
}

export function registerCommands(context: vscode.ExtensionContext, deps: CommandDeps): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ctxloom.copyContextPacket', async (args?: { file?: string; symbol?: string }) => {
      if (!deps.tools) { vscode.window.showWarningMessage('ctxloom server not available.'); return; }
      const editor = vscode.window.activeTextEditor;
      const file = args?.file ?? (editor ? vscode.workspace.asRelativePath(editor.document.uri) : null);
      if (!file) { vscode.window.showWarningMessage('Open a file first.'); return; }
      const symbol = args?.symbol ?? '';
      try {
        const packet = await deps.tools.contextPacket(file, symbol);
        await vscode.env.clipboard.writeText(packet.text);
        vscode.window.showInformationMessage(`Copied ${formatTokens(packet.skeletonTokens)} tokens (${packet.reductionPercent}% reduced)`);
      } catch (err) {
        deps.logger.error(`copyContextPacket failed: ${String(err)}`);
        vscode.window.showErrorMessage('Could not generate context packet.');
      }
    }),

    vscode.commands.registerCommand('ctxloom.showBlastRadius', () => deps.refreshBlast()),

    vscode.commands.registerCommand('ctxloom.showOwners', async () => {
      if (!deps.tools) { vscode.window.showWarningMessage('ctxloom server not available.'); return; }
      const editor = vscode.window.activeTextEditor;
      if (!editor) { vscode.window.showWarningMessage('Open a file first.'); return; }
      const file = vscode.workspace.asRelativePath(editor.document.uri);
      const r = await deps.tools.riskOverlay(file);
      const owner = r?.topOwner ?? 'unknown';
      vscode.window.showInformationMessage(`Top owner of ${file}: @${owner}`);
    }),

    vscode.commands.registerCommand('ctxloom.activateLicense', async () => {
      const key = await vscode.window.showInputBox({ prompt: 'Paste your ctxloom license key', password: false, ignoreFocusOut: true });
      if (!key) return;
      try { await deps.licenseOps.activate(key); vscode.window.showInformationMessage('ctxloom license activated.'); await deps.licenseGate.evaluate(); }
      catch (err) { vscode.window.showErrorMessage(`Activation failed: ${String(err)}`); }
    }),

    vscode.commands.registerCommand('ctxloom.startTrial', async () => {
      const email = await vscode.window.showInputBox({ prompt: 'Email for your free 7-day trial', validateInput: v => /.+@.+\..+/.test(v) ? null : 'Enter a valid email.' });
      if (!email) return;
      try {
        const { checkoutUrl } = await deps.licenseOps.startTrial(email);
        await vscode.env.openExternal(vscode.Uri.parse(checkoutUrl));
        vscode.window.showInformationMessage('Trial checkout opened in browser. Your license key will arrive by email.');
        deps.openSettings();
      } catch (err) { vscode.window.showErrorMessage(`Trial start failed: ${String(err)}`); }
    }),

    vscode.commands.registerCommand('ctxloom.showLicenseStatus', () => {
      const s = deps.licenseGate.current();
      vscode.window.showInformationMessage(`License: ${s.kind}${'tier' in s ? ` · ${s.tier}` : ''}${'daysLeft' in s ? ` · ${s.daysLeft}d left` : ''}`);
    }),

    vscode.commands.registerCommand('ctxloom.deactivateLicense', async () => {
      const ok = await vscode.window.showWarningMessage('Deactivate ctxloom on this machine?', { modal: true }, 'Deactivate');
      if (ok !== 'Deactivate') return;
      await deps.licenseOps.deactivate();
      await deps.licenseGate.evaluate();
      vscode.window.showInformationMessage('License deactivated. The seat is free to use elsewhere.');
    }),

    vscode.commands.registerCommand('ctxloom.restartServer', () => deps.restartServer()),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ctxloom.installCli', async () => {
      // Reset the dismiss flag so the user can re-prompt.
      await vscode.workspace.getConfiguration('ctxloom.cli').update('installPromptDismissed', false, vscode.ConfigurationTarget.Global);
      deps.resetCliFailureCount();
      deps.triggerCliInstall();
    }),

    vscode.commands.registerCommand('ctxloom.showCliInstallPath', async () => {
      const root = deps.globalStorageRoot;
      const cliVersion = deps.manifestCliVersion();
      vscode.window.showInformationMessage(
        `ctxloom CLI install path: ${root}/ctxloom-cli/${cliVersion}/`,
        'Open',
      ).then(choice => { if (choice === 'Open') { vscode.env.openExternal(vscode.Uri.file(root)); } });
    }),

    // Shells out to `ctxloom install-pr-bot` in the active workspace
    // folder. The CLI does the heavy lifting (git-repo detection,
    // default-branch resolution, --force semantics). We surface the
    // result via a VS Code notification so users don't need to dig
    // through a terminal to see what happened.
    vscode.commands.registerCommand('ctxloom.installPrBot', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showErrorMessage(
          'ctxloom: install-pr-bot requires an open workspace folder.',
        );
        return;
      }
      const cliPath = deps.resolveCliBinary();
      try {
        const { stdout } = await execFileAsync(cliPath, ['install-pr-bot'], {
          cwd: folder.uri.fsPath,
        });
        deps.logger.info(`install-pr-bot output:\n${stdout}`);
        const action = await vscode.window.showInformationMessage(
          'ctxloom: PR-bot workflow installed. Commit and push to enable it on the next PR.',
          'Open workflow',
          'Show output',
        );
        if (action === 'Open workflow') {
          const uri = vscode.Uri.joinPath(folder.uri, '.github', 'workflows', 'ctxloom-review.yml');
          await vscode.commands.executeCommand('vscode.open', uri);
        } else if (action === 'Show output') {
          // The logger writes to the ctxloom output channel; this is
          // the same affordance the "Show Output" Settings button uses.
          deps.logger.info('(See the ctxloom output channel for the full install-pr-bot stdout.)');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        deps.logger.error(`install-pr-bot failed: ${msg}`);
        vscode.window.showErrorMessage(
          `ctxloom: install-pr-bot failed — ${msg.split('\n')[0]}`,
        );
      }
    }),

    // Opens a webview that mirrors the GitHub Action's PR review — same
    // detectChanges + getImpactRadius engine, run against the working
    // tree vs origin/main. Lets developers see their risk score before
    // opening the PR.
    vscode.commands.registerCommand('ctxloom.previewPrReview', () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showErrorMessage(
          'ctxloom: preview-pr-review requires an open workspace folder.',
        );
        return;
      }
      PreviewPanel.showOrReveal({
        workspace: folder.uri.fsPath,
        log: deps.logger,
      });
    }),
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
