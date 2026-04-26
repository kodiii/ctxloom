import * as vscode from 'vscode';
import { SettingsPanel } from './settings/SettingsPanel.js';
import type { PanelState, WebviewToHost } from './settings/messageProtocol.js';
import { createOutputLogger, type Logger } from './shared/logger.js';

let panel: SettingsPanel | null = null;
let logger: Logger | null = null;
const SETTINGS_KEYS = [
  'cliPath', 'serverArgs', 'debounceMs', 'cacheTtlSeconds',
  'features.hover', 'features.diagnostics', 'features.gutterDecorations', 'features.codeLens', 'features.quickFixes', 'features.mcpBridge',
  'gutter.churnThresholdHigh', 'gutter.churnThresholdMedium', 'gutter.showDeadCodeMarker',
  'dashboardUrl', 'telemetry.enabled',
] as const;

function readSettings(): Record<string, unknown> {
  const cfg = vscode.workspace.getConfiguration('ctxloom');
  const out: Record<string, unknown> = {};
  for (const k of SETTINGS_KEYS) out[k] = cfg.get(k);
  return out;
}

function computeState(): PanelState {
  return { license: { kind: 'NO_LICENSE' }, settings: readSettings() };
}

async function handleMessage(msg: WebviewToHost): Promise<void> {
  if (msg.kind === 'setSetting') {
    await vscode.workspace.getConfiguration('ctxloom').update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
    return;
  }
  if (msg.kind === 'openExternal') { await vscode.env.openExternal(vscode.Uri.parse(msg.url)); return; }
  if (msg.kind === 'showOutput') { logger?.show(); return; }
  // Other kinds (license operations, restart) wired in later tasks.
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  logger = createOutputLogger();
  context.subscriptions.push({ dispose: () => logger?.dispose() });

  panel = new SettingsPanel({ context, logger, computeState, handleMessage });
  context.subscriptions.push({ dispose: () => panel?.dispose() });

  context.subscriptions.push(vscode.commands.registerCommand('ctxloom.openSettings', () => panel?.reveal()));

  // Push state when any ctxloom.* setting changes anywhere.
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('ctxloom')) panel?.refresh();
  }));
}

export function deactivate(): void {
  panel?.dispose();
  logger?.dispose();
}
