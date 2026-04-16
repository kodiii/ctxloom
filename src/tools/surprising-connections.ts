/**
 * ctx_surprising_connections — Structural anti-pattern detection.
 *
 * Reports three types of surprising connections:
 * - circular_dependencies: import cycles (DFS, max cycle length 5, max 20 cycles)
 * - cross_community_imports: files importing across Louvain community boundaries
 * - prod_imports_test: non-test files importing test files
 */
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { CommunityDetector } from '../graph/CommunityDetector.js';

const Schema = z.object({
  max_cycles: z.number().min(1).max(100).optional().default(20).describe(
    'Max circular dependency cycles to report (default: 20)',
  ),
  max_cross: z.number().min(1).max(200).optional().default(50).describe(
    'Max cross-community imports to report (default: 50)',
  ),
});

const TEST_PATTERN = /(\.test\.|\.spec\.|\/tests\/|\/test\/|\/spec\/|__tests__)/;

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Find cycles in the directed import graph using DFS with back-edge detection.
 * Only returns cycles of length ≤ maxLen. Stops after maxCycles found.
 */
function findCycles(
  files: string[],
  getImports: (f: string) => string[],
  maxLen: number,
  maxCycles: number,
): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();

  const dfs = (node: string, stackPath: string[], pathSet: Set<string>): void => {
    if (cycles.length >= maxCycles) return;
    if (stackPath.length > maxLen) return;

    for (const neighbor of getImports(node)) {
      if (cycles.length >= maxCycles) return;

      const cycleStart = stackPath.indexOf(neighbor);
      if (cycleStart !== -1) {
        // Found a cycle: stackPath[cycleStart..]
        cycles.push(stackPath.slice(cycleStart));
        continue;
      }

      if (!visited.has(neighbor) && !pathSet.has(neighbor)) {
        stackPath.push(neighbor);
        pathSet.add(neighbor);
        dfs(neighbor, stackPath, pathSet);
        stackPath.pop();
        pathSet.delete(neighbor);
      }
    }

    visited.add(node);
  };

  for (const file of files) {
    if (cycles.length >= maxCycles) break;
    if (!visited.has(file)) {
      dfs(file, [file], new Set([file]));
    }
  }

  // Deduplicate: normalise each cycle to start with the lexicographically smallest element
  const seen = new Set<string>();
  return cycles.filter(cycle => {
    const minIdx = cycle.indexOf(cycle.reduce((a, b) => (a < b ? a : b)));
    const normalised = [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)].join('→');
    if (seen.has(normalised)) return false;
    seen.add(normalised);
    return true;
  });
}

export function registerSurprisingConnectionsTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_surprising_connections',
    {
      name: 'ctx_surprising_connections',
      description:
        'Find surprising structural connections: circular import dependencies, ' +
        'files that bridge across architectural community boundaries, ' +
        'and production files that import test/spec files. ' +
        'Use this to identify architectural violations and coupling risks.',
      inputSchema: {
        type: 'object',
        properties: {
          max_cycles: {
            type: 'number',
            description: 'Max circular dependency cycles to report (default: 20)',
          },
          max_cross: {
            type: 'number',
            description: 'Max cross-community imports to report (default: 50)',
          },
        },
      },
    },
    async (args) => {
      const { max_cycles, max_cross } = Schema.parse(args);
      const graph = await ctx.getGraph();
      const files = graph.allFiles();

      // ── Circular dependencies ─────────────────────────────────────────────
      const cycles = findCycles(files, f => graph.getImports(f), 5, max_cycles);

      // ── Production files importing test files ─────────────────────────────
      const prodImportsTest: Array<{ from: string; to: string }> = [];
      for (const file of files) {
        if (TEST_PATTERN.test(file)) continue; // skip if already a test file
        for (const imported of graph.getImports(file)) {
          if (TEST_PATTERN.test(imported)) {
            prodImportsTest.push({ from: file, to: imported });
          }
        }
      }

      // ── Cross-community imports ───────────────────────────────────────────
      const crossImports: Array<{ from: string; to: string; fromComm: string; toComm: string }> = [];

      if (files.length > 0) {
        const detector = new CommunityDetector(graph);
        const communities = detector.detect();
        const fileToComm = new Map<string, string>();
        for (const c of communities) {
          for (const f of c.files) fileToComm.set(f, c.name);
        }

        outer: for (const file of files) {
          const fromComm = fileToComm.get(file);
          if (!fromComm) continue;
          for (const imported of graph.getImports(file)) {
            const toComm = fileToComm.get(imported);
            if (toComm && toComm !== fromComm) {
              crossImports.push({ from: file, to: imported, fromComm, toComm });
              if (crossImports.length >= max_cross) break outer;
            }
          }
        }
      }

      // ── Build XML ─────────────────────────────────────────────────────────
      const lines = [
        `<surprising_connections total_files="${files.length}">`,
        `  <circular_dependencies count="${cycles.length}">`,
      ];
      for (const cycle of cycles) {
        lines.push(`    <cycle length="${cycle.length}">`);
        for (const f of cycle) {
          lines.push(`      <file path="${escapeXML(f)}" />`);
        }
        lines.push('    </cycle>');
      }
      lines.push('  </circular_dependencies>');

      lines.push(`  <cross_community_imports count="${crossImports.length}">`);
      for (const x of crossImports) {
        lines.push(
          `    <import from="${escapeXML(x.from)}" to="${escapeXML(x.to)}" from_community="${escapeXML(x.fromComm)}" to_community="${escapeXML(x.toComm)}" />`,
        );
      }
      lines.push('  </cross_community_imports>');

      lines.push(`  <prod_imports_test count="${prodImportsTest.length}">`);
      for (const p of prodImportsTest) {
        lines.push(`    <import from="${escapeXML(p.from)}" to="${escapeXML(p.to)}" />`);
      }
      lines.push('  </prod_imports_test>');

      lines.push('</surprising_connections>');
      return lines.join('\n');
    },
  );
}
