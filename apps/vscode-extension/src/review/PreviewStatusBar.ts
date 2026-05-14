/**
 * Status bar item that reflects the current branch's PR-preview risk
 * (low / medium / high / critical) without opening the webview.
 *
 * Click → opens the full preview panel (`ctxloom.previewPrReview`).
 * Refresh strategy: on activation, on file save (debounced), and on
 * explicit dispatch from anywhere that knows the analysis is stale.
 *
 * The actual analysis logic lives in `analyzeWorkingTree.ts`; this
 * module is the glue between that engine and VS Code's status-bar API.
 * Pure-rendering logic is exported separately so it can be unit-tested
 * without spinning up vscode.
 */
import * as vscode from 'vscode';
import { analyzeWorkingTree, type PreviewResult, type RiskLevel } from './analyzeWorkingTree.js';

export interface StatusBarDeps {
  workspace: string;
  log: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
  /** Command id to invoke when the status bar is clicked. */
  commandId: string;
}

interface StatusBarTextInputs {
  state: 'idle' | 'analyzing' | 'no-base' | 'no-changes' | 'has-result' | 'error';
  result?: PreviewResult;
  base?: string;
}

export interface StatusBarOutput {
  text: string;
  tooltip: string;
  /** ThemeColor id, or undefined for the default foreground. */
  colorId: string | undefined;
}

const EMOJI: Record<RiskLevel, string> = {
  low: '🟢',
  medium: '🟠',
  high: '🔴',
  critical: '🚨',
};

/**
 * Pure rendering — exported for unit tests. Given a state snapshot,
 * returns the strings/colors the status bar should show. No vscode
 * dependency, no I/O.
 */
export function renderPreviewStatusBar(inputs: StatusBarTextInputs): StatusBarOutput {
  switch (inputs.state) {
    case 'analyzing':
      return {
        text: '$(sync~spin) ctxloom: …',
        tooltip: 'ctxloom: analyzing changes against base ref',
        colorId: undefined,
      };
    case 'no-base':
      return {
        text: '$(question) ctxloom',
        tooltip:
          'ctxloom: no usable base ref found. Set a remote-tracking branch (e.g. `git push -u origin main`) and refresh.',
        colorId: 'statusBarItem.warningForeground',
      };
    case 'no-changes':
      return {
        text: 'ctxloom: clean',
        tooltip: inputs.base
          ? `ctxloom: no files changed vs \`${inputs.base}\`. Click to open the full preview.`
          : 'ctxloom: no files changed. Click to open the full preview.',
        colorId: undefined,
      };
    case 'has-result': {
      const result = inputs.result;
      if (!result || result.topLevel === null) {
        // Defensive fall-through: caller misclassified as has-result.
        return {
          text: 'ctxloom: clean',
          tooltip: 'ctxloom: no files changed. Click to open the full preview.',
          colorId: undefined,
        };
      }
      const emoji = EMOJI[result.topLevel];
      const text = `${emoji} ctxloom: ${result.topLevel}`;
      const fileCount = result.changedFiles.length;
      const tooltip =
        `ctxloom: ${result.topLevel} risk · ` +
        `${fileCount} file${fileCount !== 1 ? 's' : ''} changed vs \`${result.base}\` · ` +
        `blast radius ${result.blastRadius}` +
        '\nClick to open the full preview.';
      // Tint medium/high/critical so they pop out of the status bar.
      // VS Code only ships warning/error foreground colors; critical
      // and high share the error color, medium uses warning.
      const colorId =
        result.topLevel === 'critical' || result.topLevel === 'high'
          ? 'statusBarItem.errorForeground'
          : result.topLevel === 'medium'
            ? 'statusBarItem.warningForeground'
            : undefined;
      return { text, tooltip, colorId };
    }
    case 'error':
      return {
        text: '$(alert) ctxloom',
        tooltip: 'ctxloom: preview analysis failed. Click to see the full panel for details.',
        colorId: 'statusBarItem.errorForeground',
      };
    case 'idle':
    default:
      return {
        text: 'ctxloom',
        tooltip: 'ctxloom: click to preview your PR review.',
        colorId: undefined,
      };
  }
}

const SAVE_DEBOUNCE_MS = 5_000;

export class PreviewStatusBar {
  private readonly item: vscode.StatusBarItem;
  private readonly deps: StatusBarDeps;
  private readonly disposables: vscode.Disposable[] = [];
  private debounceHandle: NodeJS.Timeout | null = null;
  /** Generation counter — stale analyses ignore their own results. */
  private generation = 0;

  constructor(deps: StatusBarDeps) {
    this.deps = deps;
    // Priority 99 keeps us just left of the license/per-file status
    // bar (priority 100), so the two ctxloom indicators sit together.
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    this.item.command = deps.commandId;
    this.apply({ state: 'idle' });
    this.item.show();
    this.disposables.push(this.item);

    // Refresh on save with debounce — we don't want to rebuild the
    // dependency graph on every keystroke autosave fires.
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument(() => this.scheduleRefresh()),
    );

    // First analysis fires immediately after the status bar appears
    // so the user sees a real value, not "ctxloom" idle text.
    void this.refresh();
  }

  /**
   * Schedule a refresh, coalescing rapid-fire events (e.g. format-on-save
   * touching multiple files in a single batch). The trailing-edge run
   * fires `SAVE_DEBOUNCE_MS` after the last event in a burst.
   */
  private scheduleRefresh(): void {
    if (this.debounceHandle !== null) clearTimeout(this.debounceHandle);
    this.debounceHandle = setTimeout(() => {
      this.debounceHandle = null;
      void this.refresh();
    }, SAVE_DEBOUNCE_MS);
    // Don't keep the process alive — vscode owns the lifecycle.
    this.debounceHandle.unref?.();
  }

  async refresh(): Promise<void> {
    const myGeneration = ++this.generation;
    this.apply({ state: 'analyzing' });
    try {
      const result = await analyzeWorkingTree({ workspace: this.deps.workspace });
      // Bail if another refresh raced past us.
      if (myGeneration !== this.generation) return;
      if (result === null) {
        this.apply({ state: 'no-base' });
        return;
      }
      if (result.changedFiles.length === 0) {
        this.apply({ state: 'no-changes', base: result.base });
        return;
      }
      this.apply({ state: 'has-result', result });
    } catch (err) {
      if (myGeneration !== this.generation) return;
      const msg = err instanceof Error ? err.message : String(err);
      this.deps.log.warn(`preview status bar refresh failed: ${msg}`);
      this.apply({ state: 'error' });
    }
  }

  private apply(inputs: StatusBarTextInputs): void {
    const r = renderPreviewStatusBar(inputs);
    this.item.text = r.text;
    this.item.tooltip = r.tooltip;
    this.item.color = r.colorId !== undefined ? new vscode.ThemeColor(r.colorId) : undefined;
  }

  dispose(): void {
    if (this.debounceHandle !== null) clearTimeout(this.debounceHandle);
    for (const d of this.disposables) d.dispose();
  }
}
