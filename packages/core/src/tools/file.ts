import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';

const Schema = z.object({ path: z.string().describe('Relative path to the file') });

export function registerFileTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_get_file',
    {
      name: 'ctx_get_file',
      description: 'Read a file from the project. Path is validated to prevent traversal outside the project root. Returns the full file content.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Relative path to the file' } },
        required: ['path'],
      },
    },
    async (args) => {
      const { path: filePath } = Schema.parse(args);
      return ctx.getPathValidator().readFile(filePath);
    },
  );
}
