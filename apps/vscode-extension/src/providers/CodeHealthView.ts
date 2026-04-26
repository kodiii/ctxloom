import * as vscode from 'vscode';
import type { Tools } from '../client/tools.js';

interface Node { label: string; children?: Node[]; uri?: vscode.Uri; isAction?: boolean }

export class CodeHealthView implements vscode.TreeDataProvider<Node> {
  private root: Node | null = null;
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly tools: Tools, private readonly dashboardUrl: () => string) {}

  async refresh(): Promise<void> {
    let gaps: { isolated: string[]; deadCode: string[] } = { isolated: [], deadCode: [] };
    let hubs: { file: string; importers: number }[] = [];
    let communities: { count: number } = { count: 0 };
    try {
      [gaps, hubs, communities] = await Promise.all([
        this.tools.knowledgeGaps(),
        this.tools.hubNodes(10),
        this.tools.communityList(),
      ]);
    } catch { /* tolerate */ }

    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const fileNode = (label: string): Node => ({
      label,
      uri: vscode.Uri.file(wsRoot + '/' + label),
    });

    this.root = {
      label: 'Code Health',
      children: [
        { label: `Dead code (${gaps.deadCode.length})`, children: gaps.deadCode.slice(0, 10).map(fileNode) },
        {
          label: `Hub files (${hubs.length})`,
          children: hubs.slice(0, 10).map(h => ({
            label: `${h.file} · ↑${h.importers}`,
            uri: vscode.Uri.file(wsRoot + '/' + h.file),
          })),
        },
        { label: `Communities (${communities.count})`, children: [] },
        { label: 'Open in Dashboard →', isAction: true },
      ],
    };
    this.emitter.fire();
  }

  getChildren(node?: Node): vscode.ProviderResult<Node[]> {
    if (!node) return this.root ? [this.root] : [];
    return node.children ?? [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      (node.children?.length ?? 0) > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    if (node.uri) {
      item.resourceUri = node.uri;
      item.command = { command: 'vscode.open', title: 'Open', arguments: [node.uri] };
    }
    if (node.isAction) {
      item.command = { command: 'ctxloom.openDashboard', title: 'Open in Dashboard' };
    }
    return item;
  }
}
