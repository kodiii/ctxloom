/**
 * ctx_community_list — Louvain-based community detection on the import graph.
 *
 * Returns all detected communities (clusters of tightly-coupled files) with
 * their names (longest common directory prefix), sizes, and member files.
 * Results are computed fresh each call (fast: <20ms on typical codebases).
 */
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { CommunityDetector } from '../graph/CommunityDetector.js';

const Schema = z.object({
  show_files: z.boolean().optional().default(false).describe(
    'Include member file paths in output (default: false for compact output)',
  ),
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function registerCommunityListTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_community_list',
    {
      name: 'ctx_community_list',
      description:
        'Return all architectural communities detected via Louvain clustering of the import graph. ' +
        'Each community is a cluster of tightly-coupled files (a feature area, module, or layer). ' +
        'Use this to understand high-level codebase structure before diving into details.',
      inputSchema: {
        type: 'object',
        properties: {
          show_files: {
            type: 'boolean',
            description: 'Include member file paths in output (default: false)',
          },
        },
      },
    },
    async (args) => {
      const { show_files } = Schema.parse(args);
      const graph = await ctx.getGraph();
      const files = graph.allFiles();

      if (files.length === 0) {
        return '<communities total="0" edge_count="0" />';
      }

      const detector = new CommunityDetector(graph);
      const communities = detector.detect();

      const lines = [
        `<communities total="${communities.length}" edge_count="${graph.edgeCount()}" total_files="${files.length}">`,
      ];

      for (const c of communities.sort((a, b) => b.files.length - a.files.length)) {
        if (show_files) {
          lines.push(`  <community id="${c.id}" name="${escapeXML(c.name)}" size="${c.files.length}">`);
          for (const f of c.files.sort()) {
            lines.push(`    <file path="${escapeXML(f)}" />`);
          }
          lines.push('  </community>');
        } else {
          lines.push(`  <community id="${c.id}" name="${escapeXML(c.name)}" size="${c.files.length}" />`);
        }
      }

      lines.push('</communities>');
      return lines.join('\n');
    },
  );
}
