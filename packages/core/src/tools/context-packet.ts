import { z } from 'zod';
import path from 'node:path';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { ProjectRootField, PROJECT_ROOT_JSON_SCHEMA } from './projectRootParam.js';
import {
  enforceBudget,
  hasBudgetArgs,
  readBudgetArgs,
  wrapResponse,
} from '../budget/budget.js';

/** Per #106 provisional table. */
const DEFAULT_MAX_RESPONSE_TOKENS = 6000;

const Schema = z.object({
  target_file: z.string().describe('Relative path to the primary file'),
  mode: z.enum(['edit', 'read']).optional().default('edit').describe('Context mode'),
  project_root: ProjectRootField,
  // ─── Phase B2 budget surface ──
  max_response_tokens: z.number().int().positive().optional()
    .describe('Soft response budget. Default: 6000 (when budget surface is opted into). Over-budget rebuilds the packet with the primary file replaced by its skeleton.'),
  on_budget_exceeded: z.enum(['skeleton', 'truncate', 'error']).optional()
    .describe("Behavior when over budget. 'skeleton' (default) re-renders the packet with the primary file skeletonized; 'truncate' slices the raw envelope; 'error' throws."),
  response_format: z.enum(['full', 'skeleton', 'auto']).optional()
    .describe("'skeleton' forces the skeletonized-primary packet; 'full'/'auto' lets the budget decide."),
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface PacketParts {
  target_file: string;
  mode: string;
  primaryContent: string;
  skeletons: string[];
  imports: string[];
  importers: string[];
}

/**
 * Render the context packet XML. Extracted so the skeleton fallback can
 * re-render with the primary file content swapped for its skeleton.
 */
function renderPacket(parts: PacketParts): string {
  return [
    `<context_packet target="${parts.target_file}" mode="${parts.mode}">`,
    `  <primary_context file="${parts.target_file}">`,
    `    ${parts.primaryContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}`,
    '  </primary_context>',
    `  <dependency_skeletons count="${parts.imports.length}">`,
    ...parts.skeletons.map(s => `    ${s}`),
    '  </dependency_skeletons>',
    `  <imported_by count="${parts.importers.length}">`,
    ...parts.importers.map(imp => `    <importer file="${imp}" />`),
    '  </imported_by>',
    '</context_packet>',
  ].join('\n');
}

export function registerContextPacketTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_get_context_packet',
    {
      name: 'ctx_get_context_packet',
      description: 'Returns a smart multi-file context packet: the full target file, skeletons of its imports, and the list of files that import it. Reduces token usage by ~80% vs. sending full dependencies. When callers opt into the budget surface, over-budget responses re-render the packet with the primary file ALSO replaced by its Skeletonizer view.',
      inputSchema: {
        type: 'object',
        properties: {
          target_file: { type: 'string', description: 'Relative path to the primary file' },
          mode: { type: 'string', enum: ['edit', 'read'], description: 'Context mode (default: edit)' },
          project_root: PROJECT_ROOT_JSON_SCHEMA,
          max_response_tokens: {
            type: 'number',
            description: 'Soft response budget in tokens. Default: 6000 (when opted into).',
          },
          on_budget_exceeded: {
            type: 'string',
            enum: ['skeleton', 'truncate', 'error'],
            description: "Behavior when over budget. 'skeleton' (default) skeletonizes the primary; 'truncate' slices; 'error' throws.",
          },
          response_format: {
            type: 'string',
            enum: ['full', 'skeleton', 'auto'],
            description: "'skeleton' forces the skeletonized-primary packet; 'full'/'auto' lets the budget decide.",
          },
        },
        required: ['target_file'],
      },
    },
    async (args) => {
      const parsed = Schema.parse(args);
      const [skeletonizer, graph] = await Promise.all([
        ctx.getSkeletonizer(parsed.project_root),
        ctx.getGraph(parsed.project_root),
      ]);
      const pathValidator = ctx.getPathValidator(parsed.project_root);
      const primaryContent = pathValidator.readFile(parsed.target_file);
      const imports = graph.getImports(parsed.target_file);
      const importers = graph.getImporters(parsed.target_file);

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

      const parts: PacketParts = {
        target_file: parsed.target_file,
        mode: parsed.mode,
        primaryContent,
        skeletons,
        imports,
        importers,
      };
      const full = renderPacket(parts);

      if (!hasBudgetArgs(args)) return full;

      // Skeleton fallback: re-render the packet with the primary file
      // replaced by its Skeletonizer signature view. The dependency
      // skeletons + importer list are already compact, so the primary
      // is the only bulk worth swapping.
      const absPrimary = pathValidator.validate(parsed.target_file);
      const skeletonProducer = async (): Promise<string | null> => {
        const primarySkeleton = await skeletonizer.skeletonize(absPrimary);
        return renderPacket({ ...parts, primaryContent: primarySkeleton });
      };

      const result = await enforceBudget({
        full,
        args: readBudgetArgs(args),
        toolName: 'ctx_get_context_packet',
        defaultMaxTokens: DEFAULT_MAX_RESPONSE_TOKENS,
        skeletonProducer,
      });
      return wrapResponse(result);
    },
  );
}
