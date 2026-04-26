import * as vscode from 'vscode';
import { resolveCliPath } from './client/BinaryResolver.js';
import { ServerManager } from './client/ServerManager.js';
import { Tools } from './client/tools.js';
import type { RiskInfo, BlastResult } from './client/tools.js';
import { SettingsPanel } from './settings/SettingsPanel.js';
import type { PanelState, WebviewToHost } from './settings/messageProtocol.js';
import { createOutputLogger, type Logger } from './shared/logger.js';
import { CtxloomHoverProvider } from './providers/HoverProvider.js';
import { CtxloomDiagnosticsProvider } from './providers/DiagnosticsProvider.js';
import { BlastRadiusView } from './providers/BlastRadiusView.js';
import { CodeHealthView } from './providers/CodeHealthView.js';
import { TtlCache } from './shared/cache.js';

let panel: SettingsPanel | null = null;
let logger: Logger | null = null;
let serverManager: ServerManager | null = null;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let tools: Tools | null = null;

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
  if (msg.kind === 'restartServer') {
    if (serverManager) { await serverManager.dispose(); serverManager = null; }
    await startServer();
    return;
  }
}

async function startServer(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) { logger?.warn('no workspace folder — server not started'); return; }
  const cfg = vscode.workspace.getConfiguration('ctxloom');
  const override = cfg.get<string | null>('cliPath') ?? null;
  const extensionRoot = vscode.extensions.getExtension('ctxloom.ctxloom-vscode')?.extensionPath
    ?? vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '';
  const resolved = resolveCliPath({ extensionRoot, override });
  if (!resolved.exists) { logger?.error(`ctxloom CLI missing at ${resolved.path}`); return; }

  const { spawnServer } = await import('@ctxloom/mcp-client');
  serverManager = new ServerManager({
    spawner: () => spawnServer({ cwd: folder.uri.fsPath, command: resolved.path }) as never,
    logger: { info: m => logger?.info(m), warn: m => logger?.warn(m), error: m => logger?.error(m) },
  });
  await serverManager.start();
  tools = new Tools(serverManager);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  logger = createOutputLogger();
  context.subscriptions.push({ dispose: () => logger?.dispose() });

  panel = new SettingsPanel({ context, logger, computeState, handleMessage });
  context.subscriptions.push({ dispose: () => panel?.dispose() });
  context.subscriptions.push(vscode.commands.registerCommand('ctxloom.openSettings', () => panel?.reveal()));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('ctxloom')) panel?.refresh(); }));

  await startServer();

  const hoverCache = new TtlCache<string, { risk: RiskInfo | null; blast: BlastResult }>({
    ttlMs: (vscode.workspace.getConfiguration('ctxloom').get<number>('cacheTtlSeconds') ?? 30) * 1000,
  });

  let hoverDisposable: vscode.Disposable | null = null;
  function refreshHover() {
    hoverDisposable?.dispose(); hoverDisposable = null;
    if (vscode.workspace.getConfiguration('ctxloom').get<boolean>('features.hover') && tools) {
      const dashboardUrl = vscode.workspace.getConfiguration('ctxloom').get<string>('dashboardUrl') ?? 'http://localhost:7842';
      hoverDisposable = vscode.languages.registerHoverProvider({ scheme: 'file' }, new CtxloomHoverProvider({ tools, cache: hoverCache, dashboardUrl }));
      context.subscriptions.push(hoverDisposable);
    }
  }
  refreshHover();
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('ctxloom.features.hover') || e.affectsConfiguration('ctxloom.dashboardUrl')) refreshHover(); }));

  let diagnostics: CtxloomDiagnosticsProvider | null = null;
  function refreshDiagnostics() {
    diagnostics?.dispose(); diagnostics = null;
    if (vscode.workspace.getConfiguration('ctxloom').get<boolean>('features.diagnostics') && tools) {
      diagnostics = new CtxloomDiagnosticsProvider(tools);
      context.subscriptions.push({ dispose: () => diagnostics?.dispose() });
      context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(d => diagnostics?.refresh(d.uri)));
      context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(e => { if (e) diagnostics?.refresh(e.document.uri); }));
      if (vscode.window.activeTextEditor) void diagnostics.refresh(vscode.window.activeTextEditor.document.uri);
    }
  }
  refreshDiagnostics();
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('ctxloom.features.diagnostics')) refreshDiagnostics(); }));

  let blastView: BlastRadiusView | null = null;
  let healthView: CodeHealthView | null = null;
  if (tools) {
    blastView = new BlastRadiusView(tools);
    healthView = new CodeHealthView(tools, () => vscode.workspace.getConfiguration('ctxloom').get<string>('dashboardUrl') ?? 'http://localhost:7842');
    context.subscriptions.push(vscode.window.registerTreeDataProvider('ctxloom.blastRadius', blastView));
    context.subscriptions.push(vscode.window.registerTreeDataProvider('ctxloom.codeHealth', healthView));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(e => { if (e) blastView?.refreshFor(e.document.uri); }));
    if (vscode.window.activeTextEditor) void blastView.refreshFor(vscode.window.activeTextEditor.document.uri);
    void healthView.refresh();
    context.subscriptions.push(vscode.commands.registerCommand('ctxloom.refreshCodeHealth', () => healthView?.refresh()));
    context.subscriptions.push(vscode.commands.registerCommand('ctxloom.openDashboard', async () => {
      const url = vscode.workspace.getConfiguration('ctxloom').get<string>('dashboardUrl') ?? 'http://localhost:7842';
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }));
  }
}

export async function deactivate(): Promise<void> {
  if (serverManager) await serverManager.dispose();
  panel?.dispose();
  logger?.dispose();
}
