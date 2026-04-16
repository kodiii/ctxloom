/**
 * ctx_bridge_nodes — Betweenness centrality on the import graph.
 *
 * Bridge nodes sit on the most shortest paths between other files.
 * They are architectural connectors: removing one would isolate large
 * parts of the codebase from each other.
 *
 * Uses Brandes' algorithm (O(V·E)) with an optional node sample cap
 * to keep runtime bounded on large repos.
 */
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';

const Schema = z.object({
  limit: z.number().min(1).max(100).optional().default(20).describe('Number of bridge nodes to return (default: 20)'),
  sample: z.number().min(10).max(1000).optional().default(200).describe(
    'Max source nodes for BFS sampling (default: 200). Lower = faster but approximate.',
  ),
  detail_level: z.enum(['standard', 'minimal']).default('standard').describe(
    '"standard" (default) returns full per-file listings. "minimal" returns counts only — ~60% fewer tokens.',
  ),
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Brandes' betweenness centrality (unweighted, undirected view of the import graph).
 * Returns a map of file → betweenness score (not normalized).
 */
function computeBetweenness(
  files: string[],
  getNeighbors: (f: string) => string[],
  sampleSize: number,
): Map<string, number> {
  const cb = new Map<string, number>(files.map(f => [f, 0]));

  // Sample source nodes if the graph is large
  const sources = files.length <= sampleSize
    ? files
    : files.slice().sort(() => Math.random() - 0.5).slice(0, sampleSize);

  for (const s of sources) {
    // BFS to compute shortest-path counts and predecessor lists
    const stack: string[] = [];
    const pred = new Map<string, string[]>(files.map(f => [f, []]));
    const sigma = new Map<string, number>(files.map(f => [f, 0]));
    const dist = new Map<string, number>(files.map(f => [f, -1]));

    sigma.set(s, 1);
    dist.set(s, 0);
    const queue: string[] = [s];

    while (queue.length > 0) {
      const v = queue.shift()!;
      stack.push(v);
      for (const w of getNeighbors(v)) {
        // First visit?
        if (dist.get(w) === -1) {
          queue.push(w);
          dist.set(w, dist.get(v)! + 1);
        }
        // Shortest path via v?
        if (dist.get(w) === dist.get(v)! + 1) {
          sigma.set(w, sigma.get(w)! + sigma.get(v)!);
          pred.get(w)!.push(v);
        }
      }
    }

    // Back-propagation
    const delta = new Map<string, number>(files.map(f => [f, 0]));
    while (stack.length > 0) {
      const w = stack.pop()!;
      for (const v of pred.get(w)!) {
        const contribution = (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!);
        delta.set(v, delta.get(v)! + contribution);
      }
      if (w !== s) {
        cb.set(w, cb.get(w)! + delta.get(w)!);
      }
    }
  }

  return cb;
}

export function registerBridgeNodesTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_bridge_nodes',
    {
      name: 'ctx_bridge_nodes',
      description:
        'Return the top-N architectural bridge files by betweenness centrality. ' +
        'Bridge nodes sit on the most shortest paths between other files — removing one fragments the import graph. ' +
        'These are the connectors worth protecting with strict API boundaries.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of bridge nodes to return (default: 20, max: 100)' },
          sample: {
            type: 'number',
            description: 'Max source nodes for BFS sampling (default: 200). Lower = faster, approximate.',
          },
          detail_level: {
            type: 'string',
            enum: ['standard', 'minimal'],
            description: '"standard" returns full listings. "minimal" returns counts only (saves ~60% tokens).',
          },
        },
      },
    },
    async (args) => {
      const { limit, sample, detail_level } = Schema.parse(args);
      const graph = await ctx.getGraph();
      const files = graph.allFiles();

      if (files.length === 0) {
        return '<bridge_nodes total_files="0" showing="0" />';
      }

      // Undirected view: combine importers + imports as neighbors
      const getNeighbors = (f: string): string[] => [
        ...graph.getImports(f),
        ...graph.getImporters(f),
      ];

      const scores = computeBetweenness(files, getNeighbors, sample);

      const bridges = Array.from(scores.entries())
        .filter(([, score]) => score > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit);

      if (detail_level === 'minimal') {
        return `<bridge_nodes count="${bridges.length}" detail_level="minimal" />`;
      }

      const sampled = files.length > sample;
      const lines = [
        `<bridge_nodes total_files="${files.length}" showing="${bridges.length}" sampled="${sampled}" sample_size="${Math.min(sample, files.length)}">`,
      ];
      for (const [file, score] of bridges) {
        lines.push(`  <file path="${escapeXML(file)}" betweenness="${score.toFixed(2)}" />`);
      }
      lines.push('</bridge_nodes>');
      return lines.join('\n');
    },
  );
}
