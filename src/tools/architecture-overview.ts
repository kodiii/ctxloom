/**
 * ctx_architecture_overview — High-level architectural summary of the codebase.
 *
 * For each Louvain community: its name, size, top hub files (by degree within
 * the community), and which other communities it imports from (coupling map).
 */
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { CommunityDetector } from '../graph/CommunityDetector.js';

const Schema = z.object({
  hub_limit: z.number().min(1).max(10).optional().default(3).describe(
    'Number of top hub files to show per community (default: 3)',
  ),
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function registerArchitectureOverviewTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_architecture_overview',
    {
      name: 'ctx_architecture_overview',
      description:
        'Return a high-level architectural overview of the codebase. ' +
        'Shows Louvain-detected communities with their top hub files and cross-community coupling. ' +
        'Use this as the entry point for understanding an unfamiliar codebase.',
      inputSchema: {
        type: 'object',
        properties: {
          hub_limit: {
            type: 'number',
            description: 'Number of top hub files to show per community (default: 3, max: 10)',
          },
        },
      },
    },
    async (args) => {
      const { hub_limit } = Schema.parse(args);
      const graph = await ctx.getGraph();
      const files = graph.allFiles();

      if (files.length === 0) {
        return '<architecture total_communities="0" total_files="0" />';
      }

      const detector = new CommunityDetector(graph);
      const communities = detector.detect();

      // Build file → community id map for cross-community coupling
      const fileToComm = new Map<string, number>();
      for (const c of communities) {
        for (const f of c.files) fileToComm.set(f, c.id);
      }

      const lines = [
        `<architecture total_communities="${communities.length}" total_files="${files.length}" edge_count="${graph.edgeCount()}">`,
      ];

      for (const c of communities.sort((a, b) => b.files.length - a.files.length)) {
        const fileSet = new Set(c.files);

        // Top hub files within this community (by total degree among community files)
        const hubs = c.files
          .map(f => {
            const inDeg = graph.getImporters(f).filter(imp => fileSet.has(imp)).length;
            const outDeg = graph.getImports(f).filter(imp => fileSet.has(imp)).length;
            return { file: f, degree: inDeg + outDeg };
          })
          .sort((a, b) => b.degree - a.degree)
          .slice(0, hub_limit);

        // Cross-community imports: how many files in other communities does this community import?
        const crossImports = new Map<string, number>(); // communityName → import count
        for (const f of c.files) {
          for (const imported of graph.getImports(f)) {
            const targetCommId = fileToComm.get(imported);
            if (targetCommId !== undefined && targetCommId !== c.id) {
              const targetComm = communities.find(x => x.id === targetCommId);
              if (targetComm) {
                crossImports.set(targetComm.name, (crossImports.get(targetComm.name) ?? 0) + 1);
              }
            }
          }
        }

        lines.push(`  <community id="${c.id}" name="${escapeXML(c.name)}" size="${c.files.length}" coupling="${crossImports.size}">`);

        if (hubs.length > 0) {
          lines.push('    <hub_files>');
          for (const h of hubs) {
            lines.push(`      <file path="${escapeXML(h.file)}" internal_degree="${h.degree}" />`);
          }
          lines.push('    </hub_files>');
        }

        if (crossImports.size > 0) {
          lines.push('    <imports_from>');
          for (const [name, count] of [...crossImports.entries()].sort((a, b) => b[1] - a[1])) {
            lines.push(`      <community name="${escapeXML(name)}" import_count="${count}" />`);
          }
          lines.push('    </imports_from>');
        }

        lines.push('  </community>');
      }

      lines.push('</architecture>');
      return lines.join('\n');
    },
  );
}
