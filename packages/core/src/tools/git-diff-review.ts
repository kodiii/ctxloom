/**
 * ctx_git_diff_review — All-in-one code review packet for changed files.
 *
 * Combines:
 *   - git diff per changed file (truncated to max_diff_lines)
 *   - optional file skeletons for changed files and their direct importers
 *   - blast radius: direct importers, transitive importers, call sites
 *
 * Designed to give an AI reviewer everything it needs in a single call.
 */
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { computeBlastRadius } from './blast-radius.js';
import { logger } from '../utils/logger.js';
import { ProjectRootField, PROJECT_ROOT_JSON_SCHEMA } from './projectRootParam.js';

// SECURITY: Use execFile (not exec / shell) so user-controlled file paths
// are passed as argv elements, not interpolated into a shell string. The
// previous exec(`git diff HEAD~1 -- "${file}"`) was an MCP-AI-controllable
// shell injection: an adversarial / prompt-injected AI could pass
// `; rm -rf ~ #` as a `changed_files` element and achieve RCE.
const execFileAsync = promisify(execFile);

const Schema = z.object({
  changed_files: z.array(z.string()).optional().describe(
    'Changed file paths (relative to project root). Omit to auto-detect from git diff HEAD~1.',
  ),
  depth: z.number().min(1).max(10).optional().default(3).describe('Blast radius traversal depth (default: 3)'),
  use_git: z.boolean().optional().default(true).describe('Auto-detect changed files from git diff HEAD~1'),
  include_skeletons: z.boolean().optional().default(true).describe(
    'Include API skeletons for changed files and their top direct importers (default: true)',
  ),
  max_diff_lines: z.number().min(10).max(2000).optional().default(300).describe(
    'Max diff lines to include per file (default: 300)',
  ),
  project_root: ProjectRootField,
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function getFileDiff(projectRoot: string, file: string): Promise<string> {
  // Defence-in-depth: PathValidator already runs upstream, but reject obvious
  // path-component shenanigans here too. `--` to git is a sentinel that
  // ensures the file is treated as a path even if it starts with `-`.
  if (file.includes('\0') || file.startsWith('-')) return '';
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', 'HEAD~1', '--', file],
      { cwd: projectRoot, maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout.trim();
  } catch {
    return '';
  }
}

async function trySkeletonize(ctx: ServerContext, filePath: string, projectRoot?: string): Promise<string> {
  try {
    const sk = await ctx.getSkeletonizer(projectRoot);
    const absPath = `${ctx.projectRoot}/${filePath}`;
    return await sk.skeletonize(absPath);
  } catch {
    return '';
  }
}

export function registerGitDiffReviewTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_git_diff_review',
    {
      name: 'ctx_git_diff_review',
      description:
        'All-in-one code review packet for changed files. ' +
        'Returns git diffs, optional API skeletons, and a full blast radius (direct importers, ' +
        'transitive importers, call sites). Use this as the first call in any code review workflow.',
      inputSchema: {
        type: 'object',
        properties: {
          changed_files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Relative paths of changed files. Omit to auto-detect from git diff HEAD~1.',
          },
          depth: { type: 'number', description: 'Blast radius traversal depth (default: 3, max: 10)' },
          use_git: { type: 'boolean', description: 'Auto-detect changed files from git diff HEAD~1 (default: true)' },
          include_skeletons: {
            type: 'boolean',
            description: 'Include API skeletons for changed and importer files (default: true)',
          },
          max_diff_lines: { type: 'number', description: 'Max diff lines per file (default: 300)' },
          project_root: PROJECT_ROOT_JSON_SCHEMA,
        },
      },
    },
    async (args) => {
      const { changed_files, depth, use_git, include_skeletons, max_diff_lines, project_root } = Schema.parse(args);

      // Resolve changed files. PathValidator filters tool-supplied paths so
      // they can't escape the project root or contain shell metacharacters
      // that would survive into downstream string interpolations.
      const validator = ctx.getPathValidator(project_root);
      let files = (changed_files ?? []).filter(f => validator.isWithinRoot(f));
      if (files.length === 0 && use_git) {
        try {
          const { stdout } = await execFileAsync(
            'git',
            ['diff', 'HEAD~1', '--name-only'],
            { cwd: ctx.projectRoot, maxBuffer: 10 * 1024 * 1024 },
          );
          files = stdout.trim().split('\n').filter(Boolean);
        } catch {
          logger.warn('git diff failed — no changed files detected');
        }
      }

      if (files.length === 0) {
        return `<git_diff_review changed_files="0">\n  <!-- No changed files detected -->\n</git_diff_review>`;
      }

      const graph = await ctx.getGraph(project_root);
      const blast = await computeBlastRadius({
        changedFiles: files,
        depth,
        projectRoot: ctx.projectRoot,
        graph,
      });

      const lines: string[] = [
        `<git_diff_review changed_files="${files.length}" depth="${depth}">`,
      ];

      // ── changed_files section ──────────────────────────────────────────────
      lines.push(`  <changed_files count="${files.length}">`);
      for (const file of files) {
        lines.push(`    <file path="${escapeXML(file)}">`);

        // diff
        const rawDiff = use_git ? await getFileDiff(ctx.projectRoot, file) : '';
        const diffLines = rawDiff ? rawDiff.split('\n') : [];
        const truncated = diffLines.length > max_diff_lines;
        const diffContent = truncated
          ? [...diffLines.slice(0, max_diff_lines), `... (${diffLines.length - max_diff_lines} more lines)`].join('\n')
          : rawDiff;
        lines.push(`      <diff lines="${diffLines.length}" truncated="${truncated}">`);
        if (diffContent) {
          lines.push(escapeXML(diffContent));
        }
        lines.push('      </diff>');

        // skeleton
        if (include_skeletons) {
          const skeleton = await trySkeletonize(ctx, file, project_root);
          if (skeleton) {
            lines.push('      <skeleton>');
            lines.push(escapeXML(skeleton));
            lines.push('      </skeleton>');
          }
        }

        lines.push('    </file>');
      }
      lines.push('  </changed_files>');

      // ── direct_importers section ──────────────────────────────────────────
      lines.push(`  <direct_importers count="${blast.directImporters.length}">`);
      const skeletonLimit = 5;
      for (let i = 0; i < blast.directImporters.length; i++) {
        const file = blast.directImporters[i];
        lines.push(`    <file path="${escapeXML(file)}">`);
        if (include_skeletons && i < skeletonLimit) {
          const skeleton = await trySkeletonize(ctx, file, project_root);
          if (skeleton) {
            lines.push('      <skeleton>');
            lines.push(escapeXML(skeleton));
            lines.push('      </skeleton>');
          }
        }
        lines.push('    </file>');
      }
      lines.push('  </direct_importers>');

      // ── transitive_importers section ─────────────────────────────────────
      lines.push(`  <transitive_importers count="${blast.transitiveImporters.length}">`);
      for (const file of blast.transitiveImporters) {
        lines.push(`    <file path="${escapeXML(file)}" />`);
      }
      lines.push('  </transitive_importers>');

      // ── call_sites section ────────────────────────────────────────────────
      lines.push(`  <call_sites count="${blast.callSites.length}">`);
      for (const cs of blast.callSites) {
        lines.push(
          `    <call_site file="${escapeXML(cs.file)}" caller="${escapeXML(cs.callerSymbol)}" callee="${escapeXML(cs.calleeSymbol)}" />`,
        );
      }
      lines.push('  </call_sites>');

      lines.push('</git_diff_review>');
      return lines.join('\n');
    },
  );
}
