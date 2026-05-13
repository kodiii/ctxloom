import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../utils/logger.js';

export type ToolHandler = (args: unknown) => Promise<string>;

export interface ToolDefinition {
  schema: Tool;
  handler: ToolHandler;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(name: string, schema: Tool, handler: ToolHandler): void {
    this.tools.set(name, { schema, handler });
  }

  list(): Tool[] {
    return Array.from(this.tools.values()).map(t => t.schema);
  }

  async dispatch(name: string, args: unknown): Promise<string> {
    const def = this.tools.get(name);
    if (!def) throw new Error(`Unknown tool: ${name}`);
    const projectRoot =
      args && typeof args === 'object' && 'project_root' in args
        ? (args as Record<string, unknown>).project_root
        : undefined;
    logger.debug('tool.dispatch', { tool: name, project_root: projectRoot });
    return def.handler(args);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}
