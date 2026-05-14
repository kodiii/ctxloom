/**
 * Gutter decorations for files in the PR-preview's changed set.
 *
 * Colors the changed line ranges (from `git diff --unified=0`) per
 * file's risk level — medium/high/critical only; low is intentionally
 * un-decorated to keep the gutter quiet for benign changes. Hover
 * over the gutter shows a small risk card (callers, hub status,
 * test coverage, coupled siblings).
 *
 * Reuses `analyzeWorkingTree()` for risk computation and
 * `getChangedLineRanges()` for hunk parsing. Refresh strategy mirrors
 * the status bar: on activation, on save (debounced), and on visible-
 * editor change.
 *
 * Separate from the existing churn-based `GutterDecorations` (which
 * runs against the analyzer's git-coupling tool). Different signal,
 * different cadence, different colors. Co-exists peacefully — VS
 * Code lets multiple decoration types stack per editor.
 */
import * as vscode from 'vscode';
import {
  analyzeWorkingTree,
  type ChangedFilePreview,
  type PreviewResult,
  type RiskLevel,
} from './analyzeWorkingTree.js';
import { getChangedLineRanges, type LineRange } from './getChangedLineRanges.js';

export interface GutterRiskDeps {
  workspace: string;
  log: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
}

interface FileRiskEntry {
  file: ChangedFilePreview;
  ranges: LineRange[];
  /** Cached MarkdownString hover text. Built once per file per refresh. */
  hover: vscode.MarkdownString;
}

const SAVE_DEBOUNCE_MS = 5_000;

