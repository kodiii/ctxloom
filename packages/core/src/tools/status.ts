import { z } from 'zod';
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
      inputSchema: {
        type: 'object',
        properties: {
          project_root: {
            type: 'string',
            description:
              'Absolute path or registered alias of the project to operate on. ' +
              'Omit to get the multi-project view (default project + active list + registry).',
          },
        },
      },
    },
    async (args) => {
      const Schema = z.object({ project_root: z.string().optional() });
      const { project_root } = Schema.parse(args ?? {});

      const lines = ['<ctx_status>'];
      lines.push(`  <project_root>${escapeXML(project_root ?? ctx.projectRoot)}</project_root>`);
      lines.push(`  <database>${escapeXML(ctx.dbPath)}</database>`);

      // Graph — only query if already initialized (non-destructive)
      if (ctx.isGraphInitialized()) {
        try {
          const graph = await ctx.getGraph(project_root);
          lines.push(`  <graph status="ready" edges="${graph.edgeCount()}" nodes="${graph.allFiles().length}" />`);
        } catch {
          lines.push('  <graph status="error" />');
        }
      } else {
        lines.push('  <graph status="not_initialized" />');
      }

      // Vector store — only query if already initialized
      if (ctx.isStoreInitialized()) {
        try {
          const store = await ctx.getStore(project_root);
          const count = await store.count();
          lines.push(`  <vector_store status="ready" records="${count}" />`);
        } catch {
          lines.push('  <vector_store status="error" />');
        }
      } else {
        lines.push('  <vector_store status="not_initialized" />');
      }

      // AST parser — non-destructive check
      lines.push(`  <ast_parser status="${ctx.isParserInitialized() ? 'ready' : 'not_initialized'}" />`);

      lines.push('</ctx_status>');
      return lines.join('\n');
    },
  );
}
