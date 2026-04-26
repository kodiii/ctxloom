import * as vscode from 'vscode';
import type { Tools, BlastResult } from '../client/tools.js';

interface Node { label: string; uri?: vscode.Uri; children?: Node[]; iconId?: string }

export class BlastRadiusView implements vscode.TreeDataProvider<Node> {
  private root: Node | null = null;
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly tools: Tools) {}

  async refreshFor(uri: vscode.Uri): Promise<void> {
    const file = vscode.workspace.asRelativePath(uri);
    let blast: BlastResult;
    try { blast = await this.tools.blastRadius(file); }
    catch { this.root = { label: 'Blast radius unavailable' }; this.emitter.fire(); return; }

    const fileNode = (path: string): Node => ({
      label: path,
      uri: vscode.Uri.file((vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '') + '/' + path),
    });

    this.root = {
      label: `Blast for ${file}`,
      children: [
        { label: `Direct importers (${blast.direct.length})`, children: blast.direct.map(fileNode) },
        { label: `Transitive (${blast.transitive.length})`, children: blast.transitive.map(fileNode) },
        { label: `Historical coupling (${blast.historical.length})`, children: blast.historical.map(fileNode) },
      ],
    };
    this.emitter.fire();
  }

  getChildren(node?: Node): vscode.ProviderResult<Node[]> {
    if (!node) return this.root ? [this.root] : [];
    return node.children ?? [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    const collapsible = (node.children?.length ?? 0) > 0
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(node.label, collapsible);
    if (node.uri) {
      item.resourceUri = node.uri;
      item.command = { command: 'vscode.open', title: 'Open', arguments: [node.uri] };
    }
    return item;
  }
}
