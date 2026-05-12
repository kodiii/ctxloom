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

const Schema = z.object({
  force: z.boolean().optional().default(false).describe(
    'Regenerate all pages even if content unchanged (default: false)',
  ),
  detail_level: z.enum(['standard', 'minimal']).default('standard').describe(
    '"standard" (default) lists each written page with size. "minimal" returns counts only.',
  ),
  project_root: ProjectRootField,
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
        },
      },
    },
    async (args) => {
      const { force, detail_level, project_root } = Schema.parse(args);
      const [graph, skeletonizer] = await Promise.all([ctx.getGraph(project_root), ctx.getSkeletonizer(project_root)]);
      const generator = new WikiGenerator(graph, ctx.projectRoot, skeletonizer);
      const result = await generator.generate(force);

      if (detail_level === 'minimal') {
        return (
          `<wiki_generate detail_level="minimal" wiki_dir="${escapeXML(result.wikiDir)}" ` +
          `written="${result.written.length}" skipped="${result.skipped.length}" />`
        );
      }

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
      // Per-skipped <page> entries dropped — see file header. The count is
      // already in the parent attribute, and skipped pages are on disk
      // unchanged from a prior run, so a caller can re-list the wiki dir
      // if they need the full path set.
      lines.push('</wiki_generate>');
      return lines.join('\n');
    },
  );
}
