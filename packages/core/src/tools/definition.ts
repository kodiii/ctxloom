import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';

const Schema = z.object({ symbol: z.string().describe('Symbol name to look up') });

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function registerDefinitionTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_get_definition',
    {
      name: 'ctx_get_definition',
      description: 'Look up the definition of a symbol by name. Returns file path, type, and signature for all definitions matching the symbol name.',
      inputSchema: {
        type: 'object',
        properties: { symbol: { type: 'string', description: 'Symbol name to look up' } },
        required: ['symbol'],
      },
    },
    async (args) => {
      const { symbol } = Schema.parse(args);
      const graph = await ctx.getGraph();
      const definitions = graph.lookupSymbol(symbol);
      if (definitions.length === 0) {
        return `<definitions symbol="${escapeXML(symbol)}" count="0">\n  <!-- Symbol not found -->\n</definitions>`;
      }
      const lines = [`<definitions symbol="${escapeXML(symbol)}" count="${definitions.length}">`];
      for (const def of definitions) {
        lines.push(`  <definition file="${def.filePath}" type="${def.type}">`);
        lines.push(`    ${def.signature.replace(/&/g, '&amp;').replace(/</g, '&lt;')}`);
        lines.push('  </definition>');
      }
      lines.push('</definitions>');
      return lines.join('\n');
    },
  );
}
