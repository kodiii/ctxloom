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

/**
 * Per-tool default from the Phase B2 issue's provisional table
 * (#106). Activates only when the caller opts into the budget surface
 * (any of the 3 new fields present) but doesn't pass max_response_tokens
 * explicitly. Tuned downward from raw token estimates because file
 * reads are the most common over-budget vector. Will be re-derived
 * from real per-tool telemetry once Phase A's tier-distribution data
 * accumulates enough coverage to break out per-tool p75s.
 */
const DEFAULT_MAX_RESPONSE_TOKENS = 8000;

const Schema = z.object({
  path: z.string().describe('Relative path to the file'),
  project_root: ProjectRootField,
  // ─── Phase B2 budget surface (all optional; back-compat preserved) ──
  max_response_tokens: z.number().int().positive().optional()
    .describe('Soft response budget in tokens. Falls back to a skeleton when exceeded. Default: 8000 (when budget surface is opted into).'),
  on_budget_exceeded: z.enum(['skeleton', 'truncate', 'error']).optional()
    .describe("Behavior when the response would exceed max_response_tokens. 'skeleton' (default) substitutes a Skeletonizer signature view; 'truncate' slices the raw text; 'error' throws a structured error with token counts so the caller can re-ask."),
  response_format: z.enum(['full', 'skeleton', 'auto']).optional()
    .describe("'skeleton' forces a Skeletonizer view regardless of budget; 'full'/'auto' lets the budget decide."),
});

export function registerFileTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_get_file',
    {
      name: 'ctx_get_file',
      description: 'Read a file from the project. Path is validated to prevent traversal outside the project root. Returns the full file content; when callers opt into the budget surface (max_response_tokens / on_budget_exceeded / response_format), the response is wrapped in a {data, meta} envelope and oversize content is auto-substituted with a Skeletonizer signature view.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file' },
          project_root: PROJECT_ROOT_JSON_SCHEMA,
          max_response_tokens: {
            type: 'number',
            description: 'Soft response budget in tokens. Falls back to a skeleton when exceeded. Default: 8000 (when budget surface is opted into).',
          },
          on_budget_exceeded: {
            type: 'string',
            enum: ['skeleton', 'truncate', 'error'],
            description: "Behavior when over budget. 'skeleton' (default) substitutes a signature view; 'truncate' slices the raw text; 'error' throws.",
          },
          response_format: {
            type: 'string',
            enum: ['full', 'skeleton', 'auto'],
            description: "'skeleton' forces a Skeletonizer view regardless of budget; 'full'/'auto' lets the budget decide.",
          },
        },
        required: ['path'],
      },
    },
    async (args) => {
      const parsed = Schema.parse(args);
      const validator = ctx.getPathValidator(parsed.project_root);
      const full = validator.readFile(parsed.path);

      // Back-compat invariant from B2.1: when no budget args are
      // present, return the raw text unchanged — no envelope, no
      // skeleton work, no telemetry. Existing callers see zero
      // behavior change.
      if (!hasBudgetArgs(args)) return full;

      // Caller opted in. Resolve the absolute path once so the
      // skeleton producer doesn't have to re-validate.
      const absPath = validator.validate(parsed.path);
      const skeletonizer = await ctx.getSkeletonizer(parsed.project_root);

      const result = await enforceBudget({
        ctx,
        full,
        args: readBudgetArgs(args),
        toolName: 'ctx_get_file',
        defaultMaxTokens: DEFAULT_MAX_RESPONSE_TOKENS,
        skeletonProducer: () => skeletonizer.skeletonize(absPath),
      });

      return wrapResponse(result);
    },
  );
}
