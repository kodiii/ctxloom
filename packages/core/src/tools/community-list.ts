/**
 * ctx_community_list — Louvain-based community detection on the import graph.
 *
 * Returns architectural communities (clusters of tightly-coupled files) with
 * their names (longest common directory prefix) and sizes. Results are
 * computed fresh each call (fast: <20ms on typical codebases).
 *
 * Pagination: the unfiltered output on a real-size repo (~1000 communities)
 * exceeds the MCP per-call token limit, which forces the response to a
 * temp file and breaks interactive use. Default `limit=50` + `min_size=2`
 * keep the response under cap on every repo we've measured; callers can
 * page through via `offset` or raise `limit` up to 200.
 */
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { CommunityDetector } from '../graph/CommunityDetector.js';
import { ProjectRootField, PROJECT_ROOT_JSON_SCHEMA } from './projectRootParam.js';

const Schema = z.object({
  show_files: z.boolean().optional().default(false).describe(
    'Include member file paths in output (default: false for compact output)',
  ),
  limit: z.number().int().min(1).max(200).optional().default(50).describe(
    'Maximum number of communities to return per call (default: 50, max: 200)',
  ),
  offset: z.number().int().min(0).optional().default(0).describe(
    'Number of communities to skip before returning results — for paging (default: 0)',
  ),
  min_size: z.number().int().min(1).optional().default(2).describe(
    'Skip communities smaller than this (default: 2 — single-file communities are usually noise)',
  ),
  detail_level: z.enum(['standard', 'minimal']).default('standard').describe(
    '"standard" (default) returns paged community list. "minimal" returns counts only — useful for a quick size check before paging.',
  ),
  project_root: ProjectRootField,
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function registerCommunityListTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_community_list',
    {
      name: 'ctx_community_list',
      description:
        'Return architectural communities detected via Louvain clustering of the import graph. ' +
        'Each community is a cluster of tightly-coupled files (a feature area, module, or layer). ' +
        'Paged by default (limit=50, min_size=2). Use this to understand high-level codebase structure ' +
        'before diving into details; raise `limit` or page via `offset` for full coverage.',
      inputSchema: {
        type: 'object',
        properties: {
          show_files: {
            type: 'boolean',
            description: 'Include member file paths in output (default: false)',
          },
          limit: {
            type: 'number',
            description: 'Maximum communities to return (default: 50, max: 200)',
          },
          offset: {
            type: 'number',
            description: 'Number of communities to skip for paging (default: 0)',
          },
          min_size: {
            type: 'number',
            description: 'Skip communities smaller than this (default: 2)',
          },
          detail_level: {
            type: 'string',
            enum: ['standard', 'minimal'],
            description: '"standard" returns the paged list. "minimal" returns counts only.',
          },
          project_root: PROJECT_ROOT_JSON_SCHEMA,
        },
      },
    },
    async (args) => {
      const { show_files, limit, offset, min_size, detail_level, project_root } = Schema.parse(args);
      const graph = await ctx.getGraph(project_root);
      const files = graph.allFiles();

      if (files.length === 0) {
        return '<communities total="0" edge_count="0" />';
      }

      const detector = new CommunityDetector(graph);
      const allCommunities = detector.detect();
      const filtered = allCommunities
        .filter((c) => c.files.length >= min_size)
        .sort((a, b) => b.files.length - a.files.length);

      if (detail_level === 'minimal') {
        return (
          `<communities detail_level="minimal" total="${allCommunities.length}" ` +
          `filtered_total="${filtered.length}" edge_count="${graph.edgeCount()}" ` +
          `total_files="${files.length}" />`
        );
      }

      const page = filtered.slice(offset, offset + limit);
      const hasMore = offset + page.length < filtered.length;

      const lines = [
        `<communities total="${allCommunities.length}" filtered_total="${filtered.length}" ` +
          `showing="${page.length}" offset="${offset}" limit="${limit}" min_size="${min_size}" ` +
          `has_more="${hasMore}" edge_count="${graph.edgeCount()}" total_files="${files.length}">`,
      ];

      for (const c of page) {
        if (show_files) {
          lines.push(`  <community id="${c.id}" name="${escapeXML(c.name)}" size="${c.files.length}">`);
          for (const f of c.files.sort()) {
            lines.push(`    <file path="${escapeXML(f)}" />`);
          }
          lines.push('  </community>');
        } else {
          lines.push(`  <community id="${c.id}" name="${escapeXML(c.name)}" size="${c.files.length}" />`);
        }
      }

      lines.push('</communities>');
      return lines.join('\n');
    },
  );
}
