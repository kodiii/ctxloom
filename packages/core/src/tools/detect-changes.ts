/**
 * ctx_detect_changes — Risk-scored analysis of changed files.
 *
 * Scores each changed file critical/high/medium/low based on:
 *   - importer_count: how many files depend on it
 *   - is_hub: importer_count >= 5
 *   - has_test_coverage: a test file imports it or name-matches
 *
 * When ctx.overlay is present, each file also gets a `risk` block with
 * churn bucket, bugDensity, coupledNodes, and owners derived from git history.
 * When ctx.overlay is absent, `risk` is null per file and overlayNote is set
 * once at the response level.
 *
 * Pure analysis logic lives in src/lib/analysis.ts — this module handles
 * only MCP schema validation, git file detection, and XML formatting.
 */
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { detectChanges } from '../lib/analysis.js';
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

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

function buildReasonsFor(importerCount: number, isHub: boolean, hasCoverage: boolean, filePath: string): string[] {
  const isTest = /(\.test\.|\.spec\.|\/tests\/|\/test\/|\/spec\/|__tests__)/.test(filePath);
  const reasons: string[] = [];
  if (isHub) reasons.push(`hub: ${importerCount} dependents`);
  if (!hasCoverage && !isTest) reasons.push('no test coverage');
  if (importerCount > 0 && !isHub) reasons.push(`${importerCount} direct importers`);
  return reasons;
}

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
      const { changedFiles: scored, summary } = detectChanges({
        graph,
        overlay: ctx.overlay,
        changedFiles: files,
      });

      if (detail_level === 'minimal') {
        return (
          `<detect_changes count="${scored.length}" critical="${summary.critical}" high="${summary.high}"` +
          ` medium="${summary.medium}" low="${summary.low}" detail_level="minimal" />`
        );
      }

      const hasOverlay = ctx.overlay !== undefined;

      const xml = [
        `<detect_changes count="${scored.length}" critical="${summary.critical}" high="${summary.high}" medium="${summary.medium}" low="${summary.low}">`,
      ];

      if (!hasOverlay) {
        xml.push('  <!-- overlayNote: Re-index with --with-git to enable risk data. -->');
      }

      for (const s of scored) {
        const reasons = buildReasonsFor(s.importerCount, s.isHub, s.hasTestCoverage, s.file);
        xml.push(
          `  <file path="${escapeXML(s.file)}" risk="${s.riskLevel}" importer_count="${s.importerCount}" is_hub="${s.isHub}" has_test_coverage="${s.hasTestCoverage}">`,
        );
        for (const reason of reasons) {
          xml.push(`    <reason>${escapeXML(reason)}</reason>`);
        }

        if (hasOverlay && s.risk !== null) {
          xml.push(`    <overlay_risk churn="${s.risk.churn}" bug_density="${s.risk.bugDensity}">`);
          for (const cn of s.risk.coupledNodes) {
            xml.push(`      <coupled_node node="${escapeXML(cn.node)}" confidence="${cn.confidence}" />`);
          }
          for (const owner of s.risk.owners) {
            xml.push(`      <owner author="${escapeXML(owner.author)}" share="${owner.share}" />`);
          }
          xml.push('    </overlay_risk>');
        } else {
          xml.push('    <overlay_risk risk="null" />');
        }

        xml.push('  </file>');
      }

      xml.push('</detect_changes>');
      return xml.join('\n');
    },
  );
}
