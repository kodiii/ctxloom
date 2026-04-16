/**
 * ctx_graph_export — Export the import graph to a visualization format.
 *
 * Writes to .ctxloom/export/. Supports three formats:
 *   graphml  — Gephi, yEd, NetworkX
 *   dot      — Graphviz (render with: dot -Tsvg graph.dot > graph.svg)
 *   obsidian — Browse the codebase as a linked knowledge base in Obsidian
 */
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { GraphExporter } from '../graph/GraphExporter.js';

const Schema = z.object({
  format: z.enum(['graphml', 'dot', 'obsidian', 'svg']).describe(
    'Output format: graphml (Gephi/yEd), dot (Graphviz), obsidian (wikilink vault), svg (inline, no dependencies)',
  ),
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function registerGraphExportTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_graph_export',
    {
      name: 'ctx_graph_export',
      description:
        'Export the import graph to GraphML (Gephi/yEd), DOT (Graphviz), Obsidian wikilink format, or inline SVG. ' +
        'Output is written to .ctxloom/export/. ' +
        'GraphML and DOT enable visual graph exploration. ' +
        'Obsidian format creates a linked knowledge base browsable in Obsidian. ' +
        'SVG produces a standalone inline SVG with no external dependencies.',
      inputSchema: {
        type: 'object',
        properties: {
          format: {
            type: 'string',
            enum: ['graphml', 'dot', 'obsidian', 'svg'],
            description: 'Export format',
          },
        },
        required: ['format'],
      },
    },
    async (args) => {
      const { format } = Schema.parse(args);
      const graph = await ctx.getGraph();
      const exporter = new GraphExporter(graph, ctx.projectRoot);
      const result = exporter.export(format);
      return `<graph_export format="${result.format}" output="${escapeXML(result.outputPath)}" nodes="${result.nodeCount}" edges="${result.edgeCount}" />`;
    },
  );
}
