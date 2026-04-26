import * as vscode from 'vscode';
import type { Tools, RiskInfo } from '../client/tools.js';
import type { TtlCache } from '../shared/cache.js';

export interface CodeLensDeps { tools: Tools; cache: TtlCache<string, RiskInfo | null> }

export class CtxloomCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;
  constructor(private readonly deps: CodeLensDeps) {}

  refresh(): void { this.emitter.fire(); }

  async provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
    const file = vscode.workspace.asRelativePath(document.uri);
    let risk = this.deps.cache.get(file);
    if (risk === undefined) {
      try { risk = await this.deps.tools.riskOverlay(file); } catch { risk = null; }
      this.deps.cache.set(file, risk);
    }

    const lenses: vscode.CodeLens[] = [];
    const top = new vscode.Range(0, 0, 0, 0);
    if (risk !== null) {
      const owner = risk.topOwner !== null ? ` · @${risk.topOwner}` : '';
      lenses.push(new vscode.CodeLens(top, { title: `risk ${risk.score.toFixed(2)} (${risk.label})${owner}`, command: '' }));
    }

    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>('vscode.executeDocumentSymbolProvider', document.uri);
    if (Array.isArray(symbols)) {
      for (const sym of symbols) {
        if (sym.kind === vscode.SymbolKind.Function || sym.kind === vscode.SymbolKind.Method || sym.kind === vscode.SymbolKind.Class) {
          const start = sym.range.start;
          const lensRange = new vscode.Range(start.line, 0, start.line, 0);
          lenses.push(new vscode.CodeLens(lensRange, {
            title: '↗ Copy AI context',
            command: 'ctxloom.copyContextPacket',
            arguments: [{ file, symbol: sym.name }],
          }));
        }
      }
    }
    return lenses;
  }
}
