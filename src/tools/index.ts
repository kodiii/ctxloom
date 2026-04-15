import { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { registerSearchTool } from './search.js';
import { registerFileTool } from './file.js';
import { registerContextPacketTool } from './context-packet.js';
import { registerCallGraphTool } from './call-graph.js';
import { registerDefinitionTool } from './definition.js';
import { registerRulesTool } from './rules.js';
import { registerSimilarFilesTool } from './similar-files.js';
import { registerStatusTool } from './status.js';

export function createToolRegistry(ctx: ServerContext): ToolRegistry {
  const registry = new ToolRegistry();
  registerSearchTool(registry, ctx);
  registerFileTool(registry, ctx);
  registerContextPacketTool(registry, ctx);
  registerCallGraphTool(registry, ctx);
  registerDefinitionTool(registry, ctx);
  registerRulesTool(registry, ctx);
  registerSimilarFilesTool(registry, ctx);
  registerStatusTool(registry, ctx);
  return registry;
}
