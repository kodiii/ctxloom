/**
 * ctx_wiki_generate — Generate structural Markdown wiki for each community.
 *
 * Writes .ctxloom/wiki/index.md + one page per Louvain community.
 * Pages are hash-cached; only updated when content changes.
 *
 * Response shape: returns metadata per *written* page (path, size, status)
 * and a single count for skipped pages. On a real-size repo with hundreds
 * of communities, emitting a `<page>` entry for every skipped page alone
 * blew past the MCP token cap (~290 KB on a 979-community run) and forced
 * the response to a temp file. The wiki files themselves still live on
 * disk — callers that need a body can read the listed path directly.
 */
import { z } from 'zod';
import fs from 'node:fs';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { WikiGenerator } from '../graph/WikiGenerator.js';
import { ProjectRootField, PROJECT_ROOT_JSON_SCHEMA } from './projectRootParam.js';
import { enforceBudget, hasBudgetArgs, readBudgetArgs, wrapResponse } from '../budget/budget.js';

/** Per #106 provisional table. */
const DEFAULT_MAX_RESPONSE_TOKENS = 12000;

const Schema = z.object({
  force: z.boolean().optional().default(false).describe(
    'Regenerate all pages even if content unchanged (default: false)',
  ),
  detail_level: z.enum(['standard', 'minimal']).default('standard').describe(
    '"standard" (default) lists each written page with size. "minimal" returns counts only.',
  ),
  project_root: ProjectRootField,
  // ─── Phase B2 budget surface ──
  max_response_tokens: z.number().int().positive().optional()
    .describe('Soft response budget. Default: 12000 (when opted in). Over-budget re-renders at detail_level=minimal (counts only) — the wiki files themselves are unaffected.'),
  on_budget_exceeded: z.enum(['skeleton', 'truncate', 'error']).optional()
    .describe("Behavior when over budget. 'skeleton' (default) downgrades to minimal output; 'truncate' slices; 'error' throws."),
  response_format: z.enum(['full', 'skeleton', 'auto']).optional()
    .describe("'skeleton' forces minimal output regardless of budget; 'full'/'auto' lets the budget decide."),
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function safeFileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

export function registerWikiGenerateTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_wiki_generate',
    {
      name: 'ctx_wiki_generate',
      description:
        'Generate structural Markdown wiki pages for each Louvain community. ' +
        'Writes to .ctxloom/wiki/: one page per community with its files, public API, ' +
        'dependency map, and hub file skeleton. Pages are hash-cached — only updated when content changes. ' +
        'Returns per-page metadata (path, size) for written pages and a count for skipped pages; ' +
        'read the listed paths directly when the body is needed.',
      inputSchema: {
        type: 'object',
        properties: {
          force: {
            type: 'boolean',
            description: 'Regenerate all pages even if content is unchanged (default: false)',
          },
          detail_level: {
            type: 'string',
            enum: ['standard', 'minimal'],
            description: '"standard" lists written pages with size. "minimal" returns counts only.',
          },
          project_root: PROJECT_ROOT_JSON_SCHEMA,
          max_response_tokens: { type: 'number', description: 'Soft response budget. Default: 12000 (when opted in).' },
          on_budget_exceeded: { type: 'string', enum: ['skeleton', 'truncate', 'error'], description: "Behavior over budget. 'skeleton' (default) downgrades to minimal; 'truncate' slices; 'error' throws." },
          response_format: { type: 'string', enum: ['full', 'skeleton', 'auto'], description: "'skeleton' forces minimal output; 'full'/'auto' lets the budget decide." },
        },
      },
    },
    async (args) => {
      const { force, detail_level, project_root } = Schema.parse(args);
      const [graph, skeletonizer] = await Promise.all([ctx.getGraph(project_root), ctx.getSkeletonizer(project_root)]);
      const generator = new WikiGenerator(graph, ctx.projectRoot, skeletonizer);
      const result = await generator.generate(force);

      const renderMinimal = (): string =>
        `<wiki_generate detail_level="minimal" wiki_dir="${escapeXML(result.wikiDir)}" ` +
        `written="${result.written.length}" skipped="${result.skipped.length}" />`;

      const renderStandard = (): string => {
        const lines = [
          `<wiki_generate wiki_dir="${escapeXML(result.wikiDir)}" written="${result.written.length}" skipped="${result.skipped.length}">`,
        ];
        for (const p of result.written) {
          const size = safeFileSize(p.filePath);
          lines.push(
            `  <page community="${escapeXML(p.communityName)}" file="${escapeXML(p.filePath)}" ` +
              `size="${size}" status="written" />`,
          );
        }
        // Per-skipped <page> entries dropped — see file header.
        lines.push('</wiki_generate>');
        return lines.join('\n');
      };

      const full = detail_level === 'minimal' ? renderMinimal() : renderStandard();

      if (!hasBudgetArgs(args)) return full;

      // Skeleton fallback: downgrade to detail_level=minimal output
      // (counts only). Already-explicitly-minimal callers fall through
      // to truncation since there's no lighter form below minimal.
      const budgetResult = await enforceBudget({
        ctx,
        full,
        args: readBudgetArgs(args),
        toolName: 'ctx_wiki_generate',
        defaultMaxTokens: DEFAULT_MAX_RESPONSE_TOKENS,
        skeletonProducer: detail_level === 'standard' ? async () => renderMinimal() : undefined,
      });
      return wrapResponse(budgetResult);
    },
  );
}
