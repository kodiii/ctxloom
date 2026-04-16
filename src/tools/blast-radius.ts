/**
 * ctx_blast_radius — "What breaks if I change this?"
 *
 * Traverses forward import edges AND call-graph edges from changed files.
 * Groups results: changed → direct importers → transitive importers → call sites.
 */
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { DependencyGraph } from '../graph/DependencyGraph.js';
import type { EdgeConfidence } from '../graph/CallGraphIndex.js';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

const Schema = z.object({
  changed_files: z.array(z.string()).optional().describe('Changed file paths (relative). Defaults to git diff HEAD~1.'),
  depth: z.number().min(1).max(10).optional().default(3).describe('Traversal depth (default: 3)'),
  use_git: z.boolean().optional().default(true).describe('Auto-detect changed files from git diff HEAD~1'),
  detail_level: z.enum(['standard', 'minimal']).default('standard').describe(
    '"standard" (default) returns full per-file listings. "minimal" returns counts only — ~60% fewer tokens.',
  ),
});

export interface BlastRadiusOptions {
  changedFiles: string[];
  depth: number;
  projectRoot: string;
  graph: DependencyGraph;
}

export interface BlastRadiusResult {
  changedFiles: string[];
  directImporters: string[];
  transitiveImporters: string[];
  callSites: Array<{ file: string; callerSymbol: string; calleeSymbol: string; confidence: EdgeConfidence }>;
}

async function detectChangedFiles(projectRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync('git diff HEAD~1 --name-only', { cwd: projectRoot });
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    logger.warn('git diff failed — no changed files detected (is this a git repo with at least 2 commits?)');
    return [];
  }
}

export async function computeBlastRadius(opts: BlastRadiusOptions): Promise<BlastRadiusResult> {
  const { changedFiles, depth, graph } = opts;
  const changedSet = new Set(changedFiles);

  // BFS traversal of importers
  const directImporters = new Set<string>();
  const allReachable = new Set<string>();

  // BFS: level 0 = changedFiles, level 1 = direct importers, etc.
  let frontier = new Set(changedFiles);
  for (let d = 0; d < depth; d++) {
    const nextFrontier = new Set<string>();
    for (const file of frontier) {
      for (const imp of graph.getImporters(file)) {
        if (changedSet.has(imp)) continue;
        if (d === 0) directImporters.add(imp);
        if (!allReachable.has(imp)) {
          allReachable.add(imp);
          nextFrontier.add(imp);
        }
      }
    }
    frontier = nextFrontier;
    if (frontier.size === 0) break;
  }

  // Transitive = reachable but NOT direct importers
  const transitiveImporters: string[] = [];
  for (const file of allReachable) {
    if (!directImporters.has(file)) transitiveImporters.push(file);
  }

  // Call sites: find callers of symbols defined in changed files
  const callSites: BlastRadiusResult['callSites'] = [];
  const callIdx = graph.getCallGraphIndex();
  for (const file of changedFiles) {
    const symbolNames = graph.lookupSymbolsByFile(file);
    for (const sym of symbolNames) {
      for (const caller of callIdx.getCallers(sym)) {
        callSites.push({ file: caller.file, callerSymbol: caller.symbol, calleeSymbol: sym, confidence: caller.confidence });
      }
    }
  }

  return {
    changedFiles: Array.from(changedSet),
    directImporters: Array.from(directImporters),
    transitiveImporters,
    callSites,
  };
}

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildBlastRadiusXml(
  result: BlastRadiusResult,
  depth: number,
  detailLevel: 'standard' | 'minimal',
): string {
  const graphType = result.callSites.length > 0 ? 'import+call' : 'import';

  if (detailLevel === 'minimal') {
    return [
      `<blast_radius changed_files="${result.changedFiles.length}" direct_importers="${result.directImporters.length}"`,
      ` transitive_importers="${result.transitiveImporters.length}" call_sites="${result.callSites.length}"`,
      ` depth="${depth}" graph_type="${graphType}" detail_level="minimal" />`,
    ].join('');
  }

  // Standard mode — full per-file XML
  const lines = [
    `<blast_radius changed_files="${result.changedFiles.length}" depth="${depth}" graph_type="${graphType}">`,
    `  <changed count="${result.changedFiles.length}">`,
    ...result.changedFiles.map(f => `    <file path="${escapeXML(f)}" />`),
    '  </changed>',
    `  <direct_importers count="${result.directImporters.length}">`,
    ...result.directImporters.map(f => `    <file path="${escapeXML(f)}" />`),
    '  </direct_importers>',
    `  <transitive_importers count="${result.transitiveImporters.length}">`,
    ...result.transitiveImporters.map(f => `    <file path="${escapeXML(f)}" />`),
    '  </transitive_importers>',
    `  <call_sites count="${result.callSites.length}">`,
    ...result.callSites.map(s =>
      `    <call_site file="${escapeXML(s.file)}" caller="${escapeXML(s.callerSymbol)}" callee="${escapeXML(s.calleeSymbol)}" confidence="${s.confidence}" />`,
    ),
    '  </call_sites>',
    '</blast_radius>',
  ];
  return lines.join('\n');
}

export function registerBlastRadiusTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_blast_radius',
    {
      name: 'ctx_blast_radius',
      description:
        'Compute the blast radius of changed files: who imports them, transitively, and which call sites are affected. ' +
        'Answers "if I change this, what breaks?" with file-level and symbol-level grouping.',
      inputSchema: {
        type: 'object',
        properties: {
          changed_files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Relative paths of changed files. Omit to auto-detect from git diff HEAD~1.',
          },
          depth: { type: 'number', description: 'Traversal depth (default: 3, max: 10)' },
          use_git: { type: 'boolean', description: 'Auto-detect from git diff HEAD~1 (default: true)' },
          detail_level: {
            type: 'string',
            enum: ['standard', 'minimal'],
            description: '"standard" returns full listings. "minimal" returns counts only (saves ~60% tokens).',
          },
        },
      },
    },
    async (args) => {
      const { changed_files, depth, use_git, detail_level } = Schema.parse(args);

      let files = changed_files ?? [];
      if (files.length === 0 && use_git) {
        files = await detectChangedFiles(ctx.projectRoot);
      }

      if (files.length === 0) {
        return '<blast_radius changed_files="0">\n  <!-- No changed files detected -->\n</blast_radius>';
      }

      const graph = await ctx.getGraph();
      const result = await computeBlastRadius({ changedFiles: files, depth, projectRoot: ctx.projectRoot, graph });

      return buildBlastRadiusXml(result, depth, detail_level);
    },
  );
}
