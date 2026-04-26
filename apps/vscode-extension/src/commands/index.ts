import * as vscode from 'vscode';
import type { Tools } from '../client/tools.js';
import type { Logger } from '../shared/logger.js';
import type { LicenseGate } from '../license/LicenseGate.js';

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
      try { await deps.licenseOps.activate(key); vscode.window.showInformationMessage('ctxloom license activated.'); deps.licenseGate.evaluate(); }
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
      deps.licenseGate.evaluate();
      vscode.window.showInformationMessage('License deactivated. The seat is free to use elsewhere.');
    }),

    vscode.commands.registerCommand('ctxloom.restartServer', () => deps.logger.info('Restart server requested via command palette.')),
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
