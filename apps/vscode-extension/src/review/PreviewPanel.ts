/**
 * Webview panel for `ctxloom: Preview PR review`. Renders the Markdown
 * produced by `renderPreview()` inside a VS Code webview, with a small
 * "Refresh" button so the user can re-run the analysis after editing.
 *
 * Singleton — re-invoking the command reveals the existing panel
 * rather than spawning duplicates.
 */
import * as vscode from 'vscode';
import { analyzeWorkingTree, type PreviewResult } from './analyzeWorkingTree.js';
import { renderPreview } from './renderPreview.js';

interface PanelDeps {
  /** Workspace folder to analyze. */
  workspace: string;
  /** Optional base ref override. */
  baseRef?: string;
  /** Logger from the extension (already wired to `captureError`). */
  log: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
}

export class PreviewPanel {
  private static current: PreviewPanel | null = null;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private deps: PanelDeps;

  static showOrReveal(deps: PanelDeps): PreviewPanel {
    if (PreviewPanel.current !== null) {
      PreviewPanel.current.deps = deps; // refresh workspace/baseRef on re-invocation
      PreviewPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      void PreviewPanel.current.refresh();
      return PreviewPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      'ctxloom.previewPrReview',
      'ctxloom: PR review preview',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    PreviewPanel.current = new PreviewPanel(panel, deps);
    return PreviewPanel.current;
  }

  private constructor(panel: vscode.WebviewPanel, deps: PanelDeps) {
    this.panel = panel;
    this.deps = deps;

    this.panel.webview.onDidReceiveMessage(
      (msg: { kind?: string } | undefined) => {
        if (msg?.kind === 'refresh') void this.refresh();
      },
      undefined,
      this.disposables,
    );

    this.panel.onDidDispose(
      () => {
        for (const d of this.disposables) d.dispose();
        PreviewPanel.current = null;
      },
      undefined,
      this.disposables,
    );

    // Initial render — fire and forget. The webview shows a loading
    // state until refresh() finishes.
    this.panel.webview.html = this.shellHtml('Analyzing working tree…');
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      this.panel.webview.html = this.shellHtml('Analyzing working tree…');
      const result = await analyzeWorkingTree({
        workspace: this.deps.workspace,
        baseRef: this.deps.baseRef,
      });
      if (result === null) {
        this.panel.webview.html = this.shellHtml(
          '⚠️ No usable base ref found — checked `origin/HEAD`, `origin/main`, `origin/master`, `main`, `master`. ' +
            'Set a remote-tracking branch (e.g. `git push -u origin main`) and try again.',
        );
        return;
      }
      const md = renderPreview(result);
      this.panel.webview.html = this.shellHtml(md, result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.deps.log.error(`preview-pr-review failed: ${msg}`);
      this.panel.webview.html = this.shellHtml(
        `❌ Analysis failed:\n\n\`\`\`\n${msg}\n\`\`\``,
      );
    }
  }

  /**
   * Render the panel HTML. Uses VS Code's theme variables so the
   * panel blends with the rest of the editor.
   *
   * The content is a Markdown blob — we ship a tiny client-side
   * Markdown→HTML pass rather than depend on a library. Just enough
   * for headings, paragraphs, bold, code, tables, lists, and
   * blockquotes — everything the renderer actually emits.
   */
  private shellHtml(content: string, result?: PreviewResult): string {
    const csp = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';";
    const escaped = escapeHtml(content);
    const meta = result
      ? `<div class="meta">${escapeHtml(`${result.base} → ${result.headSha.slice(0, 7)}`)}</div>`
      : '';
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>ctxloom: PR review preview</title>
  <style>
    body { font: 13px/1.5 var(--vscode-editor-font-family); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); padding: 16px 24px; }
    h1, h2, h3 { color: var(--vscode-editor-foreground); }
    h2 { margin-top: 0; }
    code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
    pre { background: var(--vscode-textCodeBlock-background); padding: 8px 12px; border-radius: 4px; overflow-x: auto; }
    blockquote { border-left: 3px solid var(--vscode-textBlockQuote-border); padding-left: 12px; color: var(--vscode-textBlockQuote-foreground); margin: 8px 0; }
    table { border-collapse: collapse; margin: 8px 0; }
    th, td { border: 1px solid var(--vscode-panel-border); padding: 4px 10px; text-align: left; }
    .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--vscode-panel-border); }
    .meta { font-size: 11px; color: var(--vscode-descriptionForeground); }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer; font-size: 12px; }
    button:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <div class="toolbar">
    ${meta}
    <button id="refresh">Refresh</button>
  </div>
  <div id="content">${renderMarkdown(escaped)}</div>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('refresh').addEventListener('click', () => {
      vscode.postMessage({ kind: 'refresh' });
    });
  </script>
</body>
</html>`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Convert the escaped Markdown blob produced by `renderPreview` into
 * HTML. Handles the exact subset the renderer emits — headings,
 * bold, inline code, code fences, tables, blockquotes, list items,
 * paragraphs. Anything more elaborate (links, images, nested lists)
 * would be a no-op pass-through.
 */
function renderMarkdown(escapedMd: string): string {
  // Code fences first so their content isn't further transformed.
  let html = escapedMd.replace(/```([\s\S]*?)```/g, (_m, code) => `<pre><code>${code}</code></pre>`);

  const lines = html.split('\n');
  const out: string[] = [];
  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // Headings
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      out.push(`<h${h[1].length}>${inlineMd(h[2])}</h${h[1].length}>`);
      continue;
    }
    // Blockquote
    if (line.startsWith('&gt; ')) {
      out.push(`<blockquote>${inlineMd(line.slice(5))}</blockquote>`);
      continue;
    }
    // List item
    if (/^- /.test(line)) {
      out.push(`<li>${inlineMd(line.slice(2))}</li>`);
      continue;
    }
    // Table row
    if (line.startsWith('| ')) {
      // Skip the separator row "|---|---|"
      if (/^\|\s*-+\s*\|/.test(line)) continue;
      if (!inTable) {
        out.push('<table>');
        inTable = true;
      }
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      out.push('<tr>' + cells.map((c) => `<td>${inlineMd(c)}</td>`).join('') + '</tr>');
      continue;
    } else if (inTable) {
      out.push('</table>');
      inTable = false;
    }
    if (line.trim() === '') {
      out.push('');
      continue;
    }
    out.push(`<p>${inlineMd(line)}</p>`);
  }
  if (inTable) out.push('</table>');
  return out.join('\n');
}

function inlineMd(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
