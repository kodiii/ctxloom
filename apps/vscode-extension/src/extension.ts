import * as vscode from 'vscode';
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
import { createStatusBarItem, type StatusBarHandle } from './license/statusBar.js';
import { CtxloomCodeLensProvider } from './providers/CodeLensProvider.js';
import { GutterDecorations } from './providers/GutterDecorations.js';
import { CtxloomQuickFixProvider, applyRefactorCommand } from './providers/QuickFixProvider.js';
import { registerCommands } from './commands/index.js';
import { LicenseGate, type LicenseInfo } from './license/LicenseGate.js';
import { McpBridge } from './providers/McpBridge.js';
import { CliInstaller, type InstallPrompt, type ProgressReporter } from './client/CliInstaller.js';
import { resolveCliPath } from './client/BinaryResolver.js';

let panel: SettingsPanel | null = null;
let logger: Logger | null = null;
let serverManager: ServerManager | null = null;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let tools: Tools | null = null;
let statusBar: StatusBarHandle | null = null;
let cliInstaller: CliInstaller | null = null;
let extensionContext: vscode.ExtensionContext | null = null;

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

let licenseGate: LicenseGate | null = null;

function computeState(): PanelState {
  return { license: licenseGate?.current() ?? { kind: 'NO_LICENSE' }, settings: readSettings() };
}

async function handleMessage(msg: WebviewToHost, licenseOps?: { startTrial: (email: string) => Promise<{ checkoutUrl: string }>; activate: (key: string) => Promise<void>; deactivate: () => Promise<void> }): Promise<void> {
  if (msg.kind === 'setSetting') {
    await vscode.workspace.getConfiguration('ctxloom').update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
    return;
  }
  if (msg.kind === 'openExternal') { await vscode.env.openExternal(vscode.Uri.parse(msg.url)); return; }
  if (msg.kind === 'showOutput') { logger?.show(); return; }
  if (msg.kind === 'restartServer') {
    if (serverManager) { await serverManager.dispose(); serverManager = null; }
    if (extensionContext) { await startServer(extensionContext); }
    return;
  }
  if (msg.kind === 'startTrial' && licenseOps) {
    try { const { checkoutUrl } = await licenseOps.startTrial((msg as unknown as { email: string }).email); await vscode.env.openExternal(vscode.Uri.parse(checkoutUrl)); panel?.send({ kind: 'trialCheckoutOpened', checkoutUrl } as never); }
    catch (err) { panel?.send({ kind: 'activationResult', ok: false, error: String(err) } as never); }
    return;
  }
  if (msg.kind === 'activateLicense' && licenseOps) {
    try { await licenseOps.activate((msg as unknown as { key: string }).key); await licenseGate?.evaluate(); panel?.send({ kind: 'activationResult', ok: true } as never); panel?.refresh(); }
    catch (err) { panel?.send({ kind: 'activationResult', ok: false, error: String(err) } as never); }
    return;
  }
  if (msg.kind === 'deactivateLicense' && licenseOps) {
    await licenseOps.deactivate(); await licenseGate?.evaluate(); panel?.send({ kind: 'deactivationResult', ok: true } as never); panel?.refresh();
    return;
  }
}

function manifestCliVersion(): string {
  // Read the manifest field at runtime so tests can patch it.
  const ext = vscode.extensions.getExtension('ctxloom.ctxloom-vscode');
  const v = (ext?.packageJSON as { ctxloomCliVersion?: string } | undefined)?.ctxloomCliVersion;
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error('Extension manifest is missing ctxloomCliVersion field');
  }
  return v;
}

