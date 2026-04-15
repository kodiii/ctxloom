import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function registerStatusTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_status',
    {
      name: 'ctx_status',
      description: 'Return the current status of the ctxloom server: initialization state, graph size, vector store record count, and project root.',
      inputSchema: { type: 'object', properties: {} },
    },
    async () => {
      const lines = ['<ctx_status>'];
      lines.push(`  <project_root>${escapeXML(ctx.projectRoot)}</project_root>`);
      lines.push(`  <database>${escapeXML(ctx.dbPath)}</database>`);
      try {
        const graph = await ctx.getGraph();
        lines.push(`  <graph status="ready" edges="${graph.edgeCount()}" nodes="${graph.allFiles().length}" />`);
      } catch {
        lines.push('  <graph status="error" />');
      }
      try {
        const store = await ctx.getStore();
        const count = await store.count();
        lines.push(`  <vector_store status="ready" records="${count}" />`);
      } catch {
        lines.push('  <vector_store status="error" />');
      }
      lines.push('</ctx_status>');
      return lines.join('\n');
    },
  );
}
