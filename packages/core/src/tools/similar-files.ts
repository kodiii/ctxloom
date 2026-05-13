import { z } from 'zod';
import { generateEmbedding } from '../indexer/embedder.js';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { ProjectRootField, PROJECT_ROOT_JSON_SCHEMA } from './projectRootParam.js';

const Schema = z.object({
  target_file: z.string().describe('Relative path to the file to find similar files for'),
  limit: z.number().max(100).optional().default(10).describe('Maximum results to return'),
  project_root: ProjectRootField,
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function registerSimilarFilesTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_similar_files',
    {
      name: 'ctx_similar_files',
      description: 'Find files semantically similar to a given file using vector embeddings. Useful for locating related components, similar utilities, or code that may need the same change.',
      inputSchema: {
        type: 'object',
        properties: {
          target_file: { type: 'string', description: 'Relative path to the file to find similar files for' },
          limit: { type: 'number', description: 'Maximum results to return (default: 10)' },
          project_root: PROJECT_ROOT_JSON_SCHEMA,
        },
        required: ['target_file'],
      },
    },
    async (args) => {
      const { target_file, limit, project_root } = Schema.parse(args);
      const content = ctx.getPathValidator(project_root).readFile(target_file);
      const store = await ctx.getStore(project_root);
      const queryEmbedding = await generateEmbedding(content);
      const results = (await store.search(queryEmbedding, limit + 1))
        .filter(r => r.filePath !== target_file)
        .slice(0, limit);

      const lines = [`<similar_files target="${escapeXML(target_file)}" count="${results.length}">`];
      for (const r of results) {
        lines.push(`  <file path="${escapeXML(r.filePath)}" score="${r.score.toFixed(4)}" />`);
      }
      lines.push('</similar_files>');
      return lines.join('\n');
    },
  );
}