export class GutterRiskDecorations {
  private readonly mediumDeco: vscode.TextEditorDecorationType;
  private readonly highDeco: vscode.TextEditorDecorationType;
  private readonly criticalDeco: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];
  private fileMap = new Map<string, FileRiskEntry>();
  private debounceHandle: NodeJS.Timeout | null = null;
  private generation = 0;
  private readonly deps: GutterRiskDeps;

  constructor(deps: GutterRiskDeps) {
    this.deps = deps;
    // Colors mirror the v1.3.1 status-bar palette. We use the same
    // tinted backgroundColor as the existing churn gutter (low alpha
    // so it's visible but not screaming) plus an overview-ruler dot
    // visible from anywhere in the file.
    this.mediumDeco = vscode.window.createTextEditorDecorationType({
      overviewRulerColor: '#f97316',
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      isWholeLine: true,
      backgroundColor: 'rgba(249,115,22,0.08)',
    });
    this.highDeco = vscode.window.createTextEditorDecorationType({
      overviewRulerColor: '#ef4444',
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      isWholeLine: true,
      backgroundColor: 'rgba(239,68,68,0.10)',
    });
    this.criticalDeco = vscode.window.createTextEditorDecorationType({
      overviewRulerColor: '#dc2626',
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      isWholeLine: true,
      backgroundColor: 'rgba(220,38,38,0.14)',
    });

    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(() => this.reapplyAll()),
      vscode.workspace.onDidSaveTextDocument(() => this.scheduleRefresh()),
      this.mediumDeco,
      this.highDeco,
      this.criticalDeco,
    );

    void this.refresh();
  }

  /** Coalesce save bursts (format-on-save touching multiple files). */
  private scheduleRefresh(): void {
    if (this.debounceHandle !== null) clearTimeout(this.debounceHandle);
    this.debounceHandle = setTimeout(() => {
      this.debounceHandle = null;
      void this.refresh();
    }, SAVE_DEBOUNCE_MS);
    this.debounceHandle.unref?.();
  }

  async refresh(): Promise<void> {
    const myGeneration = ++this.generation;
    let result: PreviewResult | null;
    try {
      result = await analyzeWorkingTree({ workspace: this.deps.workspace });
    } catch (err) {
      this.deps.log.warn(
        `gutter risk refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    if (myGeneration !== this.generation) return; // stale, drop
    if (result === null) {
      // No base ref → no preview → no decorations. Clear whatever we had.
      this.fileMap = new Map();
      this.reapplyAll();
      return;
    }

    // Collect the files we'd actually decorate. Low-risk is excluded
    // because it produces too many gutter markers for typical PRs.
    const decoratable = result.changedFiles.filter((f) => f.riskLevel !== 'low');
    if (decoratable.length === 0) {
      this.fileMap = new Map();
      this.reapplyAll();
      return;
    }

    const lineRangesByFile = new Map<string, LineRange[]>();
    try {
      const ranges = await getChangedLineRanges(this.deps.workspace, result.base);
      for (const r of ranges) lineRangesByFile.set(r.file, r.ranges);
    } catch (err) {
      this.deps.log.warn(
        `gutter risk: could not parse diff for ${result.base}...HEAD — ${err instanceof Error ? err.message : String(err)}`,
      );
      // Fall through with an empty map; we still want to clear any
      // stale decorations from a prior run.
    }

    if (myGeneration !== this.generation) return;

    const next = new Map<string, FileRiskEntry>();
    for (const file of decoratable) {
      const ranges = lineRangesByFile.get(file.file) ?? [];
      if (ranges.length === 0) continue; // nothing useful to highlight
      next.set(file.file, {
        file,
        ranges,
        hover: buildHover(file, result.coupledNodes.filter((c) => c.for === file.file)),
      });
    }
    this.fileMap = next;
    this.reapplyAll();
  }

  private reapplyAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.applyToEditor(editor);
    }
  }

  private applyToEditor(editor: vscode.TextEditor): void {
    const relPath = vscode.workspace.asRelativePath(editor.document.uri);
    const entry = this.fileMap.get(relPath);
    if (!entry) {
      // Editor for a non-risky file (or no preview) — clear all three
      // decoration sets so a previously risky file that's been cleaned
      // up doesn't leave stale markers.
      editor.setDecorations(this.mediumDeco, []);
      editor.setDecorations(this.highDeco, []);
      editor.setDecorations(this.criticalDeco, []);
      return;
    }

    const ranges: vscode.DecorationOptions[] = [];
    const lineMax = editor.document.lineCount - 1;
    for (const r of entry.ranges) {
      const startLine = clamp(r.start - 1, 0, lineMax);
      const endLine = clamp(r.start + r.count - 2, 0, lineMax);
      ranges.push({
        range: new vscode.Range(startLine, 0, endLine, 0),
        hoverMessage: entry.hover,
      });
    }

    const deco =
      entry.file.riskLevel === 'critical'
        ? this.criticalDeco
        : entry.file.riskLevel === 'high'
          ? this.highDeco
          : this.mediumDeco;

    // Clear the other two sets so we don't end up with overlapping
    // markers if a file's risk level changes between refreshes.
    editor.setDecorations(this.mediumDeco, deco === this.mediumDeco ? ranges : []);
    editor.setDecorations(this.highDeco, deco === this.highDeco ? ranges : []);
    editor.setDecorations(this.criticalDeco, deco === this.criticalDeco ? ranges : []);
  }

  dispose(): void {
    if (this.debounceHandle !== null) clearTimeout(this.debounceHandle);
    for (const d of this.disposables) d.dispose();
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

const RISK_EMOJI: Record<RiskLevel, string> = {
  low: '🟢',
  medium: '🟠',
  high: '🔴',
  critical: '🚨',
};

function buildHover(
  file: ChangedFilePreview,
  coupled: ReadonlyArray<{ node: string; confidence: number }>,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = false; // no command links in the hover
  md.supportThemeIcons = true;

  md.appendMarkdown(`**${RISK_EMOJI[file.riskLevel]} ctxloom: ${file.riskLevel} risk**\n\n`);

  const callersLabel = file.importerCount === 1 ? 'caller' : 'callers';
  md.appendMarkdown(`- **${file.importerCount}** ${callersLabel}`);
  if (file.isHub) md.appendMarkdown(' (hub file — ≥ 5 importers)');
  md.appendMarkdown('\n');
  md.appendMarkdown(
    `- Test coverage: ${file.hasTestCoverage ? '✅ found' : '❌ none detected'}\n`,
  );

  const strongCoupling = coupled.filter((c) => c.confidence >= 0.5).slice(0, 3);
  if (strongCoupling.length > 0) {
    md.appendMarkdown('\n**Historical co-change:**\n');
    for (const c of strongCoupling) {
      const pct = Math.round(c.confidence * 100);
      md.appendMarkdown(`- \`${c.node}\` (${pct}%)\n`);
    }
  }

  md.appendMarkdown('\n_Click the status bar badge to open the full ctxloom PR preview._');
  return md;
}
