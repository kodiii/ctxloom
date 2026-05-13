import { z } from 'zod';
import { generateEmbedding } from '../indexer/embedder.js';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { ProjectRootField, PROJECT_ROOT_JSON_SCHEMA } from './projectRootParam.js';

const Schema = z.object({
  query: z.string().describe('Search query — natural language or code fragment'),
  limit: z.number().max(100).optional().default(10).describe('Maximum results to return'),
  project_root: ProjectRootField,
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function registerSearchTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_search',
    {
      name: 'ctx_search',
      description: 'Hybrid semantic + graph search over the codebase. Uses vector embeddings for semantic similarity and the dependency graph for structural expansion. Returns ranked file results.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query — natural language or code fragment' },
          limit: { type: 'number', description: 'Maximum results to return (default: 10)' },
          project_root: PROJECT_ROOT_JSON_SCHEMA,
        },
        required: ['query'],
      },
    },
    async (args) => {
      const { query, limit, project_root } = Schema.parse(args);
      const [store, graph] = await Promise.all([ctx.getStore(project_root), ctx.getGraph(project_root)]);

      const queryEmbedding = await generateEmbedding(query);
      const vectorResults = await store.search(queryEmbedding, limit);

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

      const ranked = Array.from(expandedResults.entries())
        .map(([filePath, data]) => ({ filePath, score: data.score, content: data.content }))
        .sort((a, b) => a.score - b.score)
        .slice(0, limit);

      const lines = [`<search_results query="${escapeXML(query)}" count="${ranked.length}">`];
      for (const result of ranked) {
        lines.push(`  <result file="${escapeXML(result.filePath)}" score="${result.score.toFixed(4)}">`);
        if (result.content) {
          lines.push(`    ${result.content.slice(0, 200).replace(/&/g, '&amp;').replace(/</g, '&lt;')}`);
        }
        lines.push('  </result>');
      }
      lines.push('</search_results>');
      return lines.join('\n');
    },
  );
}
