/**
 * ctx_apply_refactor — Apply a symbol rename across the codebase.
 *
 * Same candidate collection as ctx_refactor_preview but WRITES changes
 * to disk. Use dry_run=true to preview without writing.
 */
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { ProjectRootField, PROJECT_ROOT_JSON_SCHEMA } from './projectRootParam.js';

const Schema = z.object({
  symbol: z.string().min(1).describe('Symbol name to rename (exact, case-sensitive)'),
  new_name: z.string().min(1).describe('New name for the symbol'),
  dry_run: z.boolean().optional().default(false).describe(
    'When true, compute changes but do not write to disk (default: false)',
  ),
  max_files: z.number().min(1).max(200).optional().default(50).describe(
    'Maximum candidate files to process (default: 50)',
  ),
  project_root: ProjectRootField,
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface FileResult {
  filePath: string;
  occurrences: number;
  written: boolean;
}

function applyToFile(
  absPath: string,
  symbol: string,
  newName: string,
  dryRun: boolean,
): number {
  let content: string;
  try {
    content = fs.readFileSync(absPath, 'utf-8');
  } catch {
    return 0;
  }

  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'g');

  const occurrences = (content.match(regex) ?? []).length;
  if (occurrences === 0) return 0;

  if (!dryRun) {
    fs.writeFileSync(absPath, content.replace(regex, newName), 'utf-8');
  }
  return occurrences;
}

export function registerApplyRefactorTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_apply_refactor',
    {
      name: 'ctx_apply_refactor',
      description:
        'Apply a symbol rename across all definition files, importers, and call sites. ' +
        'Writes changes to disk. Use dry_run=true to preview without writing. ' +
        'Complement to ctx_refactor_preview.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Symbol to rename' },
          new_name: { type: 'string', description: 'New name' },
          dry_run: { type: 'boolean', description: 'Preview only, no writes (default: false)' },
          max_files: { type: 'number', description: 'Max candidate files (default: 50)' },
          project_root: PROJECT_ROOT_JSON_SCHEMA,
        },
        required: ['symbol', 'new_name'],
      },
    },
    async (args) => {
      const { symbol, new_name, dry_run, max_files, project_root } = Schema.parse(args);
      const graph = await ctx.getGraph(project_root);

      const definitions = graph.lookupSymbol(symbol);
      const candidateSet = new Set<string>();

      for (const def of definitions) {
        candidateSet.add(def.filePath);
        for (const imp of graph.getImporters(def.filePath)) {
          candidateSet.add(imp);
        }
      }

      const callIdx = graph.getCallGraphIndex();
      for (const caller of callIdx.getCallers(symbol)) {
        candidateSet.add(caller.file);
      }

      const candidates = Array.from(candidateSet).slice(0, max_files);
      const results: FileResult[] = [];
      let totalOccurrences = 0;

      for (const relPath of candidates) {
        const absPath = path.join(ctx.projectRoot, relPath);
        const count = applyToFile(absPath, symbol, new_name, dry_run);
        if (count > 0) {
          results.push({ filePath: relPath, occurrences: count, written: !dry_run });
          totalOccurrences += count;
        }
      }

      const xml = [
        `<apply_refactor symbol="${escapeXML(symbol)}" new_name="${escapeXML(new_name)}" dry_run="${dry_run}" total_files="${results.length}" total_occurrences="${totalOccurrences}">`,
      ];
      for (const r of results) {
        xml.push(
          `  <file path="${escapeXML(r.filePath)}" occurrences="${r.occurrences}" written="${r.written}"/>`,
        );
      }
      xml.push('</apply_refactor>');
      return xml.join('\n');
    },
  );
}
