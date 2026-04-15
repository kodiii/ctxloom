import { z } from 'zod';
import { getCallGraph } from './findCallers.js';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';

const Schema = z.object({
  symbol: z.string().describe('Symbol name to search for'),
  direction: z.enum(['callers', 'callees']).optional().default('callers').describe('Traversal direction'),
  depth: z.number().max(10).optional().default(1).describe('Transitive traversal depth (max 10)'),
  target_file: z.string().optional().describe('Optional: relative file path to start from'),
});

export function registerCallGraphTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_get_call_graph',
    {
      name: 'ctx_get_call_graph',
      description: 'Bidirectional call graph traversal with configurable depth. Find who calls a symbol (callers) or what a symbol depends on (callees). Supports transitive traversal.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Symbol name to search for' },
          direction: { type: 'string', enum: ['callers', 'callees'], description: 'Traversal direction (default: callers)' },
          depth: { type: 'number', description: 'Transitive traversal depth (default: 1)' },
          target_file: { type: 'string', description: 'Optional: relative file path to start from' },
        },
        required: ['symbol'],
      },
    },
    async (args) => {
      const { symbol, direction, depth, target_file } = Schema.parse(args);
      const [parser, graph] = await Promise.all([ctx.getParser(), ctx.getGraph()]);
      return getCallGraph({
        symbol, direction, depth,
        targetFile: target_file,
        projectRoot: ctx.projectRoot,
        parser, graph,
      });
    },
  );
}
