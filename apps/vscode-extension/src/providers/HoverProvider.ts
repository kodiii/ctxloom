import * as vscode from 'vscode';
import type { Tools, RiskInfo, BlastResult } from '../client/tools.js';
import type { TtlCache } from '../shared/cache.js';

interface CachedHover { risk: RiskInfo | null; blast: BlastResult }

export interface HoverDeps { tools: Tools; cache: TtlCache<string, CachedHover>; dashboardUrl: string }

const IMPORT_RE = /['"]([^'"]+)['"]/;

export class CtxloomHoverProvider implements vscode.HoverProvider {
  constructor(private readonly deps: HoverDeps) {}

  async provideHover(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken): Promise<vscode.Hover | null> {
    const range = document.getWordRangeAtPosition(position, IMPORT_RE);
    if (!range) return null;
    const matchedString = document.getText(range);
    const inner = matchedString.slice(1, -1);
    if (!/[./]/.test(inner)) return null;
    const cacheKey = inner;
    let entry = this.deps.cache.get(cacheKey);
    if (entry === undefined) {
      const [risk, blast] = await Promise.all([this.deps.tools.riskOverlay(inner), this.deps.tools.blastRadius(inner)]);
      entry = { risk, blast };
      this.deps.cache.set(cacheKey, entry);
    }
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = false;
    if (entry.risk !== null) {
      md.appendMarkdown(`**ctxloom** · risk \`${entry.risk.score.toFixed(2)}\` (${entry.risk.label})`);
      if (entry.risk.topOwner !== null) md.appendMarkdown(` · @${entry.risk.topOwner}`);
      md.appendMarkdown('  \n');
    } else {
      md.appendMarkdown('**ctxloom**  \n');
    }
    const blastCount = entry.blast.direct.length + entry.blast.transitive.length;
    md.appendMarkdown(`↗ ${blastCount} files in blast radius  \n`);
    md.appendMarkdown(`[Open in dashboard](${this.deps.dashboardUrl}/risk?file=${encodeURIComponent(inner)})`);
    return new vscode.Hover(md, range);
  }
}
