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
import { ProjectRootField, PROJECT_ROOT_JSON_SCHEMA } from './projectRootParam.js';
import { enforceBudget, hasBudgetArgs, readBudgetArgs, wrapResponse } from '../budget/budget.js';

/** Per #106 provisional table — already structural metadata. */
const DEFAULT_MAX_RESPONSE_TOKENS = 2000;

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
  project_root: ProjectRootField,
  // ─── Phase B2 budget surface ──
  max_response_tokens: z.number().int().positive().optional()
    .describe('Soft response budget. Default: 2000 (when opted in). No skeleton fallback — response is already structural; over-budget falls through to truncation.'),
  on_budget_exceeded: z.enum(['skeleton', 'truncate', 'error']).optional()
    .describe("Behavior when over budget. 'skeleton'/'truncate' both slice the XML; 'error' throws."),
  response_format: z.enum(['full', 'skeleton', 'auto']).optional()
    .describe("'full'/'auto' default; 'skeleton' produces the same output (response is already compact)."),
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

      if (entry.startLine == null || entry.endLine == null) continue;
      const startLine = entry.startLine;
      const endLine = entry.endLine;
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
          project_root: PROJECT_ROOT_JSON_SCHEMA,
          max_response_tokens: { type: 'number', description: 'Soft response budget. Default: 2000 (when opted in).' },
          on_budget_exceeded: { type: 'string', enum: ['skeleton', 'truncate', 'error'], description: "Behavior over budget. 'skeleton'/'truncate' slice; 'error' throws." },
          response_format: { type: 'string', enum: ['full', 'skeleton', 'auto'], description: "'full'/'auto' default; 'skeleton' same output (already compact)." },
        },
      },
    },
    async (args: unknown) => {
      const { threshold, file_filter, limit, project_root } = schema.parse(args);
      const graph = await ctx.getGraph(project_root);

      const results = findLargeFunctions(graph, threshold, file_filter).slice(0, limit);

      let full: string;
      if (results.length === 0) {
        full = (
          `<ctx_find_large_functions threshold="${threshold}" count="0">\n` +
          `  <message>No functions or classes exceed ${threshold} lines.</message>\n` +
          `</ctx_find_large_functions>`
        );
      } else {
        const lines = [
          `<ctx_find_large_functions threshold="${threshold}" count="${results.length}">`,
          ...results.map(
            r =>
              `  <symbol name="${escapeXML(r.name)}" type="${r.type}" file="${escapeXML(r.filePath)}" ` +
              `start="${r.startLine}" end="${r.endLine}" lines="${r.lineCount}" />`,
          ),
          `</ctx_find_large_functions>`,
        ];
        full = lines.join('\n');
      }

      if (!hasBudgetArgs(args)) return full;
      const result = await enforceBudget({
        ctx,
        full,
        args: readBudgetArgs(args),
        toolName: 'ctx_find_large_functions',
        defaultMaxTokens: DEFAULT_MAX_RESPONSE_TOKENS,
      });
      return wrapResponse(result);
    },
  );
}
