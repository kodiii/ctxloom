/**
 * ctx_detect_changes — Risk-scored analysis of changed files.
 *
 * Scores each changed file critical/high/medium/low based on:
 *   - importer_count: how many files depend on it
 *   - is_hub: importer_count >= 5
 *   - has_test_coverage: a test file imports it or name-matches
 */
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import type { DependencyGraph } from '../graph/DependencyGraph.js';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

const Schema = z.object({
  changed_files: z.array(z.string()).optional(),
  use_git: z.boolean().optional().default(true),
  depth: z.number().min(1).max(10).optional().default(3),
  detail_level: z.enum(['standard', 'minimal']).default('standard').describe(
    '"standard" (default) returns full per-file risk details. "minimal" returns counts only — ~60% fewer tokens.',
  ),
});

type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

const TEST_PATTERN = /(\.test\.|\.spec\.|\/tests\/|\/test\/|\/spec\/|__tests__)/;

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hasTestCoverage(filePath: string, graph: DependencyGraph): boolean {
  const importers = graph.getImporters(filePath);
  if (importers.some(f => TEST_PATTERN.test(f))) return true;
  const base = filePath.replace(/\.[^.]+$/, '');
  const stem = base.split('/').pop() ?? '';
  return graph.allFiles().some(f => TEST_PATTERN.test(f) && stem.length > 0 && f.includes(stem));
}

function computeRisk(
  filePath: string,
  graph: DependencyGraph,
): { level: RiskLevel; importerCount: number; isHub: boolean; hasCoverage: boolean; reasons: string[] } {
  const isTest = TEST_PATTERN.test(filePath);
  const importerCount = graph.getImporters(filePath).length;
  const isHub = importerCount >= 5;
  const hasCoverage = isTest || hasTestCoverage(filePath, graph);
  const reasons: string[] = [];

  if (isHub) reasons.push(`hub: ${importerCount} dependents`);
  if (!hasCoverage && !isTest) reasons.push('no test coverage');
  if (importerCount > 0 && !isHub) reasons.push(`${importerCount} direct importers`);

  let level: RiskLevel;
  if (isTest) {
    level = 'low';
  } else if (isHub && !hasCoverage) {
    level = 'critical';
  } else if (isHub || (!hasCoverage && importerCount > 2)) {
    level = 'high';
  } else if (!hasCoverage) {
    level = 'medium';
  } else if (importerCount > 2) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return { level, importerCount, isHub, hasCoverage, reasons };
}

async function detectChangedFiles(projectRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync('git diff HEAD~1 --name-only', { cwd: projectRoot });
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    logger.warn('git diff failed for detect_changes');
    return [];
  }
}

const RISK_ORDER: Record<RiskLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function registerDetectChangesTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_detect_changes',
    {
      name: 'ctx_detect_changes',
      description:
        'Risk-score each changed file as critical/high/medium/low. ' +
        'Risk factors: hub files (>=5 importers), missing test coverage, blast radius size. ' +
        'Results sorted by risk level. Auto-detects changed files from git diff HEAD~1.',
      inputSchema: {
        type: 'object',
        properties: {
          changed_files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Relative paths of changed files. Omit to auto-detect from git.',
          },
          use_git: { type: 'boolean', description: 'Auto-detect from git diff HEAD~1 (default: true)' },
          depth: { type: 'number', description: 'Blast radius traversal depth (default: 3)' },
          detail_level: {
            type: 'string',
            enum: ['standard', 'minimal'],
            description: '"standard" returns full risk details. "minimal" returns counts only (saves ~60% tokens).',
          },
        },
      },
    },
    async (args) => {
      const { changed_files, use_git, detail_level } = Schema.parse(args);

      let files = changed_files ?? [];
      if (files.length === 0 && use_git) {
        files = await detectChangedFiles(ctx.projectRoot);
      }

      if (files.length === 0) {
        return '<detect_changes count="0">\n  <!-- No changed files detected -->\n</detect_changes>';
      }

      const graph = await ctx.getGraph();
      const scored = files.map(f => ({ file: f, ...computeRisk(f, graph) }));
      scored.sort((a, b) => RISK_ORDER[a.level] - RISK_ORDER[b.level]);

      const criticalCount = scored.filter(s => s.level === 'critical').length;
      const highCount = scored.filter(s => s.level === 'high').length;
      const mediumCount = scored.filter(s => s.level === 'medium').length;
      const lowCount = scored.filter(s => s.level === 'low').length;

      if (detail_level === 'minimal') {
        return `<detect_changes count="${scored.length}" critical="${criticalCount}" high="${highCount}" medium="${mediumCount}" low="${lowCount}" detail_level="minimal" />`;
      }

      const xml = [
        `<detect_changes count="${scored.length}" critical="${criticalCount}" high="${highCount}">`,
      ];

      for (const s of scored) {
        xml.push(
          `  <file path="${escapeXML(s.file)}" risk="${s.level}" importer_count="${s.importerCount}" is_hub="${s.isHub}" has_test_coverage="${s.hasCoverage}">`,
        );
        for (const reason of s.reasons) {
          xml.push(`    <reason>${escapeXML(reason)}</reason>`);
        }
        xml.push('  </file>');
      }

      xml.push('</detect_changes>');
      return xml.join('\n');
    },
  );
}
