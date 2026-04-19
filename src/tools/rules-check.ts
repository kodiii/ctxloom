import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { loadRulesConfig, RulesChecker, RulesConfigError } from '../rules/index.js';

export function registerRulesCheckTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_rules_check',
    {
      name: 'ctx_rules_check',
      description:
        'Check architecture rules defined in .ctxloom/rules.yml against the live dependency graph. ' +
        'Returns violations (forbidden imports) and dead-rule warnings. ' +
        'Only checks direct imports — transitive chains are not flagged.',
      inputSchema: { type: 'object', properties: {} },
    },
    async () => {
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

      const graph = await ctx.getGraph();
      const result = new RulesChecker(graph, config).check();
      return JSON.stringify({ schemaVersion: 1, ...result }, null, 2);
    },
  );
}
