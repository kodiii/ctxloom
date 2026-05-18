import { z } from 'zod';
import { generateEmbedding } from '../indexer/embedder.js';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { ProjectRootField, PROJECT_ROOT_JSON_SCHEMA } from './projectRootParam.js';
import {
  enforceBudget,
  hasBudgetArgs,
  readBudgetArgs,
  wrapResponse,
} from '../budget/budget.js';

/** Per #106 provisional table. */
const DEFAULT_MAX_RESPONSE_TOKENS = 4000;

const Schema = z.object({
  query: z.string().describe('Search query — natural language or code fragment'),
  limit: z.number().max(100).optional().default(10).describe('Maximum results to return'),
  project_root: ProjectRootField,
  // ─── Phase B2 budget surface ──
  max_response_tokens: z.number().int().positive().optional()
    .describe('Soft response budget. Default: 4000 (when budget surface is opted into). Over-budget rebuilds the result list without the content snippets (paths + scores only).'),
  on_budget_exceeded: z.enum(['skeleton', 'truncate', 'error']).optional()
    .describe("Behavior when over budget. 'skeleton' (default) drops snippets; 'truncate' slices the raw XML; 'error' throws."),
  response_format: z.enum(['full', 'skeleton', 'auto']).optional()
    .describe("'skeleton' forces the path-and-score-only view; 'full'/'auto' lets the budget decide."),
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface Ranked {
  filePath: string;
  score: number;
  content: string;
}

/**
 * Render the search results XML. When `includeContent` is false, only
 * file paths and scores are emitted — the "skeleton" form used by the
 * budget fallback ladder when the full response is over budget.
 */
function renderResults(query: string, ranked: Ranked[], includeContent: boolean): string {
  const lines = [`<search_results query="${escapeXML(query)}" count="${ranked.length}">`];
  for (const result of ranked) {
    lines.push(`  <result file="${escapeXML(result.filePath)}" score="${result.score.toFixed(4)}">`);
    if (includeContent && result.content) {
      lines.push(`    ${result.content.slice(0, 200).replace(/&/g, '&amp;').replace(/</g, '&lt;')}`);
    }
    lines.push('  </result>');
  }
  lines.push('</search_results>');
  return lines.join('\n');
}

export function registerSearchTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_search',
    {
      name: 'ctx_search',
      description: 'Hybrid semantic + graph search over the codebase. Uses vector embeddings for semantic similarity and the dependency graph for structural expansion. Returns ranked file results. When callers opt into the budget surface, over-budget responses drop the content snippets and return paths + scores only.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query — natural language or code fragment' },
          limit: { type: 'number', description: 'Maximum results to return (default: 10)' },
          project_root: PROJECT_ROOT_JSON_SCHEMA,
          max_response_tokens: {
            type: 'number',
            description: 'Soft response budget in tokens. Default: 4000 (when opted into).',
          },
          on_budget_exceeded: {
            type: 'string',
            enum: ['skeleton', 'truncate', 'error'],
            description: "Behavior when over budget. 'skeleton' (default) drops snippets; 'truncate' slices; 'error' throws.",
          },
          response_format: {
            type: 'string',
            enum: ['full', 'skeleton', 'auto'],
            description: "'skeleton' forces path+score-only view; 'full'/'auto' lets the budget decide.",
          },
        },
        required: ['query'],
      },
    },
    async (args) => {
      const parsed = Schema.parse(args);
      const [store, graph] = await Promise.all([ctx.getStore(parsed.project_root), ctx.getGraph(parsed.project_root)]);

      const queryEmbedding = await generateEmbedding(parsed.query);
      const vectorResults = await store.search(queryEmbedding, parsed.limit);

      const expandedResults = new Map<string, { score: number; content: string }>();
      for (const result of vectorResults) {
        const existingScore = expandedResults.get(result.filePath)?.score ?? Infinity;
        if (result.score < existingScore) {
          expandedResults.set(result.filePath, { score: result.score, content: result.content });
        }
        for (const related of [...graph.getImports(result.filePath), ...graph.getImporters(result.filePath)]) {
          if (!expandedResults.has(related)) {
            expandedResults.set(related, { score: result.score + 0.1, content: '' });
          }
        }
      }

      const ranked: Ranked[] = Array.from(expandedResults.entries())
        .map(([filePath, data]) => ({ filePath, score: data.score, content: data.content }))
        .sort((a, b) => a.score - b.score)
        .slice(0, parsed.limit);

      const full = renderResults(parsed.query, ranked, true);

      if (!hasBudgetArgs(args)) return full;

      // Skeleton fallback: re-render without content snippets.
      // The path+score list is far smaller and still useful for the
      // common "narrow down which files to investigate" workflow.
      const skeletonProducer = async (): Promise<string | null> =>
        renderResults(parsed.query, ranked, false);

      const result = await enforceBudget({
        ctx,
        full,
        args: readBudgetArgs(args),
        toolName: 'ctx_search',
        defaultMaxTokens: DEFAULT_MAX_RESPONSE_TOKENS,
        skeletonProducer,
      });
      return wrapResponse(result);
    },
  );
}
