import * as vscode from 'vscode';
import { parseWebviewMessage, type HostToWebview, type WebviewToHost, type PanelState } from './messageProtocol.js';
import type { Logger } from '../shared/logger.js';

export interface SettingsPanelDeps {
  context: vscode.ExtensionContext;
  logger: Logger;
  /** Returns the current panel state — license + settings snapshot. */
  computeState: () => PanelState;
  /** Handle a Webview→Host message. */
  handleMessage: (msg: WebviewToHost) => Promise<void>;
}

const VIEW_TYPE = 'ctxloom.settings';
const PANEL_TITLE = 'ctxloom Settings';

export class SettingsPanel {
  private panel: vscode.WebviewPanel | null = null;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly deps: SettingsPanelDeps) {}

  /** Open or reveal the panel. Idempotent — clicking the status bar twice does not spawn two panels. */
  reveal(focusSection?: 'license' | 'features' | 'performance' | 'display' | 'pr-review' | 'telemetry' | 'advanced'): void {
    if (this.panel !== null) {
      this.panel.reveal(vscode.ViewColumn.Active);
      if (focusSection) this.send({ kind: 'state', state: { ...this.deps.computeState(), banner: undefined } });
      return;
    }
    this.panel = vscode.window.createWebviewPanel(VIEW_TYPE, PANEL_TITLE, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.deps.context.extensionUri, 'dist', 'webview')],
    });
    this.panel.webview.html = this.renderHtml(this.panel.webview);
    this.panel.onDidDispose(() => { this.panel = null; for (const d of this.disposables) d.dispose(); this.disposables.length = 0; }, null, this.disposables);
    this.disposables.push(this.panel.webview.onDidReceiveMessage(async raw => {
      const msg = parseWebviewMessage(raw);
      if (msg === null) { this.deps.logger.warn(`SettingsPanel: rejected malformed message ${JSON.stringify(raw)}`); return; }
      if (msg.kind === 'ready') { this.send({ kind: 'state', state: this.deps.computeState() }); return; }
      try { await this.deps.handleMessage(msg); }
      catch (err) { this.deps.logger.error(`SettingsPanel handler failed: ${String(err)}`); }
    }));
  }

  /** Send a Host→Webview message (no-op if panel is closed). */
  send(msg: HostToWebview): void {
    if (this.panel === null) return;
    this.panel.webview.postMessage(msg).then(undefined, err => this.deps.logger.warn(`postMessage failed: ${String(err)}`));
  }

  /** Push a fresh state snapshot — call this whenever license/settings change externally. */
  refresh(): void { this.send({ kind: 'state', state: this.deps.computeState() }); }

  isOpen(): boolean { return this.panel !== null; }

  dispose(): void {
    if (this.panel !== null) this.panel.dispose();
    this.panel = null;
  }

  private renderHtml(webview: vscode.Webview): string {
    const indexUri = webview.asWebviewUri(vscode.Uri.joinPath(this.deps.context.extensionUri, 'dist', 'webview', 'main.js'));
    const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this.deps.context.extensionUri, 'dist', 'webview', 'styles.css'));
    const nonce = randomNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<link rel="stylesheet" href="${stylesUri}" />
<title>ctxloom Settings</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${indexUri}"></script>
</body>
</html>`;
  }
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
