/**
 * find-large-functions.ts — ctx_find_large_functions
 *
 * Find functions and classes exceeding a configurable line-count threshold.
 * Uses the symbol index already populated by DependencyGraph during build.
 */
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import type { DependencyGraph } from '../graph/DependencyGraph.js';

const schema = z.object({
  threshold: z.number().int().min(1).default(50).describe(
    'Minimum line count to include (default: 50). Functions/classes shorter than this are excluded.',
  ),
  file_filter: z.string().optional().describe(
    'Optional: restrict results to files matching this path substring.',
  ),
  limit: z.number().int().min(1).max(200).default(30).describe(
    'Maximum results to return (default: 30).',
  ),
});

export interface LargeFunctionResult {
  name: string;
  type: string;
  filePath: string;
  startLine: number;
  endLine: number;
  lineCount: number;
}

/** Find symbols exceeding threshold. Exported for unit testing. */
export function findLargeFunctions(
  graph: DependencyGraph,
  threshold: number,
  fileFilter?: string,
): LargeFunctionResult[] {
  const results: LargeFunctionResult[] = [];

  for (const [name, entries] of graph.symbolEntries()) {
    for (const entry of entries) {
      if (entry.type !== 'function' && entry.type !== 'class') continue;
      if (fileFilter && !entry.filePath.includes(fileFilter)) continue;

      const startLine = entry.startLine ?? 0;
      const endLine = entry.endLine ?? 0;
      const lineCount = endLine - startLine + 1;

      if (lineCount >= threshold) {
        results.push({
          name,
          type: entry.type,
          filePath: entry.filePath,
          startLine,
          endLine,
          lineCount,
        });
      }
    }
  }

  return results.sort((a, b) => b.lineCount - a.lineCount);
}

function escapeXML(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function registerFindLargeFunctionsTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_find_large_functions',
    {
      name: 'ctx_find_large_functions',
      description:
        'Find functions and classes that exceed a line-count threshold. ' +
        'Useful for identifying tech debt, refactoring candidates, and functions that are too long to review easily.',
      inputSchema: {
        type: 'object',
        properties: {
          threshold: {
            type: 'number',
            description: 'Minimum line count to include (default: 50).',
          },
          file_filter: {
            type: 'string',
            description: 'Restrict to files whose path contains this substring.',
          },
          limit: {
            type: 'number',
            description: 'Maximum results to return (default: 30, max: 200).',
          },
        },
      },
    },
    async (args: unknown) => {
      const { threshold, file_filter, limit } = schema.parse(args);
      const graph = await ctx.getGraph();

      const results = findLargeFunctions(graph, threshold, file_filter).slice(0, limit);

      if (results.length === 0) {
        return (
          `<ctx_find_large_functions threshold="${threshold}" count="0">\n` +
          `  <message>No functions or classes exceed ${threshold} lines.</message>\n` +
          `</ctx_find_large_functions>`
        );
      }

      const lines = [
        `<ctx_find_large_functions threshold="${threshold}" count="${results.length}">`,
        ...results.map(
          r =>
            `  <symbol name="${escapeXML(r.name)}" type="${r.type}" file="${escapeXML(r.filePath)}" ` +
            `start="${r.startLine}" end="${r.endLine}" lines="${r.lineCount}" />`,
        ),
        `</ctx_find_large_functions>`,
      ];
      return lines.join('\n');
    },
  );
}
