import * as vscode from 'vscode';
import type { Tools } from '../client/tools.js';
import { debounce } from '../shared/debounce.js';

export interface GutterDeps {
  tools: Tools;
  debounceMs: number;
  thresholds: { high: number; medium: number };
  showDeadCodeMarker: boolean;
}

export class GutterDecorations {
  private readonly highDeco = vscode.window.createTextEditorDecorationType({
    gutterIconSize: 'contain',
    overviewRulerColor: '#ef4444',
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    isWholeLine: true,
    backgroundColor: 'rgba(239,68,68,0.06)',
  });
  private readonly mediumDeco = vscode.window.createTextEditorDecorationType({
    overviewRulerColor: '#f97316',
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    isWholeLine: true,
    backgroundColor: 'rgba(249,115,22,0.06)',
  });
  private readonly lowDeco = vscode.window.createTextEditorDecorationType({
    overviewRulerColor: '#3b82f6',
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    isWholeLine: true,
    backgroundColor: 'rgba(59,130,246,0.04)',
  });
  private readonly deadDeco = vscode.window.createTextEditorDecorationType({
    after: { contentText: ' ⚠ dead code', color: '#a1a1aa', margin: '0 0 0 0.5em' },
  });

  private readonly applyForEditor: ReturnType<typeof debounce<[vscode.TextEditor]>>;

  constructor(private readonly deps: GutterDeps) {
    this.applyForEditor = debounce(async (editor: vscode.TextEditor) => {
      await this.applyImpl(editor);
    }, this.deps.debounceMs);
  }

  apply(editor: vscode.TextEditor): void {
    this.applyForEditor(editor);
  }

  private async applyImpl(editor: vscode.TextEditor): Promise<void> {
    const file = vscode.workspace.asRelativePath(editor.document.uri);
    let info: { churnLines: number; bucket: 'low' | 'medium' | 'high'; importers: number };
    try {
      info = await this.deps.tools.gitCoupling(file);
    } catch {
      return;
    }
    const wholeFile = new vscode.Range(0, 0, editor.document.lineCount - 1, 0);
    editor.setDecorations(this.highDeco, info.bucket === 'high' ? [wholeFile] : []);
    editor.setDecorations(this.mediumDeco, info.bucket === 'medium' ? [wholeFile] : []);
    editor.setDecorations(this.lowDeco, info.bucket === 'low' ? [wholeFile] : []);
    editor.setDecorations(
      this.deadDeco,
      this.deps.showDeadCodeMarker && info.importers === 0 ? [new vscode.Range(0, 0, 0, 0)] : [],
    );
  }

  clearAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.highDeco, []);
      editor.setDecorations(this.mediumDeco, []);
      editor.setDecorations(this.lowDeco, []);
      editor.setDecorations(this.deadDeco, []);
    }
  }

  dispose(): void {
    this.applyForEditor.cancel();
    this.highDeco.dispose();
    this.mediumDeco.dispose();
    this.lowDeco.dispose();
    this.deadDeco.dispose();
  }
}
