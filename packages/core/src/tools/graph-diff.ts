/**
 * graph-diff.ts — ctx_graph_diff
 *
 * Compare two named graph snapshots and report structural changes:
 * added/removed nodes (files) and added/removed edges (import relationships).
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import type { SnapshotData } from './graph-snapshot.js';

const schema = z.object({
  baseline: z.string().min(1).describe('Name of the baseline snapshot (the "before" state).'),
  current: z.string().min(1).describe('Name of the current snapshot (the "after" state).'),
});

export interface GraphDiffResult {
  addedNodes: string[];
  removedNodes: string[];
  addedEdges: { from: string; to: string }[];
  removedEdges: { from: string; to: string }[];
}

function loadSnapshot(name: string, rootDir: string): SnapshotData {
  const snapshotsDir = path.resolve(rootDir, '.ctxloom', 'snapshots');
  const snapshotPath = path.resolve(snapshotsDir, `${name}.json`);
  if (!snapshotPath.startsWith(snapshotsDir + path.sep)) {
    throw new Error(`Invalid snapshot name: "${name}"`);
  }
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Snapshot "${name}" not found. Run ctx_graph_snapshot first.`);
  }
  try {
    return JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as SnapshotData;
  } catch (e) {
    throw new Error(`Snapshot "${name}" is corrupted: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Compare two snapshots. Exported for testing. */
export function diffSnapshots(
  baselineName: string,
  currentName: string,
  rootDir: string,
): GraphDiffResult {
  const baseline = loadSnapshot(baselineName, rootDir);
  const current = loadSnapshot(currentName, rootDir);

  const baselineNodes = new Set(Object.keys(baseline.forwardEdges));
  const currentNodes = new Set(Object.keys(current.forwardEdges));

  const addedNodes = [...currentNodes].filter(n => !baselineNodes.has(n));
  const removedNodes = [...baselineNodes].filter(n => !currentNodes.has(n));

  // Build edge sets as "from\x00to" strings for set arithmetic
  const baselineEdges = new Set<string>();
  for (const [from, tos] of Object.entries(baseline.forwardEdges)) {
    for (const to of tos) baselineEdges.add(`${from}\x00${to}`);
  }

  const currentEdges = new Set<string>();
  for (const [from, tos] of Object.entries(current.forwardEdges)) {
    for (const to of tos) currentEdges.add(`${from}\x00${to}`);
  }

  const parseEdge = (e: string): { from: string; to: string } => {
    const idx = e.indexOf('\x00');
    return { from: e.slice(0, idx), to: e.slice(idx + 1) };
  };

  const addedEdges = [...currentEdges].filter(e => !baselineEdges.has(e)).map(parseEdge);
  const removedEdges = [...baselineEdges].filter(e => !currentEdges.has(e)).map(parseEdge);

  return { addedNodes, removedNodes, addedEdges, removedEdges };
}

export function registerGraphDiffTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_graph_diff',
    {
      name: 'ctx_graph_diff',
      description:
        'Compare two named graph snapshots and report structural changes: ' +
        'added/removed nodes (files) and added/removed edges (import relationships).',
      inputSchema: {
        type: 'object',
        properties: {
          baseline: {
            type: 'string',
            description: 'Name of the baseline snapshot (the "before" state).',
          },
          current: {
            type: 'string',
            description: 'Name of the current snapshot (the "after" state).',
          },
        },
        required: ['baseline', 'current'],
      },
    },
    async (args: unknown) => {
      const { baseline, current } = schema.parse(args);

      let diff: GraphDiffResult;
      try {
        diff = diffSnapshots(baseline, current, ctx.projectRoot);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `<ctx_graph_diff error="${msg}" />`;
      }

      const totalChanges =
        diff.addedNodes.length + diff.removedNodes.length +
        diff.addedEdges.length + diff.removedEdges.length;

      const lines: string[] = [
        `<ctx_graph_diff baseline="${baseline}" current="${current}"`,
        ` added_nodes="${diff.addedNodes.length}" removed_nodes="${diff.removedNodes.length}"`,
        ` added_edges="${diff.addedEdges.length}" removed_edges="${diff.removedEdges.length}"`,
        ` total_changes="${totalChanges}">`,
      ];

      if (diff.addedNodes.length > 0) {
        lines.push('  <added_nodes>');
        for (const n of diff.addedNodes) lines.push(`    <node path="${n}" />`);
        lines.push('  </added_nodes>');
      }

      if (diff.removedNodes.length > 0) {
        lines.push('  <removed_nodes>');
        for (const n of diff.removedNodes) lines.push(`    <node path="${n}" />`);
        lines.push('  </removed_nodes>');
      }

      if (diff.addedEdges.length > 0) {
        lines.push('  <added_edges>');
        for (const e of diff.addedEdges) lines.push(`    <edge from="${e.from}" to="${e.to}" />`);
        lines.push('  </added_edges>');
      }

      if (diff.removedEdges.length > 0) {
        lines.push('  <removed_edges>');
        for (const e of diff.removedEdges) lines.push(`    <edge from="${e.from}" to="${e.to}" />`);
        lines.push('  </removed_edges>');
      }

      if (totalChanges === 0) {
        lines.push('  <message>No structural changes between the two snapshots.</message>');
      }

      lines.push('</ctx_graph_diff>');
      return lines.join('\n');
    },
  );
}
