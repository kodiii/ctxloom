/**
 * ctx_hub_nodes — Top-N files by in_degree + out_degree.
 *
 * Hub nodes are architectural chokepoints: files that many other files
 * depend on (high in-degree) or that depend on many others (high out-degree).
 * Changing a high-degree hub has a large blast radius.
 */
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';

const Schema = z.object({
  limit: z.number().min(1).max(100).optional().default(20).describe('Number of hub nodes to return (default: 20)'),
  min_degree: z.number().min(0).optional().default(2).describe('Minimum total degree to include (default: 2)'),
  detail_level: z.enum(['standard', 'minimal']).default('standard').describe(
    '"standard" (default) returns full per-file listings. "minimal" returns counts only — ~60% fewer tokens.',
  ),
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function registerHubNodesTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_hub_nodes',
    {
      name: 'ctx_hub_nodes',
      description:
        'Return the top-N architectural hub files ranked by total import degree (in-degree + out-degree). ' +
        'Hub nodes are chokepoints: files that many things depend on, or that depend on many things. ' +
        'High-degree hubs have the largest blast radius when changed.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of hub nodes to return (default: 20, max: 100)' },
          min_degree: { type: 'number', description: 'Minimum total degree to include (default: 2)' },
          detail_level: {
            type: 'string',
            enum: ['standard', 'minimal'],
            description: '"standard" returns full listings. "minimal" returns counts only (saves ~60% tokens).',
          },
        },
      },
    },
    async (args) => {
      const { limit, min_degree, detail_level } = Schema.parse(args);
      const graph = await ctx.getGraph();
      const files = graph.allFiles();

      // Compute degree for each file
      const hubs = files
        .map(file => {
          const inDegree = graph.getImporters(file).length;
          const outDegree = graph.getImports(file).length;
          return { file, inDegree, outDegree, totalDegree: inDegree + outDegree };
        })
        .filter(h => h.totalDegree >= min_degree)
        .sort((a, b) => b.totalDegree - a.totalDegree)
        .slice(0, limit);

      if (detail_level === 'minimal') {
        return `<hub_nodes count="${hubs.length}" detail_level="minimal" />`;
      }

      const lines = [
        `<hub_nodes total_files="${files.length}" showing="${hubs.length}" min_degree="${min_degree}">`,
      ];
      for (const h of hubs) {
        lines.push(
          `  <file path="${escapeXML(h.file)}" in_degree="${h.inDegree}" out_degree="${h.outDegree}" total_degree="${h.totalDegree}" />`,
        );
      }
      lines.push('</hub_nodes>');
      return lines.join('\n');
    },
  );
}
