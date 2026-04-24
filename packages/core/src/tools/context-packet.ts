import { z } from 'zod';
import path from 'node:path';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';

const Schema = z.object({
  target_file: z.string().describe('Relative path to the primary file'),
  mode: z.enum(['edit', 'read']).optional().default('edit').describe('Context mode'),
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function registerContextPacketTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_get_context_packet',
    {
      name: 'ctx_get_context_packet',
      description: 'Returns a smart multi-file context packet: the full target file, skeletons of its imports, and the list of files that import it. Reduces token usage by ~80% vs. sending full dependencies.',
      inputSchema: {
        type: 'object',
        properties: {
          target_file: { type: 'string', description: 'Relative path to the primary file' },
          mode: { type: 'string', enum: ['edit', 'read'], description: 'Context mode (default: edit)' },
        },
        required: ['target_file'],
      },
    },
    async (args) => {
      const { target_file, mode } = Schema.parse(args);
      const [skeletonizer, graph] = await Promise.all([ctx.getSkeletonizer(), ctx.getGraph()]);
      const pathValidator = ctx.getPathValidator();
      const primaryContent = pathValidator.readFile(target_file);
      const imports = graph.getImports(target_file);
      const importers = graph.getImporters(target_file);

      const skeletons = await Promise.all(
        imports.map(async (dep) => {
          try {
            const absDep = path.resolve(ctx.projectRoot, dep);
            const sk = await skeletonizer.skeletonize(absDep);
            return `\n<!-- ${dep} -->\n${sk}`;
          } catch {
            return `<!-- ${dep} (skeleton unavailable) -->`;
          }
        }),
      );

      return [
        `<context_packet target="${target_file}" mode="${mode}">`,
        `  <primary_context file="${target_file}">`,
        `    ${primaryContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}`,
        '  </primary_context>',
        `  <dependency_skeletons count="${imports.length}">`,
        ...skeletons.map(s => `    ${s}`),
        '  </dependency_skeletons>',
        `  <imported_by count="${importers.length}">`,
        ...importers.map(imp => `    <importer file="${imp}" />`),
        '  </imported_by>',
        '</context_packet>',
      ].join('\n');
    },
  );
}
