/**
 * ctx_wiki_generate — Generate structural Markdown wiki for each community.
 *
 * Writes .ctxloom/wiki/index.md + one page per Louvain community.
 * Pages are hash-cached; only updated when content changes.
 */
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { WikiGenerator } from '../graph/WikiGenerator.js';

const Schema = z.object({
  force: z.boolean().optional().default(false).describe(
    'Regenerate all pages even if content unchanged (default: false)',
  ),
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function registerWikiGenerateTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_wiki_generate',
    {
      name: 'ctx_wiki_generate',
      description:
        'Generate structural Markdown wiki pages for each Louvain community. ' +
        'Writes to .ctxloom/wiki/: one page per community with its files, public API, ' +
        'dependency map, and hub file skeleton. Pages are hash-cached — only updated when content changes. ' +
        'No LLM required — purely structural, always reproducible.',
      inputSchema: {
        type: 'object',
        properties: {
          force: {
            type: 'boolean',
            description: 'Regenerate all pages even if content is unchanged (default: false)',
          },
        },
      },
    },
    async (args) => {
      const { force } = Schema.parse(args);
      const [graph, skeletonizer] = await Promise.all([ctx.getGraph(), ctx.getSkeletonizer()]);
      const generator = new WikiGenerator(graph, ctx.projectRoot, skeletonizer);
      const result = await generator.generate(force);

      const lines = [
        `<wiki_generate wiki_dir="${escapeXML(result.wikiDir)}" written="${result.written.length}" skipped="${result.skipped.length}">`,
      ];
      for (const p of result.written) {
        lines.push(`  <page community="${escapeXML(p.communityName)}" file="${escapeXML(p.filePath)}" status="written" />`);
      }
      for (const p of result.skipped) {
        lines.push(`  <page community="${escapeXML(p.communityName)}" file="${escapeXML(p.filePath)}" status="skipped" />`);
      }
      lines.push('</wiki_generate>');
      return lines.join('\n');
    },
  );
}
