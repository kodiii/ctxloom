/**
 * ctx_suggested_questions — Auto-generate structural code review questions.
 *
 * Questions derived from graph analysis (no LLM):
 *   1. Blast radius
 *   2. Test coverage
 *   3. Hub risk
 *   4. Cross-module spread
 *   5. General completeness
 */
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { logger } from '../utils/logger.js';
import { ProjectRootField, PROJECT_ROOT_JSON_SCHEMA } from './projectRootParam.js';

const execAsync = promisify(exec);

const Schema = z.object({
  changed_files: z.array(z.string()).optional(),
  use_git: z.boolean().optional().default(true),
  project_root: ProjectRootField,
});

const TEST_PATTERN = /(\.test\.|\.spec\.|\/tests\/|\/test\/|\/spec\/|__tests__)/;

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function detectChangedFiles(projectRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync('git diff HEAD~1 --name-only', { cwd: projectRoot });
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    logger.warn('git diff failed for suggested_questions');
    return [];
  }
}

export function registerSuggestedQuestionsTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_suggested_questions',
    {
      name: 'ctx_suggested_questions',
      description:
        'Generate structural code review questions from graph analysis. ' +
        'No LLM required — questions based on blast radius, test coverage, hub status, ' +
        'and cross-module spread.',
      inputSchema: {
        type: 'object',
        properties: {
          changed_files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Changed file paths. Omit to auto-detect from git.',
          },
          use_git: { type: 'boolean', description: 'Auto-detect from git diff HEAD~1 (default: true)' },
          project_root: PROJECT_ROOT_JSON_SCHEMA,
        },
      },
    },
    async (args) => {
      const { changed_files, use_git, project_root } = Schema.parse(args);

      // Build the graph first so git auto-detection runs against the
      // project the caller asked for, not ctx.projectRoot (the server
      // default). See detect-changes.ts for the full git-cwd rationale.
      const graph = await ctx.getGraph(project_root);
      const gitRoot = graph.getRootDir() || ctx.projectRoot;

      let files = changed_files ?? [];
      if (files.length === 0 && use_git) {
        files = await detectChangedFiles(gitRoot);
      }

      if (files.length === 0) {
        return '<suggested_questions count="1" changed_files="0"><question>No changed files detected. Are you on a git branch with commits?</question></suggested_questions>';
      }

      const questions: string[] = [];

      const allImporters = new Set<string>();
      const hubFiles: string[] = [];
      const untestedFiles: string[] = [];
      const topLevelDirs = new Set<string>();

      for (const file of files) {
        if (TEST_PATTERN.test(file)) continue;

        const importers = graph.getImporters(file);
        importers.forEach(f => allImporters.add(f));

        const isHub = importers.length >= 5;
        if (isHub) hubFiles.push(`${file} (${importers.length} dependents)`);

        const stem = file.replace(/\.[^.]+$/, '').split('/').pop() ?? '';
        const hasTest = importers.some(f => TEST_PATTERN.test(f))
          || (stem.length > 0 && graph.allFiles().some(f => TEST_PATTERN.test(f) && f.includes(stem)));
        if (!hasTest) untestedFiles.push(file);

        const topDir = file.split('/')[0];
        if (topDir) topLevelDirs.add(topDir);
      }

      if (allImporters.size > 0) {
        questions.push(
          `${allImporters.size} file(s) depend on this change directly or transitively. Have they been reviewed for breakage?`,
        );
      }

      if (hubFiles.length > 0) {
        questions.push(
          `High-risk hub: ${hubFiles.join(', ')} ${hubFiles.length === 1 ? 'is a hub file' : 'are hub files'} with many dependents. Is the change backward-compatible?`,
        );
      }

      if (untestedFiles.length > 0) {
        questions.push(
          `No test file detected for: ${untestedFiles.slice(0, 3).join(', ')}. Should test coverage be added or updated?`,
        );
      }

      if (topLevelDirs.size > 1) {
        questions.push(
          `This change spans ${topLevelDirs.size} top-level directories (${Array.from(topLevelDirs).join(', ')}). Is the coupling intentional?`,
        );
      }

      questions.push(
        `Does the change include updates to documentation, changelogs, or dependent package versions if the public API changed?`,
      );

      const xml = [`<suggested_questions count="${questions.length}" changed_files="${files.length}">`];
      for (const q of questions) {
        xml.push(`  <question>${escapeXML(q)}</question>`);
      }
      xml.push('</suggested_questions>');
      return xml.join('\n');
    },
  );
}
