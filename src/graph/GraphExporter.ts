/**
 * GraphExporter — Export the import graph to visualization formats.
 *
 * Supported formats:
 *   graphml  — XML for Gephi / yEd / NetworkX
 *   dot      — Graphviz directed graph language
 *   obsidian — One Markdown file per node with [[wikilinks]] for edges;
 *              compatible with Obsidian's graph view
 *
 * All output is written to .ctxloom/export/ (created on demand).
 * For 'obsidian', each node file is named by slugifying its path
 * (slashes → double underscores): src/auth/user.ts → src__auth__user.ts.md
 */
import fs from 'node:fs';
import path from 'node:path';
import type { DependencyGraph } from './DependencyGraph.js';

export type ExportFormat = 'graphml' | 'dot' | 'obsidian';

export interface ExportResult {
  format: ExportFormat;
  outputPath: string;
  nodeCount: number;
  edgeCount: number;
}

function escapeXML(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function slugifyPath(p: string): string {
  return p.replace(/[/\\]/g, '__').replace(/[^a-zA-Z0-9._-]/g, '-');
}

export class GraphExporter {
  private readonly exportDir: string;

  constructor(
    private readonly graph: DependencyGraph,
    private readonly rootDir: string,
  ) {
    this.exportDir = path.join(rootDir, '.ctxloom', 'export');
  }

  toGraphML(): string {
    const files = this.graph.allFiles();
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<graphml xmlns="http://graphml.graphstruct.org/graphml">',
      '  <graph id="G" edgedefault="directed">',
    ];
    for (const file of files) {
      lines.push(`    <node id="${escapeXML(file)}" />`);
    }
    let edgeId = 0;
    for (const file of files) {
      for (const imported of this.graph.getImports(file)) {
        lines.push(
          `    <edge id="e${edgeId++}" source="${escapeXML(file)}" target="${escapeXML(imported)}" />`,
        );
      }
    }
    lines.push('  </graph>', '</graphml>');
    return lines.join('\n');
  }

  toDOT(): string {
    const files = this.graph.allFiles();
    const lines = ['digraph G {', '  rankdir=LR;'];
    for (const file of files) {
      lines.push(`  "${file.replace(/"/g, '\\"')}";`);
    }
    for (const file of files) {
      for (const imported of this.graph.getImports(file)) {
        lines.push(
          `  "${file.replace(/"/g, '\\"')}" -> "${imported.replace(/"/g, '\\"')}";`,
        );
      }
    }
    lines.push('}');
    return lines.join('\n');
  }

  export(format: ExportFormat): ExportResult {
    fs.mkdirSync(this.exportDir, { recursive: true });
    const files = this.graph.allFiles();
    const edgeCount = this.graph.edgeCount();

    if (format === 'graphml') {
      const outputPath = path.join(this.exportDir, 'graph.graphml');
      fs.writeFileSync(outputPath, this.toGraphML(), 'utf-8');
      return { format, outputPath, nodeCount: files.length, edgeCount };
    }

    if (format === 'dot') {
      const outputPath = path.join(this.exportDir, 'graph.dot');
      fs.writeFileSync(outputPath, this.toDOT(), 'utf-8');
      return { format, outputPath, nodeCount: files.length, edgeCount };
    }

    // obsidian: write one .md file per node
    const obsidianDir = path.join(this.exportDir, 'obsidian');
    fs.mkdirSync(obsidianDir, { recursive: true });

    for (const file of files) {
      const slug = slugifyPath(file);
      const imports = this.graph.getImports(file);
      const importers = this.graph.getImporters(file);

      const lines = [`# ${file}`, ''];

      if (imports.length > 0) {
        lines.push('## Imports', '');
        for (const imp of imports) lines.push(`- [[${slugifyPath(imp)}]]`);
        lines.push('');
      }

      if (importers.length > 0) {
        lines.push('## Imported By', '');
        for (const imp of importers) lines.push(`- [[${slugifyPath(imp)}]]`);
        lines.push('');
      }

      fs.writeFileSync(path.join(obsidianDir, `${slug}.md`), lines.join('\n'), 'utf-8');
    }

    return { format, outputPath: obsidianDir, nodeCount: files.length, edgeCount };
  }
}
