import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { loadRulesConfig, RulesChecker, RulesConfigError } from '../rules/index.js';
import { ProjectRootField, PROJECT_ROOT_JSON_SCHEMA } from './projectRootParam.js';

const Schema = z.object({ project_root: ProjectRootField });

export function registerRulesCheckTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_rules_check',
    {
      name: 'ctx_rules_check',
      description:
        'Check architecture rules defined in .ctxloom/rules.yml against the live dependency graph. ' +
        'Returns violations (forbidden imports) and dead-rule warnings. ' +
        'Only checks direct imports — transitive chains are not flagged.',
      inputSchema: { type: 'object', properties: { project_root: PROJECT_ROOT_JSON_SCHEMA } },
    },
    async (args) => {
      const { project_root } = Schema.parse(args ?? {});
      let config;
      try {
        config = await loadRulesConfig(ctx.projectRoot);
      } catch (err) {
        // MCP tools must never throw — return all errors as warnings.
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({
          schemaVersion: 1,
          violations: [],
          warnings: [`Config error: ${msg}`],
          rulesChecked: 0,
          filesChecked: 0,
          durationMs: 0,
        });
      }

      if (config === null) {
        return JSON.stringify({
          schemaVersion: 1,
          violations: [],
          warnings: ['No .ctxloom/rules.yml found. Create one to define architecture rules.'],
          rulesChecked: 0,
          filesChecked: 0,
          durationMs: 0,
        });
      }

      let graph;
      let result;
      try {
        graph = await ctx.getGraph(project_root);
        result = new RulesChecker(graph, config).check();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({
          schemaVersion: 1,
          violations: [],
          warnings: [`Runtime error: ${msg}`],
          rulesChecked: 0,
          filesChecked: 0,
          durationMs: 0,
        });
      }
      return JSON.stringify({ schemaVersion: 1, ...result }, null, 2);
    },
  );
}