function makePrompt(context: vscode.ExtensionContext, cliVersion: string): InstallPrompt {
  return {
    alreadyDismissed: () => vscode.workspace.getConfiguration('ctxloom.cli').get<boolean>('installPromptDismissed') ?? false,
    confirmInstall: async () => {
      const choice = await vscode.window.showInformationMessage(
        `ctxloom needs to download its analyzer (~150 MB, version ${cliVersion}). Stored at ${context.globalStorageUri.fsPath}.`,
        { modal: true },
        'Install',
        'Skip for now',
        "Don't ask again",
      );
      if (choice === 'Install') return 'install';
      if (choice === "Don't ask again") {
        await vscode.workspace.getConfiguration('ctxloom.cli').update('installPromptDismissed', true, vscode.ConfigurationTarget.Global);
        return 'dont-ask-again';
      }
      return 'skip';
    },
  };
}

function makeProgress(): ProgressReporter {
  return {
    withProgress: <T,>(title: string, body: (report: (delta: { message?: string }) => void) => Promise<T>): Promise<T> =>
      vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: true }, async (progress) => {
        return body((delta) => progress.report(delta));
      }) as Promise<T>,
  };
}

async function startServer(context: vscode.ExtensionContext): Promise<void> {
  // Windows: polite v1.2-coming fallback
  if (process.platform === 'win32') {
    logger?.info('Windows support coming in v1.2 — extension activated in inert mode');
    statusBar?.update({ licenseState: { kind: 'NO_LICENSE' as const }, riskScore: null }); // FIXME(v1.1): added in Task 8 — cliInstallState: 'windows-unsupported'
    return;
  }

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) { logger?.warn('no workspace folder — server not started'); return; }

  const cliVersion = manifestCliVersion();
  const cfg = vscode.workspace.getConfiguration('ctxloom');
  const override = cfg.get<string | null>('cliPath') ?? null;

  const resolved = resolveCliPath({ globalStorageRoot: context.globalStorageUri.fsPath, cliVersion, override });

  if (!resolved.exists) {
    cliInstaller ??= new CliInstaller({
      globalStorageRoot: context.globalStorageUri.fsPath,
      fetch: globalThis.fetch,
      logger: logger!,
      prompt: makePrompt(context, cliVersion),
      progress: makeProgress(),
    });
    statusBar?.update({ licenseState: { kind: 'NO_LICENSE' as const }, riskScore: null }); // FIXME(v1.1): added in Task 8 — cliInstallState: 'installing'
    let outcome;
    try { outcome = await cliInstaller.ensureInstalled(cliVersion); }
    catch (err) {
      logger?.error(`CLI install failed: ${String(err)}`);
      statusBar?.update({ licenseState: { kind: 'NO_LICENSE' as const }, riskScore: null }); // FIXME(v1.1): added in Task 8 — cliInstallState: 'failed'
      return;
    }
    if (outcome.kind === 'skipped' || outcome.kind === 'dismissed' || outcome.kind === 'exhausted') {
      statusBar?.update({ licenseState: { kind: 'NO_LICENSE' as const }, riskScore: null }); // FIXME(v1.1): added in Task 8 — cliInstallState: 'setup-needed'
      return;
    }
  }

  // Re-resolve now that install (if any) committed.
  const ready = resolveCliPath({ globalStorageRoot: context.globalStorageUri.fsPath, cliVersion, override });
  if (!ready.exists) {
    logger?.error(`ctxloom CLI still missing after install at ${ready.path}`);
    return;
  }

  try {
    const { spawnServer } = await import('@ctxloom/mcp-client');
    serverManager = new ServerManager({
      spawner: () => spawnServer({ cwd: folder.uri.fsPath, command: ready.path }) as never,
      logger: { info: m => logger?.info(m), warn: m => logger?.warn(m), error: m => logger?.error(m) },
    });
    await serverManager.start();
    tools = new Tools(serverManager);
  } catch (err) {
    // Don't block activation if the CLI fails to spawn (binary missing,
    // ESM/CJS mismatch, MCP handshake error, sandboxed CI runner, etc.).
    // Providers gate on `tools` being non-null, so they degrade gracefully;
    // commands still register and the user can run `ctxloom: Restart Server`.
    logger?.error(`ctxloom server failed to start: ${String(err)}`);
    if (serverManager) { try { await serverManager.dispose(); } catch { /* ignore */ } serverManager = null; }
    tools = null;
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  extensionContext = context;
  logger = createOutputLogger();
  context.subscriptions.push({ dispose: () => logger?.dispose() });

  // Load license module dynamically (ESM-only package). Gracefully degrade if
  // the module cannot be loaded (e.g., in headless test environments).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let license: any = null;
  try {
    license = await import('@ctxloom/core');
  } catch (err) {
    logger?.warn(`@ctxloom/core could not be loaded — license features disabled: ${String(err)}`);
  }

  async function readLicenseInfo(): Promise<LicenseInfo | null> {
    if (!license) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
      const f: { tier: string; status: string; expiresAt: string; instanceId: string } | null = await license.getLicenseInfo();
      if (!f) return null;
      return { tier: f.tier as LicenseInfo['tier'], status: f.status as LicenseInfo['status'], expiresAt: f.expiresAt, fingerprint: f.instanceId };
    } catch (err) {
      logger?.warn(`license read failed: ${String(err)}`);
      return null;
    }
  }

  licenseGate = new LicenseGate({ getInfo: readLicenseInfo, recheckMs: 60_000 });
  await licenseGate.evaluate();
  licenseGate.startRechecking();
  context.subscriptions.push({ dispose: () => licenseGate?.dispose() });
  licenseGate.onStateChange(() => panel?.refresh());

  const licenseOps = {
    startTrial: async (email: string): Promise<{ checkoutUrl: string }> => {
      if (!license) throw new Error('License module unavailable.');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      return license.startTrial(email) as Promise<{ checkoutUrl: string }>;
    },
    activate: async (key: string): Promise<void> => {
      if (!license) throw new Error('License module unavailable.');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      await (license.activateLicense(key) as Promise<unknown>);
    },
    deactivate: async (): Promise<void> => {
      if (!license) throw new Error('License module unavailable.');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      await (license.deactivateLicense() as Promise<unknown>);
    },
  };

  panel = new SettingsPanel({ context, logger, computeState, handleMessage: msg => handleMessage(msg, licenseOps) });
  context.subscriptions.push({ dispose: () => panel?.dispose() });
  context.subscriptions.push(vscode.commands.registerCommand('ctxloom.openSettings', () => panel?.reveal()));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('ctxloom')) panel?.refresh(); }));

  statusBar = createStatusBarItem('ctxloom.openSettings');
  context.subscriptions.push({ dispose: () => statusBar?.dispose() });

  const updateStatusBar = async (): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    let riskScore: number | null = null;
    if (editor && tools) {
      try { const r = await tools.riskOverlay(vscode.workspace.asRelativePath(editor.document.uri)); riskScore = r?.score ?? null; }
      catch { riskScore = null; }
    }
    const ls = licenseGate?.current() ?? { kind: 'NO_LICENSE' as const };
    const licenseState = ls.kind === 'LICENSED' ? ls : ls.kind === 'TRIALING' ? ls : { kind: 'NO_LICENSE' as const };
    statusBar?.update({ licenseState, riskScore });
  };

  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => { void updateStatusBar(); }));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(d => { if (vscode.window.activeTextEditor?.document === d) void updateStatusBar(); }));

  await startServer(context);
  await updateStatusBar();

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
  }
  // These commands are always registered regardless of server availability.
  context.subscriptions.push(vscode.commands.registerCommand('ctxloom.refreshCodeHealth', () => healthView?.refresh()));
  context.subscriptions.push(vscode.commands.registerCommand('ctxloom.openDashboard', async () => {
    const url = vscode.workspace.getConfiguration('ctxloom').get<string>('dashboardUrl') ?? 'http://localhost:7842';
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }));

  const lensCache = new TtlCache<string, RiskInfo | null>({ ttlMs: 30_000 });
  let lensDisposable: vscode.Disposable | null = null;
  let lensProvider: CtxloomCodeLensProvider | null = null;
  function refreshLens() {
    lensDisposable?.dispose(); lensDisposable = null;
    if (vscode.workspace.getConfiguration('ctxloom').get<boolean>('features.codeLens') && tools) {
      lensProvider = new CtxloomCodeLensProvider({ tools, cache: lensCache });
      lensDisposable = vscode.languages.registerCodeLensProvider({ scheme: 'file' }, lensProvider);
      context.subscriptions.push(lensDisposable);
    }
  }
  refreshLens();
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('ctxloom.features.codeLens')) refreshLens(); }));

  let gutter: GutterDecorations | null = null;
  function refreshGutter() {
    gutter?.dispose(); gutter = null;
    if (vscode.workspace.getConfiguration('ctxloom').get<boolean>('features.gutterDecorations') && tools) {
      gutter = new GutterDecorations({
        tools,
        debounceMs: vscode.workspace.getConfiguration('ctxloom').get<number>('debounceMs') ?? 250,
        thresholds: { high: vscode.workspace.getConfiguration('ctxloom').get<number>('gutter.churnThresholdHigh') ?? 1000, medium: vscode.workspace.getConfiguration('ctxloom').get<number>('gutter.churnThresholdMedium') ?? 200 },
        showDeadCodeMarker: vscode.workspace.getConfiguration('ctxloom').get<boolean>('gutter.showDeadCodeMarker') ?? true,
      });
      context.subscriptions.push({ dispose: () => gutter?.dispose() });
      context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(e => { if (e && gutter) gutter.apply(e); }));
      context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => { const ed = vscode.window.visibleTextEditors.find(x => x.document === e.document); if (ed && gutter) gutter.apply(ed); }));
      if (vscode.window.activeTextEditor) gutter.apply(vscode.window.activeTextEditor);
    }
  }
  refreshGutter();
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('ctxloom.features.gutterDecorations') || e.affectsConfiguration('ctxloom.gutter')) refreshGutter(); }));

  if (tools && vscode.workspace.getConfiguration('ctxloom').get<boolean>('features.quickFixes')) {
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider({ scheme: 'file' }, new CtxloomQuickFixProvider(tools), { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }));
    context.subscriptions.push(vscode.commands.registerCommand('ctxloom.applyRefactor', (a: never) => applyRefactorCommand(tools, a)));
  }

  let mcpBridge: McpBridge | null = null;
  function refreshMcpBridge() {
    mcpBridge?.dispose(); mcpBridge = null;
    if (!vscode.workspace.getConfiguration('ctxloom').get<boolean>('features.mcpBridge')) return;
    const folder = vscode.workspace.workspaceFolders?.[0]; if (!folder) return;
    const cliVersion = manifestCliVersion();
    const override = vscode.workspace.getConfiguration('ctxloom').get<string | null>('cliPath') ?? null;
    const cliPath = resolveCliPath({ globalStorageRoot: context.globalStorageUri.fsPath, cliVersion, override }).path;
    mcpBridge = new McpBridge({ cliPath, cwd: folder.uri.fsPath, logger: logger! });
    mcpBridge.register();
    context.subscriptions.push({ dispose: () => mcpBridge?.dispose() });
  }
  refreshMcpBridge();
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('ctxloom.features.mcpBridge')) refreshMcpBridge(); }));

  registerCommands(context, {
    tools, logger: logger!,
    getDashboardUrl: () => vscode.workspace.getConfiguration('ctxloom').get<string>('dashboardUrl') ?? 'http://localhost:7842',
    licenseGate: licenseGate!,
    licenseOps,
    openSettings: () => panel?.reveal(),
    refreshHealth: () => healthView?.refresh(),
    refreshBlast: () => { if (vscode.window.activeTextEditor) blastView?.refreshFor(vscode.window.activeTextEditor.document.uri); },
  });

  // Auto-open settings on first run with no license
  if (licenseGate!.current().kind === 'NO_LICENSE') panel?.reveal('license' as never);
}

export async function deactivate(): Promise<void> {
  if (serverManager) await serverManager.dispose();
  panel?.dispose();
  logger?.dispose();
}
