/**
 * graph-snapshot.ts — ctx_graph_snapshot
 *
 * Save the current import graph as a named checkpoint.
 * Checkpoints are written to .ctxloom/snapshots/<name>.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import type { DependencyGraph } from '../graph/DependencyGraph.js';
import { ProjectRootField, PROJECT_ROOT_JSON_SCHEMA } from './projectRootParam.js';

const schema = z.object({
  name: z.string().min(1).max(64).regex(/^[\w.-]+$/, 'Name may only contain letters, digits, dots, underscores, hyphens').describe(
    'Snapshot name (e.g. "before-refactor", "v1.0"). Used as the filename.',
  ),
  overwrite: z.boolean().default(false).describe(
    'If true, overwrite an existing snapshot with the same name.',
  ),
  project_root: ProjectRootField,
});

export interface SnapshotData {
  name: string;
  savedAt: number;
  nodeCount: number;
  edgeCount: number;
  forwardEdges: Record<string, string[]>;
}

/** Save the current graph as a named snapshot. Exported for testing. */
export function saveNamedSnapshot(
  graph: DependencyGraph,
  name: string,
  rootDir: string,
  overwrite = false,
): void {
  const snapshotsDir = path.resolve(rootDir, '.ctxloom', 'snapshots');
  fs.mkdirSync(snapshotsDir, { recursive: true });

  const snapshotPath = path.resolve(snapshotsDir, `${name}.json`);
  if (!snapshotPath.startsWith(snapshotsDir + path.sep)) {
    throw new Error(`Invalid snapshot name: "${name}"`);
  }
  if (fs.existsSync(snapshotPath) && !overwrite) {
    throw new Error(`Snapshot "${name}" already exists. Pass overwrite: true to replace it.`);
  }

  const files = graph.allFiles();
  const forwardEdges: Record<string, string[]> = {};
  for (const f of files) {
    forwardEdges[f] = graph.getImports(f);
  }

  const data: SnapshotData = {
    name,
    savedAt: Date.now(),
    nodeCount: files.length,
    edgeCount: graph.edgeCount(),
    forwardEdges,
  };

  // Per-PID suffix avoids races when multiple ctxloom MCP servers run
  // against the same repo (e.g. multiple Claude Code windows open on the
  // same project). rename(2) is atomic, so last-writer-wins on the final
  // file is fine for a snapshot cache.
  const tmp = `${snapshotPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, snapshotPath);
}

/** List saved snapshot names. Exported for testing. */
export function listNamedSnapshots(rootDir: string): string[] {
  const snapshotsDir = path.join(rootDir, '.ctxloom', 'snapshots');
  if (!fs.existsSync(snapshotsDir)) return [];
  return fs.readdirSync(snapshotsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.slice(0, -5))
    .sort();
}

export function registerGraphSnapshotTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_graph_snapshot',
    {
      name: 'ctx_graph_snapshot',
      description:
        'Save the current import graph as a named checkpoint to .ctxloom/snapshots/<name>.json. ' +
        'Use ctx_graph_diff to compare two snapshots.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Snapshot name (e.g. "before-refactor", "v1.0"). Letters, digits, dots, underscores, hyphens only.',
          },
          overwrite: {
            type: 'boolean',
            description: 'If true, overwrite an existing snapshot with the same name. Default: false.',
          },
          project_root: PROJECT_ROOT_JSON_SCHEMA,
        },
        required: ['name'],
      },
    },
    async (args: unknown) => {
      const { name, overwrite, project_root } = schema.parse(args);
      const graph = await ctx.getGraph(project_root);

      try {
        saveNamedSnapshot(graph, name, ctx.projectRoot, overwrite);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `<ctx_graph_snapshot error="${msg}" />`;
      }

      const files = graph.allFiles();
      const saved = listNamedSnapshots(ctx.projectRoot);

      return [
        `<ctx_graph_snapshot name="${name}" saved_at="${new Date().toISOString()}"`,
        ` node_count="${files.length}" edge_count="${graph.edgeCount()}">`,
        `  <message>Snapshot "${name}" saved to .ctxloom/snapshots/${name}.json</message>`,
        `  <available_snapshots count="${saved.length}">`,
        ...saved.map(s => `    <snapshot name="${s}" />`),
        `  </available_snapshots>`,
        `</ctx_graph_snapshot>`,
      ].join('\n');
    },
  );
}
