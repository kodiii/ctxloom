/**
 * ctx_get_affected_flows — Which execution flows are affected by changed files?
 *
 * Given a set of changed files (or auto-detected from git diff HEAD~1), finds all
 * symbols defined in those files and traces every execution flow (call chain) that
 * passes through any of those symbols — both callers of the changed symbols and the
 * downstream callees those callers reach.
 *
 * Algorithm:
 *   1. Resolve changed files (explicit list or git auto-detect).
 *   2. Collect all symbols exported/defined in the changed files via the symbol index.
 *   3. For each symbol, find its callers (who calls it) via the CallGraphIndex.
 *   4. For each distinct caller entry point, perform a bounded DFS forward through the
 *      call graph (reusing the same logic as ctx_execution_flow) to produce a flow.
 *   5. Return per-flow summaries grouped by root entry point.
 *
 * This answers: "If I change X, which call chains will be impacted?"
 */
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import type { DependencyGraph } from '../graph/DependencyGraph.js';
import type { CallGraphIndex } from '../graph/CallGraphIndex.js';
import { logger } from '../utils/logger.js';
import { ProjectRootField, PROJECT_ROOT_JSON_SCHEMA } from './projectRootParam.js';

const execAsync = promisify(exec);

const Schema = z.object({
  changed_files: z.array(z.string()).optional().describe(
    'Changed file paths (relative). Defaults to auto-detection from git diff HEAD~1.',
  ),
  use_git: z.boolean().optional().default(true).describe(
    'Auto-detect changed files from git diff HEAD~1 when changed_files is not provided (default: true)',
  ),
  depth: z.number().min(1).max(20).optional().default(8).describe(
    'Max DFS traversal depth per flow (default: 8)',
  ),
  max_flows: z.number().min(1).max(50).optional().default(20).describe(
    'Max number of affected flows to return (default: 20)',
  ),
  max_steps_per_flow: z.number().min(1).max(100).optional().default(30).describe(
    'Max call chain steps per flow (default: 30)',
  ),
  project_root: ProjectRootField,
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface FlowStep {
  symbol: string;
  file: string;
  depth: number;
  isCycle: boolean;
}

function buildFlow(
  entrySymbol: string,
  entryFile: string,
  maxDepth: number,
  maxSteps: number,
  graph: DependencyGraph,
  callIdx: CallGraphIndex,
): { steps: FlowStep[]; hasCycles: boolean } {
  const steps: FlowStep[] = [];
  let hasCycles = false;

  const visited = new Set<string>();
  const stack: Array<{ symbol: string; file: string; depth: number }> = [
    { symbol: entrySymbol, file: entryFile, depth: 0 },
  ];

  while (stack.length > 0 && steps.length < maxSteps) {
    const { symbol, file, depth } = stack.pop()!;
    const visitKey = `${file}:${symbol}`;

    if (visited.has(visitKey)) {
      hasCycles = true;
      steps.push({ symbol, file, depth, isCycle: true });
      continue;
    }
    visited.add(visitKey);
    steps.push({ symbol, file, depth, isCycle: false });

    if (depth >= maxDepth) continue;

    const callees = callIdx.getCallees(file, symbol);
    for (let i = callees.length - 1; i >= 0; i--) {
      const callee = callees[i];
      const defs = graph.lookupSymbol(callee);
      let calleeFile = defs.length > 0 ? defs[0].filePath : '';
      if (!calleeFile) {
        const candidates = callIdx.findFilesForCallerSymbol(callee);
        calleeFile = candidates.length > 0 ? candidates[0] : file;
      }
      stack.push({ symbol: callee, file: calleeFile, depth: depth + 1 });
    }
  }

  return { steps, hasCycles };
}

async function detectChangedFiles(projectRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync('git diff HEAD~1 --name-only', { cwd: projectRoot });
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    logger.warn('git diff failed for get_affected_flows — no changed files detected');
    return [];
  }
}

export function registerGetAffectedFlowsTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_get_affected_flows',
    {
      name: 'ctx_get_affected_flows',
      description:
        'Find all execution flows (call chains) affected by a set of changed files. ' +
        'For each symbol in the changed files, traces back to its callers, then follows the full ' +
        'forward call chain from each root caller. Returns per-flow call chain summaries. ' +
        'Answers "which code paths will be impacted by this change?" ' +
        'Auto-detects changed files from git diff HEAD~1 when none are provided.',
      inputSchema: {
        type: 'object',
        properties: {
          changed_files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Relative paths of changed files. Omit to auto-detect from git.',
          },
          use_git: {
            type: 'boolean',
            description: 'Auto-detect from git diff HEAD~1 (default: true)',
          },
          depth: {
            type: 'number',
            description: 'Max DFS traversal depth per flow (default: 8, max: 20)',
          },
          max_flows: {
            type: 'number',
            description: 'Max number of affected flows to return (default: 20, max: 50)',
          },
          max_steps_per_flow: {
            type: 'number',
            description: 'Max steps per call chain (default: 30, max: 100)',
          },
          project_root: PROJECT_ROOT_JSON_SCHEMA,
        },
      },
    },
    async (args) => {
      const { changed_files, use_git, depth, max_flows, max_steps_per_flow, project_root } = Schema.parse(args);

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
        return '<affected_flows changed_files="0" total_flows="0">\n  <!-- No changed files detected -->\n</affected_flows>';
      }

      const callIdx = graph.getCallGraphIndex();

      // Collect all symbols defined in the changed files
      const changedSymbols: Array<{ symbol: string; file: string }> = [];
      for (const file of files) {
        for (const sym of graph.lookupSymbolsByFile(file)) {
          changedSymbols.push({ symbol: sym, file });
        }
      }

      // For each changed symbol, find its callers to discover affected entry points
      // De-duplicate by "entryFile:entrySymbol"
      const seenEntries = new Set<string>();
      const entryPoints: Array<{ symbol: string; file: string; touchedSymbol: string; touchedFile: string }> = [];

      for (const { symbol: changedSym, file: changedFile } of changedSymbols) {
        const callers = callIdx.getCallers(changedSym);

        if (callers.length === 0) {
          // The symbol itself is a potential entry point (no callers = it's called externally or is a top-level export)
          const key = `${changedFile}:${changedSym}`;
          if (!seenEntries.has(key)) {
            seenEntries.add(key);
            entryPoints.push({ symbol: changedSym, file: changedFile, touchedSymbol: changedSym, touchedFile: changedFile });
          }
        } else {
          for (const caller of callers) {
            // Walk up to find the root (outermost) caller by checking if the caller itself is called by anyone
            const callerKey = `${caller.file}:${caller.symbol}`;
            if (!seenEntries.has(callerKey)) {
              seenEntries.add(callerKey);
              entryPoints.push({ symbol: caller.symbol, file: caller.file, touchedSymbol: changedSym, touchedFile: changedFile });
            }
          }
        }

        if (entryPoints.length >= max_flows) break;
      }

      // Build flow for each entry point (capped at max_flows)
      const cappedEntries = entryPoints.slice(0, max_flows);
      const flows = cappedEntries.map(entry => ({
        entry,
        ...buildFlow(entry.symbol, entry.file, depth, max_steps_per_flow, graph, callIdx),
      }));

      const xmlLines: string[] = [
        `<affected_flows changed_files="${files.length}" total_flows="${flows.length}" changed_symbols="${changedSymbols.length}">`,
        `  <changed>`,
        ...files.map(f => `    <file path="${escapeXML(f)}" />`),
        `  </changed>`,
      ];

      for (const flow of flows) {
        xmlLines.push(
          `  <flow entry="${escapeXML(flow.entry.symbol)}" entry_file="${escapeXML(flow.entry.file)}" ` +
          `touches="${escapeXML(flow.entry.touchedSymbol)}" touches_file="${escapeXML(flow.entry.touchedFile)}" ` +
          `steps="${flow.steps.length}" has_cycles="${flow.hasCycles}">`,
        );
        for (const step of flow.steps) {
          if (step.isCycle) {
            xmlLines.push(`    <cycle symbol="${escapeXML(step.symbol)}" file="${escapeXML(step.file)}" depth="${step.depth}" />`);
          } else {
            xmlLines.push(`    <step symbol="${escapeXML(step.symbol)}" file="${escapeXML(step.file)}" depth="${step.depth}" />`);
          }
        }
        xmlLines.push('  </flow>');
      }

      xmlLines.push('</affected_flows>');
      return xmlLines.join('\n');
    },
  );
}
