import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';

export function registerRulesTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_get_rules',
    {
      name: 'ctx_get_rules',
      description: 'Load and inject project-level rules from standard files (.cursorrules, CLAUDE.md, CONTEXT.md, .ctxloomrc). Helps the AI understand project conventions.',
      inputSchema: { type: 'object', properties: {} },
    },
    async () => ctx.getRuleManager().getRulesXML(),
  );
}
