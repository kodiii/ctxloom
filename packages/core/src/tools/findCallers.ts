/**
 * ctx_find_callers / ctx_get_call_graph tool handler.
 *
 * Supports bidirectional call graph traversal with configurable depth
 * per corrected flaw analysis (F-03).
 */
import { ASTParser, CallSite } from '../ast/ASTParser.js';
import { DependencyGraph } from '../graph/DependencyGraph.js';
import path from 'node:path';

function escapeXML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface GetCallGraphOptions {
  symbol: string;
  direction: 'callers' | 'callees';
  depth: number;
  targetFile?: string;
  projectRoot: string;
  parser: ASTParser;
  graph: DependencyGraph;
}

export async function getCallGraph(opts: GetCallGraphOptions): Promise<string> {
  const { symbol, direction, depth, targetFile, projectRoot } = opts;
  const graph = opts.graph;

  // If targetFile provided, start from it; otherwise look up symbol
  let startFiles: string[];
  if (targetFile) {
    startFiles = [targetFile];
  } else {
    const definitions = graph.lookupSymbol(symbol);
    if (definitions.length === 0) {
      return `<call_graph symbol="${escapeXML(symbol)}" direction="${direction}" depth="${depth}" count="0">\n` +
             `  <!-- Symbol not found in graph index -->\n` +
             `</call_graph>`;
    }
    startFiles = definitions.map(d => d.filePath);
  }

  // Traverse the graph
  const allRelated = new Map<string, Set<string>>();
  for (const startFile of startFiles) {
    const related = graph.traverse(startFile, direction, depth);
    allRelated.set(startFile, new Set(related));
  }

  // Build XML output
  let totalCount = 0;
  const lines: string[] = [];

  for (const [startFile, related] of allRelated) {
    lines.push(`  <source file="${escapeXML(startFile)}">`);
    for (const relFile of related) {
      lines.push(`    <${direction === 'callers' ? 'imported_by' : 'imports'} file="${escapeXML(relFile)}" />`);
      totalCount++;
    }
    if (related.size === 0) {
      lines.push(`    <!-- No ${direction} found at depth ${depth} -->`);
    }
    lines.push('  </source>');
  }

  return `<call_graph symbol="${escapeXML(symbol)}" direction="${direction}" depth="${depth}" count="${totalCount}" graph_type="import">\n` +
         lines.join('\n') + '\n' +
         `</call_graph>`;
}

export interface FindCallersOptions {
  targetFile: string;
  symbolName: string;
  projectRoot: string;
  parser: ASTParser;
  graph: DependencyGraph;
}

export async function findCallers(opts: FindCallersOptions): Promise<string> {
  const { targetFile, symbolName, projectRoot } = opts;
  const parser = opts.parser;
  const graph = opts.graph;

  const importers = graph.getImporters(targetFile);
  if (importers.length === 0) {
    return `<callers symbol="${escapeXML(symbolName)}" target="${escapeXML(targetFile)}" count="0">\n` +
           `  <!-- No files import this target -->\n` +
           `</callers>`;
  }

  const callLines: string[] = [];
  let totalCount = 0;

  for (const relPath of importers) {
    const absPath = path.resolve(projectRoot, relPath);
    let sites: CallSite[];
    try {
      sites = await parser.findCallSites(absPath, symbolName);
    } catch {
      continue;
    }

    for (const site of sites) {
      const safeSnippet = site.snippet
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      callLines.push(
        `  <call_site file="${escapeXML(relPath)}" line="${site.line}" snippet="${safeSnippet}" />`,
      );
      totalCount++;
    }
  }

  if (callLines.length === 0) {
    return `<callers symbol="${escapeXML(symbolName)}" target="${escapeXML(targetFile)}" count="0">\n` +
           `  <!-- No call sites found in ${importers.length} importer(s) -->\n` +
           `</callers>`;
  }

  return `<callers symbol="${escapeXML(symbolName)}" target="${escapeXML(targetFile)}" count="${totalCount}">\n` +
         callLines.join('\n') + '\n' +
         `</callers>`;
}
