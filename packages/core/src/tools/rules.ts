import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { ProjectRootField, PROJECT_ROOT_JSON_SCHEMA } from './projectRootParam.js';

const Schema = z.object({ project_root: ProjectRootField });

export function registerRulesTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_get_rules',
    {
      name: 'ctx_get_rules',
      description: 'Load and inject project-level rules from standard files (.cursorrules, CLAUDE.md, CONTEXT.md, .ctxloomrc). Helps the AI understand project conventions.',
      inputSchema: { type: 'object', properties: { project_root: PROJECT_ROOT_JSON_SCHEMA } },
    },
    async (args) => {
      const { project_root } = Schema.parse(args ?? {});
      return ctx.getRuleManager(project_root).getRulesXML();
    },
  );
}
