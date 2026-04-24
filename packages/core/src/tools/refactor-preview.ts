/**
 * ctx_refactor_preview — Read-only symbol rename diff preview.
 *
 * Finds all occurrences of a symbol across the codebase and shows exactly
 * what lines would change in a rename — without writing anything to disk.
 *
 * Algorithm:
 *   1. Look up symbol definitions via DependencyGraph.lookupSymbol()
 *   2. Collect candidate files: definition files + all their importers
 *      + files that call the symbol (via CallGraphIndex)
 *   3. Scan each candidate file with a whole-word regex \b{symbol}\b
 *   4. Return per-file before/after line diffs in XML
 */
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';

const Schema = z.object({
  symbol: z.string().min(1).describe('Symbol name to rename (exact match, case-sensitive)'),
  new_name: z.string().min(1).describe('New name for the symbol'),
  max_files: z.number().min(1).max(200).optional().default(50).describe(
    'Maximum number of files to scan for occurrences (default: 50)',
  ),
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface OccurrenceLine {
  line: number;
  before: string;
  after: string;
}

interface FileChange {
  filePath: string;
  occurrences: OccurrenceLine[];
}

function scanFile(filePath: string, symbol: string, newName: string): OccurrenceLine[] {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const regex = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  const fileLines = content.split('\n');
  const results: OccurrenceLine[] = [];

  for (let i = 0; i < fileLines.length; i++) {
    if (regex.test(fileLines[i])) {
      results.push({
        line: i + 1,
        before: fileLines[i],
        after: fileLines[i].replace(regex, newName),
      });
    }
    // Reset lastIndex for global regex
    regex.lastIndex = 0;
  }

  return results;
}

export function registerRefactorPreviewTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_refactor_preview',
    {
      name: 'ctx_refactor_preview',
      description:
        'Preview a symbol rename without writing to disk. ' +
        'Finds every occurrence of the symbol across definition files, importers, and call sites, ' +
        'and returns before/after line diffs per file. Read-only — nothing is modified.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Symbol name to rename (exact match, case-sensitive)',
          },
          new_name: {
            type: 'string',
            description: 'New name for the symbol',
          },
          max_files: {
            type: 'number',
            description: 'Maximum number of candidate files to scan (default: 50)',
          },
        },
        required: ['symbol', 'new_name'],
      },
    },
    async (args) => {
      const { symbol, new_name, max_files } = Schema.parse(args);

      const graph = await ctx.getGraph();

      // 1. Look up definitions
      const definitions = graph.lookupSymbol(symbol);

      // 2. Collect candidate files (definition files + their importers + call sites)
      const candidateSet = new Set<string>();

      for (const def of definitions) {
        candidateSet.add(def.filePath);
        for (const importer of graph.getImporters(def.filePath)) {
          candidateSet.add(importer);
        }
      }

      // Also collect files that directly call the symbol via call graph
      const callIdx = graph.getCallGraphIndex();
      for (const caller of callIdx.getCallers(symbol)) {
        candidateSet.add(caller.file);
      }

      // 3. Scan files for occurrences (up to max_files)
      const candidates = Array.from(candidateSet).slice(0, max_files);
      const fileChanges: FileChange[] = [];
      let totalOccurrences = 0;

      for (const relPath of candidates) {
        const absPath = path.join(ctx.projectRoot, relPath);
        const occurrences = scanFile(absPath, symbol, new_name);
        if (occurrences.length > 0) {
          fileChanges.push({ filePath: relPath, occurrences });
          totalOccurrences += occurrences.length;
        }
      }

      // 4. Build XML response
      const xmlLines: string[] = [
        `<refactor_preview symbol="${escapeXML(symbol)}" new_name="${escapeXML(new_name)}" total_files="${fileChanges.length}" total_occurrences="${totalOccurrences}">`,
      ];

      // definitions section
      xmlLines.push(`  <definitions count="${definitions.length}">`);
      for (const def of definitions) {
        xmlLines.push(
          `    <definition file="${escapeXML(def.filePath)}" type="${escapeXML(def.type)}" signature="${escapeXML(def.signature)}" />`,
        );
      }
      xmlLines.push('  </definitions>');

      // changes section
      xmlLines.push(`  <changes count="${fileChanges.length}">`);
      for (const fc of fileChanges) {
        xmlLines.push(`    <file path="${escapeXML(fc.filePath)}" occurrences="${fc.occurrences.length}">`);
        for (const occ of fc.occurrences) {
          xmlLines.push(`      <change line="${occ.line}">`);
          xmlLines.push(`        <before>${escapeXML(occ.before)}</before>`);
          xmlLines.push(`        <after>${escapeXML(occ.after)}</after>`);
          xmlLines.push('      </change>');
        }
        xmlLines.push('    </file>');
      }
      xmlLines.push('  </changes>');

      xmlLines.push('</refactor_preview>');
      return xmlLines.join('\n');
    },
  );
}
