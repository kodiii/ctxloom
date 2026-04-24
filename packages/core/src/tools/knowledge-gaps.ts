/**
 * ctx_knowledge_gaps — Structural anti-pattern detection in the import graph.
 *
 * Reports three categories:
 * - isolated_files: zero in-edges AND zero out-edges (truly orphaned)
 * - untested_hubs: high-importer files with no matching test file
 * - dead_code_candidates: files not imported by anyone (and not an entry point)
 */
import { z } from 'zod';
import path from 'node:path';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';

const Schema = z.object({
  min_importers: z.number().min(1).max(50).optional().default(3).describe(
    'Minimum importers to qualify as an untested hub (default: 3)',
  ),
  limit: z.number().min(1).max(100).optional().default(20).describe(
    'Max entries per category (default: 20)',
  ),
  detail_level: z.enum(['standard', 'minimal']).default('standard').describe(
    '"standard" (default) returns full per-file listings. "minimal" returns counts only — ~60% fewer tokens.',
  ),
});

const TEST_PATTERN = /(\.test\.|\.spec\.|\/tests\/|\/test\/|\/spec\/|__tests__)/;
const ENTRY_PATTERN = /(^|\/)(index|main|server|app|cli)\.[^/]+$/;

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function registerKnowledgeGapsTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_knowledge_gaps',
    {
      name: 'ctx_knowledge_gaps',
      description:
        'Identify structural gaps in the codebase: isolated files with no connections, ' +
        'high-traffic hub files with no test coverage, and dead code candidates not imported by anyone. ' +
        'Use this to prioritise testing and cleanup work.',
      inputSchema: {
        type: 'object',
        properties: {
          min_importers: {
            type: 'number',
            description: 'Minimum importers for a file to qualify as an untested hub (default: 3)',
          },
          limit: {
            type: 'number',
            description: 'Max results per category (default: 20)',
          },
          detail_level: {
            type: 'string',
            enum: ['standard', 'minimal'],
            description: '"standard" returns full listings. "minimal" returns counts only (saves ~60% tokens).',
          },
        },
      },
    },
    async (args) => {
      const { min_importers, limit, detail_level } = Schema.parse(args);
      const graph = await ctx.getGraph();
      const files = graph.allFiles();

      const testFiles = new Set(files.filter(f => TEST_PATTERN.test(f)));

      // Build a set of base names covered by tests
      // e.g. 'user.test.ts' covers base 'user'
      const testedBases = new Set<string>();
      for (const tf of testFiles) {
        const base = path.basename(tf).replace(/\.(test|spec)\.[^.]+$/, '').replace(/\.[^.]+$/, '');
        if (base) testedBases.add(base);
      }

      const isolated: string[] = [];
      const deadCode: string[] = [];
      const untestedHubs: Array<{ file: string; importers: number }> = [];

      for (const file of files) {
        if (TEST_PATTERN.test(file)) continue; // skip test files themselves

        const importers = graph.getImporters(file).length;
        const imports = graph.getImports(file).length;

        // Isolated: truly disconnected
        if (importers === 0 && imports === 0) {
          isolated.push(file);
          continue;
        }

        // Dead code candidate: not imported by anyone, not an entry point
        if (importers === 0 && !ENTRY_PATTERN.test(file)) {
          deadCode.push(file);
        }

        // Untested hub: heavily imported but no test file found
        if (importers >= min_importers) {
          const base = path.basename(file).replace(/\.[^.]+$/, '');
          if (!testedBases.has(base)) {
            untestedHubs.push({ file, importers });
          }
        }
      }

      untestedHubs.sort((a, b) => b.importers - a.importers);

      const totalGaps = isolated.length + untestedHubs.length + deadCode.length;

      if (detail_level === 'minimal') {
        return `<knowledge_gaps count="${totalGaps}" detail_level="minimal" />`;
      }

      const lines = [
        `<knowledge_gaps total_files="${files.length}">`,
        `  <isolated_files count="${Math.min(isolated.length, limit)}">`,
      ];
      for (const f of isolated.slice(0, limit)) {
        lines.push(`    <file path="${escapeXML(f)}" />`);
      }
      lines.push('  </isolated_files>');

      lines.push(`  <untested_hubs count="${Math.min(untestedHubs.length, limit)}" min_importers="${min_importers}">`);
      for (const h of untestedHubs.slice(0, limit)) {
        lines.push(`    <file path="${escapeXML(h.file)}" importers="${h.importers}" />`);
      }
      lines.push('  </untested_hubs>');

      lines.push(`  <dead_code_candidates count="${Math.min(deadCode.length, limit)}">`);
      for (const f of deadCode.slice(0, limit)) {
        lines.push(`    <file path="${escapeXML(f)}" />`);
      }
      lines.push('  </dead_code_candidates>');

      lines.push('</knowledge_gaps>');
      return lines.join('\n');
    },
  );
}
