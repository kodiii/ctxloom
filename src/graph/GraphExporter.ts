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

export type ExportFormat = 'graphml' | 'dot' | 'obsidian' | 'svg';

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

  toSVG(): string {
    const files = this.graph.allFiles();
    if (files.length === 0) {
      return '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="80">'
        + '<text x="20" y="50" font-size="14" fill="#94a3b8">No nodes in graph</text></svg>';
    }

    const W = 1400;
    const H = 900;
    const PADDING = 80;
    const NODE_R = 6;

    const positions = new Map<string, { x: number; y: number }>();

    if (files.length <= 50) {
      const r = (Math.min(W, H) - 2 * PADDING) / 2;
      const cx = W / 2;
      const cy = H / 2;
      files.forEach((f, i) => {
        const angle = (2 * Math.PI * i) / files.length - Math.PI / 2;
        positions.set(f, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
      });
    } else {
      const cols = Math.ceil(Math.sqrt(files.length * (W / H)));
      const cellW = (W - 2 * PADDING) / cols;
      const cellH = (H - 2 * PADDING) / Math.ceil(files.length / cols);
      files.forEach((f, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        positions.set(f, {
          x: PADDING + cellW * col + cellW / 2,
          y: PADDING + cellH * row + cellH / 2,
        });
      });
    }

    const lines: string[] = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#fafafa;font-family:monospace">`,
      '<defs>',
      '  <marker id="arr" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="5" markerHeight="5" orient="auto">',
      '    <path d="M0,0 L8,4 L0,8 z" fill="#94a3b8"/>',
      '  </marker>',
      '</defs>',
    ];

    // Edges
    for (const [src, sPos] of positions) {
      for (const tgt of this.graph.getImports(src)) {
        const tPos = positions.get(tgt);
        if (!tPos) continue;
        lines.push(
          `<line x1="${sPos.x.toFixed(1)}" y1="${sPos.y.toFixed(1)}" x2="${tPos.x.toFixed(1)}" y2="${tPos.y.toFixed(1)}" stroke="#94a3b8" stroke-width="0.8" marker-end="url(#arr)" opacity="0.5"/>`,
        );
      }
    }

    // Nodes + labels
    for (const [file, pos] of positions) {
      const importerCount = this.graph.getImporters(file).length;
      const isHub = importerCount >= 5;
      const color = isHub ? '#f59e0b' : '#4f6ef7';
      const r = isHub ? NODE_R + 2 : NODE_R;
      const label = (file.split('/').pop()?.replace(/\.[^.]+$/, '') ?? file).slice(0, 18);
      lines.push(
        `<circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="${r}" fill="${color}" opacity="0.85">`,
        `  <title>${escapeXML(file)} (${importerCount} importers)</title>`,
        `</circle>`,
        `<text x="${pos.x.toFixed(1)}" y="${(pos.y + r + 9).toFixed(1)}" text-anchor="middle" font-size="8" fill="#475569">${escapeXML(label)}</text>`,
      );
    }

    lines.push('</svg>');
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

    if (format === 'svg') {
      const outputPath = path.join(this.exportDir, 'graph.svg');
      fs.writeFileSync(outputPath, this.toSVG(), 'utf-8');
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
