import * as vscode from 'vscode';
import type { Tools, RuleViolation } from '../client/tools.js';

export class CtxloomDiagnosticsProvider {
  private readonly collection: vscode.DiagnosticCollection;
  constructor(private readonly tools: Tools) {
    this.collection = vscode.languages.createDiagnosticCollection('ctxloom');
  }

  async refresh(uri: vscode.Uri): Promise<void> {
    const file = vscode.workspace.asRelativePath(uri);
    let violations: RuleViolation[] = [];
    try { violations = await this.tools.rulesCheck(file); }
    catch { /* server-down → keep last diagnostics; spec rule "providers tolerate server-down" */ return; }
    const diags = violations.map(v => {
      const range = new vscode.Range(v.line - 1, v.col - 1, v.endLine - 1, v.endCol - 1);
      const sev = v.severity === 'error' ? vscode.DiagnosticSeverity.Error
        : v.severity === 'warning' ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Information;
      const d = new vscode.Diagnostic(range, v.message, sev);
      d.source = 'ctxloom';
      d.code = v.rule;
      return d;
    });
    this.collection.set(uri, diags);
  }

  clear(uri: vscode.Uri): void { this.collection.delete(uri); }
  dispose(): void { this.collection.dispose(); }
}
