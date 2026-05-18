/**
 * ctx_execution_flow — DFS execution flow from a symbol entry point.
 *
 * Traverses the CallGraphIndex forward (entry → callees → their callees …)
 * to produce a flat ordered list of steps representing the execution path.
 *
 * - Uses the call graph index (TypeScript/TSX, graph_type="call")
 * - Falls back to import-level adjacency for files without call edges
 *   (graph_type="import", clearly annotated)
 * - Detects cycles and marks them without infinite looping
 * - Cross-file resolution: when a callee is found, looks up its definition
 *   file via DependencyGraph.lookupSymbol()
 */
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import type { DependencyGraph } from '../graph/DependencyGraph.js';
import type { CallGraphIndex } from '../graph/CallGraphIndex.js';
import { ProjectRootField, PROJECT_ROOT_JSON_SCHEMA } from './projectRootParam.js';
import { enforceBudget, hasBudgetArgs, readBudgetArgs, wrapResponse } from '../budget/budget.js';

/** Per #106 provisional table — bounded step list, no useful skeleton form. */
const DEFAULT_MAX_RESPONSE_TOKENS = 4000;

const Schema = z.object({
  entry_point: z.string().min(1).describe('Symbol name to start the execution flow from'),
  entry_file: z.string().optional().describe(
    'File path containing the entry symbol (relative). ' +
    'Disambiguates when the same symbol name appears in multiple files.',
  ),
  depth: z.number().min(1).max(20).optional().default(10).describe('Max traversal depth (default: 10)'),
  max_nodes: z.number().min(1).max(200).optional().default(50).describe(
    'Max total steps to include in output (default: 50)',
  ),
  project_root: ProjectRootField,
  // ─── Phase B2 budget surface ──
  max_response_tokens: z.number().int().positive().optional()
    .describe('Soft response budget. Default: 4000 (when opted in). No skeleton fallback — response is already a bounded step list; over-budget falls through to truncation.'),
  on_budget_exceeded: z.enum(['skeleton', 'truncate', 'error']).optional()
    .describe("Behavior when over budget. 'skeleton'/'truncate' both slice; 'error' throws."),
  response_format: z.enum(['full', 'skeleton', 'auto']).optional()
    .describe("'full'/'auto' default; 'skeleton' same output."),
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface FlowStep {
  symbol: string;
  file: string;
  depth: number;
  graphType: 'call' | 'import';
  parent: string;  // parent symbol name or '' for entry
  isCycle: boolean;
}

function buildFlowSteps(
  entrySymbol: string,
  entryFile: string,
  maxDepth: number,
  maxNodes: number,
  graph: DependencyGraph,
  callIdx: CallGraphIndex,
): { steps: FlowStep[]; hasCycles: boolean } {
  const steps: FlowStep[] = [];
  let hasCycles = false;

  // visited key: "file:symbol" → prevents re-traversal
  const visited = new Set<string>();

  // DFS stack: { symbol, file, depth, parent }
  const stack: Array<{ symbol: string; file: string; depth: number; parent: string }> = [
    { symbol: entrySymbol, file: entryFile, depth: 0, parent: '' },
  ];

  while (stack.length > 0 && steps.length < maxNodes) {
    const { symbol, file, depth, parent } = stack.pop()!;
    const visitKey = `${file}:${symbol}`;

    if (visited.has(visitKey)) {
      // Cycle detected
      hasCycles = true;
      steps.push({ symbol, file, depth, graphType: 'call', parent, isCycle: true });
      continue;
    }
    visited.add(visitKey);

    steps.push({ symbol, file, depth, graphType: 'call', parent, isCycle: false });

    if (depth >= maxDepth) continue;

    // Forward lookup: what does this function call?
    const callees = callIdx.getCallees(file, symbol);

    // Push in reverse order so DFS processes them in the natural order
    for (let i = callees.length - 1; i >= 0; i--) {
      const callee = callees[i];
      // Resolve the callee's file: prefer symbol index, then call graph forward index
      const defs = graph.lookupSymbol(callee);
      let calleeFile = defs.length > 0 ? defs[0].filePath : '';
      if (!calleeFile) {
        // Fall back: find any file where this symbol has outgoing call edges
        const candidateFiles = callIdx.findFilesForCallerSymbol(callee);
        calleeFile = candidateFiles.length > 0 ? candidateFiles[0] : file;
      }
      stack.push({ symbol: callee, file: calleeFile, depth: depth + 1, parent: symbol });
    }
  }

  return { steps, hasCycles };
}

export function registerExecutionFlowTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_execution_flow',
    {
      name: 'ctx_execution_flow',
      description:
        'DFS execution flow from a symbol entry point through the call graph. ' +
        'Shows the full call chain: entry → callees → their callees, with cycle detection. ' +
        'Each step is annotated with file path and graph_type (call or import). ' +
        'Ideal for understanding code paths, debugging, and impact analysis.',
      inputSchema: {
        type: 'object',
        properties: {
          entry_point: {
            type: 'string',
            description: 'Symbol name to start the execution flow from',
          },
          entry_file: {
            type: 'string',
            description: 'File containing the entry symbol (relative path). Helps disambiguate.',
          },
          depth: {
            type: 'number',
            description: 'Max traversal depth (default: 10, max: 20)',
          },
          max_nodes: {
            type: 'number',
            description: 'Max total steps to return (default: 50)',
          },
          project_root: PROJECT_ROOT_JSON_SCHEMA,
          max_response_tokens: { type: 'number', description: 'Soft response budget. Default: 4000 (when opted in).' },
          on_budget_exceeded: { type: 'string', enum: ['skeleton', 'truncate', 'error'], description: "Behavior over budget." },
          response_format: { type: 'string', enum: ['full', 'skeleton', 'auto'], description: "'full'/'auto' default; 'skeleton' same output." },
        },
        required: ['entry_point'],
      },
    },
    async (args) => {
      const { entry_point, entry_file, depth, max_nodes, project_root } = Schema.parse(args);

      const graph = await ctx.getGraph(project_root);
      const callIdx = graph.getCallGraphIndex();

      // Resolve the entry file via (in priority order):
      //   1. Caller-provided entry_file
      //   2. Symbol index (DependencyGraph.lookupSymbol)
      //   3. Call graph forward index (files that have outgoing edges for this symbol)
      //   4. Import graph allFiles scan
      let resolvedFile = entry_file ?? '';

      if (!resolvedFile) {
        const defs = graph.lookupSymbol(entry_point);
        if (defs.length > 0) resolvedFile = defs[0].filePath;
      }

      if (!resolvedFile) {
        const files = callIdx.findFilesForCallerSymbol(entry_point);
        if (files.length > 0) resolvedFile = files[0];
      }

      if (!resolvedFile) {
        for (const f of graph.allFiles()) {
          if (callIdx.getCallees(f, entry_point).length > 0) {
            resolvedFile = f;
            break;
          }
        }
      }

      const maybeBudget = async (full: string): Promise<string> => {
        if (!hasBudgetArgs(args)) return full;
        const result = await enforceBudget({
          ctx,
          full,
          args: readBudgetArgs(args),
          toolName: 'ctx_execution_flow',
          defaultMaxTokens: DEFAULT_MAX_RESPONSE_TOKENS,
        });
        return wrapResponse(result);
      };

      // Give up — no call graph entries anywhere for this symbol
      if (!resolvedFile) {
        return maybeBudget(`<execution_flow entry="${escapeXML(entry_point)}" total_steps="0" has_cycles="false">\n  <!-- No call graph entries found for symbol -->\n</execution_flow>`);
      }

      const { steps, hasCycles } = buildFlowSteps(
        entry_point,
        resolvedFile,
        depth,
        max_nodes,
        graph,
        callIdx,
      );

      const xmlLines: string[] = [
        `<execution_flow entry="${escapeXML(entry_point)}" entry_file="${escapeXML(resolvedFile)}" total_steps="${steps.length}" has_cycles="${hasCycles}" depth="${depth}">`,
      ];

      for (const step of steps) {
        if (step.isCycle) {
          xmlLines.push(
            `  <cycle symbol="${escapeXML(step.symbol)}" file="${escapeXML(step.file)}" depth="${step.depth}" parent="${escapeXML(step.parent)}" />`,
          );
        } else {
          xmlLines.push(
            `  <step symbol="${escapeXML(step.symbol)}" file="${escapeXML(step.file)}" depth="${step.depth}" graph_type="${step.graphType}" parent="${escapeXML(step.parent)}" />`,
          );
        }
      }

      xmlLines.push('</execution_flow>');
      return maybeBudget(xmlLines.join('\n'));
    },
  );
}
