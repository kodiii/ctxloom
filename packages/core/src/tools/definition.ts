import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { ProjectRootField, PROJECT_ROOT_JSON_SCHEMA } from './projectRootParam.js';
import {
  enforceBudget,
  hasBudgetArgs,
  readBudgetArgs,
  wrapResponse,
} from '../budget/budget.js';

/** Per #106 provisional table — definition lookups are bounded structural metadata. */
const DEFAULT_MAX_RESPONSE_TOKENS = 2000;

const Schema = z.object({
  symbol: z.string().describe('Symbol name to look up'),
  project_root: ProjectRootField,
  // ─── Phase B2 budget surface (all optional; back-compat preserved) ──
  max_response_tokens: z.number().int().positive().optional()
    .describe('Soft response budget in tokens. Default: 2000 (when budget surface is opted into). No skeleton fallback for this tool — the response is structural metadata; over-budget falls back to truncation.'),
  on_budget_exceeded: z.enum(['skeleton', 'truncate', 'error']).optional()
    .describe("Behavior when over budget. 'skeleton'/'truncate' both slice the XML (no file context to skeletonize from); 'error' throws."),
  response_format: z.enum(['full', 'skeleton', 'auto']).optional()
    .describe("'full'/'auto' default. 'skeleton' is accepted for consistency but produces the same output as 'full' here — the response is already a compact symbol list."),
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function registerDefinitionTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_get_definition',
    {
      name: 'ctx_get_definition',
      description: 'Look up the definition of a symbol by name. Returns file path, type, and signature for all definitions matching the symbol name. When callers opt into the budget surface (max_response_tokens / on_budget_exceeded / response_format), the response is wrapped in a {data, meta} envelope and over-budget responses are truncated (no skeleton fallback — the response is already structural).',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Symbol name to look up' },
          project_root: PROJECT_ROOT_JSON_SCHEMA,
          max_response_tokens: {
            type: 'number',
            description: 'Soft response budget in tokens. Default: 2000 (when budget surface is opted into).',
          },
          on_budget_exceeded: {
            type: 'string',
            enum: ['skeleton', 'truncate', 'error'],
            description: "Behavior when over budget. 'skeleton'/'truncate' both slice the XML; 'error' throws.",
          },
          response_format: {
            type: 'string',
            enum: ['full', 'skeleton', 'auto'],
            description: "'full'/'auto' default; 'skeleton' produces the same output (response is already compact).",
          },
        },
        required: ['symbol'],
      },
    },
    async (args) => {
      const parsed = Schema.parse(args);
      const graph = await ctx.getGraph(parsed.project_root);
      const definitions = graph.lookupSymbol(parsed.symbol);

      let full: string;
      if (definitions.length === 0) {
        full = `<definitions symbol="${escapeXML(parsed.symbol)}" count="0">\n  <!-- Symbol not found -->\n</definitions>`;
      } else {
        const lines = [`<definitions symbol="${escapeXML(parsed.symbol)}" count="${definitions.length}">`];
        for (const def of definitions) {
          lines.push(`  <definition file="${def.filePath}" type="${def.type}">`);
          lines.push(`    ${def.signature.replace(/&/g, '&amp;').replace(/</g, '&lt;')}`);
          lines.push('  </definition>');
        }
        lines.push('</definitions>');
        full = lines.join('\n');
      }

      if (!hasBudgetArgs(args)) return full;

      // No skeletonProducer — over-budget falls through to truncation
      // with fallback_reason: 'skeleton_failed'. The response is
      // already structural metadata (signatures only, no bodies), so
      // there's no meaningful lighter form between "full" and "sliced".
      const result = await enforceBudget({
        ctx,
        full,
        args: readBudgetArgs(args),
        toolName: 'ctx_get_definition',
        defaultMaxTokens: DEFAULT_MAX_RESPONSE_TOKENS,
      });
      return wrapResponse(result);
    },
  );
}
