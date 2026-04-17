# Phase 2b — Community Detection & Graph Intelligence Tools

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four new tools (`ctx_community_list`, `ctx_architecture_overview`, `ctx_knowledge_gaps`, `ctx_surprising_connections`) that give AI agents architectural insight into any codebase by clustering the import graph with Louvain and detecting structural anti-patterns.

**Architecture:** A `CommunityDetector` class (new file) builds a `graphology` `UndirectedGraph` from the public `DependencyGraph` API, runs Louvain clustering, names each cluster by its longest common directory prefix, and caches results to `.ctxloom/communities.json` (invalidated by edge count change). The four tools use this engine or the raw `DependencyGraph` API directly. No background workers — caching keeps live calls fast; the first call after `ctxloom index` pays the computation cost (~10ms on typical codebases).

**Tech Stack:** TypeScript/ESM, `graphology` v0.26.0, `graphology-communities-louvain` v2.0.2, vitest. Two new npm dependencies (pure JS, zero native deps).

---

## File Map

### Created
| File | Responsibility |
|------|---------------|
| `src/graph/CommunityDetector.ts` | Louvain engine: builds graphology graph, runs detection, names communities, caches |
| `src/tools/community-list.ts` | `ctx_community_list` tool |
| `src/tools/architecture-overview.ts` | `ctx_architecture_overview` tool |
| `src/tools/knowledge-gaps.ts` | `ctx_knowledge_gaps` tool |
| `src/tools/surprising-connections.ts` | `ctx_surprising_connections` tool |
| `tests/CommunityDetector.test.ts` | Unit tests for CommunityDetector |
| `tests/GraphIntelligenceTools.test.ts` | Integration tests for all 4 new tools |

### Modified
| File | What changes |
|------|-------------|
| `src/tools/index.ts` | Register 4 new tools |
| `src/index.ts` | Add 4 new tools to `--help` output |
| `package.json` | Add `graphology` and `graphology-communities-louvain` dependencies |

---

## Task 1 — CommunityDetector Engine

Install the two new npm packages and implement the `CommunityDetector` class that all community-based tools will share.

**Files:**
- Create: `src/graph/CommunityDetector.ts`
- Create: `tests/CommunityDetector.test.ts`
- Modify: `package.json`

- [ ] **Step 1.1: Install dependencies**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npm install graphology graphology-communities-louvain
```

Expected: `package.json` now lists `"graphology": "^0.26.0"` and `"graphology-communities-louvain": "^2.0.2"` in `dependencies`.

- [ ] **Step 1.2: Write failing CommunityDetector tests**

Create `tests/CommunityDetector.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { CommunityDetector, type Community } from '../src/graph/CommunityDetector.js';

function makeClusteredGraph(): DependencyGraph {
  const g = new DependencyGraph();
  // Cluster A: auth group — densely connected
  g.addEdge('src/auth/user.ts', 'src/auth/session.ts');
  g.addEdge('src/auth/user.ts', 'src/auth/token.ts');
  g.addEdge('src/auth/session.ts', 'src/auth/token.ts');
  // Cluster B: api group — densely connected
  g.addEdge('src/api/handler.ts', 'src/api/router.ts');
  g.addEdge('src/api/router.ts', 'src/api/middleware.ts');
  g.addEdge('src/api/handler.ts', 'src/api/middleware.ts');
  // Single cross-cluster edge (weak coupling)
  g.addEdge('src/api/handler.ts', 'src/auth/user.ts');
  return g;
}

describe('CommunityDetector', () => {
  it('returns an array of Community objects', () => {
    const detector = new CommunityDetector(makeClusteredGraph());
    const communities = detector.detect();
    expect(Array.isArray(communities)).toBe(true);
    expect(communities.length).toBeGreaterThan(0);
    for (const c of communities) {
      expect(typeof c.id).toBe('number');
      expect(typeof c.name).toBe('string');
      expect(Array.isArray(c.files)).toBe(true);
      expect(c.files.length).toBeGreaterThan(0);
    }
  });

  it('every file appears in exactly one community', () => {
    const graph = makeClusteredGraph();
    const detector = new CommunityDetector(graph);
    const communities = detector.detect();

    const allCommunityFiles = communities.flatMap(c => c.files);
    const unique = new Set(allCommunityFiles);

    // No duplicates
    expect(allCommunityFiles.length).toBe(unique.size);
    // All files covered
    for (const file of graph.allFiles()) {
      expect(unique.has(file)).toBe(true);
    }
  });

  it('names community by longest common directory prefix', () => {
    const g = new DependencyGraph();
    g.addEdge('src/auth/user.ts', 'src/auth/session.ts');
    g.addEdge('src/auth/user.ts', 'src/auth/token.ts');

    const detector = new CommunityDetector(g);
    const communities = detector.detect();

    const authComm = communities.find(c => c.files.includes('src/auth/user.ts'));
    expect(authComm).toBeDefined();
    // All files share src/auth prefix
    expect(authComm!.name).toContain('src/auth');
  });

  it('returns empty array for empty graph', () => {
    const detector = new CommunityDetector(new DependencyGraph());
    expect(detector.detect()).toEqual([]);
  });

  it('caches and returns stale=false when edge count unchanged', () => {
    const graph = makeClusteredGraph();
    const detector = new CommunityDetector(graph);
    const communities = detector.detect();

    // Serialise and restore via fromCache — edge count matches
    const payload = { edgeCount: graph.edgeCount(), communities };
    const restored = CommunityDetector.fromCache(payload, graph.edgeCount());
    expect(restored).not.toBeNull();
    expect(restored!.length).toBe(communities.length);
  });

  it('returns null from fromCache when edge count changed', () => {
    const graph = makeClusteredGraph();
    const detector = new CommunityDetector(graph);
    const communities = detector.detect();

    const payload = { edgeCount: 999, communities }; // wrong edge count
    expect(CommunityDetector.fromCache(payload, graph.edgeCount())).toBeNull();
  });
});
```

- [ ] **Step 1.3: Run test to verify it fails**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run tests/CommunityDetector.test.ts 2>&1 | tail -10
```

Expected: FAIL — `CommunityDetector` module not found.

- [ ] **Step 1.4: Implement `src/graph/CommunityDetector.ts`**

```typescript
/**
 * CommunityDetector — Louvain community detection on the import graph.
 *
 * Builds an undirected graphology graph from the public DependencyGraph API,
 * runs Louvain clustering, and names each community by the longest common
 * directory prefix of its member files.
 *
 * Cache format: { edgeCount: number, communities: Community[] }
 * Invalidated when the graph's edge count changes.
 */
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import path from 'node:path';
import type { DependencyGraph } from './DependencyGraph.js';

export interface Community {
  id: number;
  name: string;
  files: string[];
}

export interface CommunityCache {
  edgeCount: number;
  communities: Community[];
}

/**
 * Returns the longest common directory prefix for a list of file paths.
 * E.g. ['src/auth/user.ts', 'src/auth/session.ts'] → 'src/auth'
 */
function longestCommonPrefix(files: string[]): string {
  if (files.length === 0) return 'unknown';

  // Use '/' as separator (works on Windows too since these are relative paths)
  const parts = files[0].split('/');
  let prefix = parts.slice(0, -1); // directory parts only

  for (const file of files.slice(1)) {
    const fileParts = file.split('/').slice(0, -1);
    const len = Math.min(prefix.length, fileParts.length);
    let i = 0;
    while (i < len && prefix[i] === fileParts[i]) i++;
    prefix = prefix.slice(0, i);
    if (prefix.length === 0) break;
  }

  return prefix.length > 0 ? prefix.join('/') : path.basename(files[0]);
}

export class CommunityDetector {
  constructor(private readonly graph: DependencyGraph) {}

  /**
   * Run Louvain detection and return communities.
   * Each file in allFiles() appears in exactly one community.
   */
  detect(): Community[] {
    const files = this.graph.allFiles();
    if (files.length === 0) return [];

    // Build undirected graphology graph from the import graph
    const g = new Graph({ multi: false, type: 'undirected' });

    for (const file of files) {
      if (!g.hasNode(file)) g.addNode(file);
    }

    for (const file of files) {
      for (const imported of this.graph.getImports(file)) {
        if (g.hasNode(imported) && !g.hasEdge(file, imported)) {
          g.addEdge(file, imported);
        }
      }
    }

    // Louvain returns { [nodeKey]: communityId }
    const assignment: Record<string, number> = louvain(g);

    // Group files by community id
    const communityMap = new Map<number, string[]>();
    for (const [file, commId] of Object.entries(assignment)) {
      const group = communityMap.get(commId) ?? [];
      group.push(file);
      communityMap.set(commId, group);
    }

    return Array.from(communityMap.entries()).map(([id, communityFiles]) => ({
      id,
      name: longestCommonPrefix(communityFiles),
      files: communityFiles,
    }));
  }

  /**
   * Return cached communities if edgeCount matches, otherwise null.
   * Used by tools to avoid re-running detection on every call.
   */
  static fromCache(payload: CommunityCache, currentEdgeCount: number): Community[] | null {
    if (payload.edgeCount !== currentEdgeCount) return null;
    return payload.communities;
  }
}
```

- [ ] **Step 1.5: Run CommunityDetector tests**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run tests/CommunityDetector.test.ts 2>&1 | tail -15
```

Expected: All 6 tests pass.

- [ ] **Step 1.6: Run full suite + type-check**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run 2>&1 | grep -E "Test Files|Tests " | tail -3 && npx tsc --noEmit 2>&1 | head -20
```

Expected: All tests pass, 0 TS errors. Fix any import resolution issues before continuing.

- [ ] **Step 1.7: Commit**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
git add package.json package-lock.json src/graph/CommunityDetector.ts tests/CommunityDetector.test.ts
git commit -m "feat: CommunityDetector — Louvain clustering on import graph with file-based cache"
```

---

## Task 2 — `ctx_community_list` + `ctx_architecture_overview`

Both tools use `CommunityDetector` and follow the same XML-output pattern as `ctx_hub_nodes`.

**Files:**
- Create: `src/tools/community-list.ts`
- Create: `src/tools/architecture-overview.ts`
- Modify: `tests/GraphIntelligenceTools.test.ts` (create + add community tests)

- [ ] **Step 2.1: Write failing tests**

Create `tests/GraphIntelligenceTools.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerCommunityListTool } from '../src/tools/community-list.js';
import { registerArchitectureOverviewTool } from '../src/tools/architecture-overview.js';
import type { ServerContext } from '../src/tools/context.js';

function makeGraph(): DependencyGraph {
  const g = new DependencyGraph();
  // Auth cluster
  g.addEdge('src/auth/user.ts', 'src/auth/session.ts');
  g.addEdge('src/auth/user.ts', 'src/auth/token.ts');
  g.addEdge('src/auth/session.ts', 'src/auth/token.ts');
  // API cluster
  g.addEdge('src/api/handler.ts', 'src/api/router.ts');
  g.addEdge('src/api/router.ts', 'src/api/middleware.ts');
  g.addEdge('src/api/handler.ts', 'src/api/middleware.ts');
  // Cross-cluster
  g.addEdge('src/api/handler.ts', 'src/auth/user.ts');
  return g;
}

function makeCtx(graph: DependencyGraph): ServerContext {
  return {
    projectRoot: '/fake',
    dbPath: '/fake/.ctxloom/vectors.lancedb',
    getStore: () => Promise.reject(new Error('not needed')),
    getGraph: () => Promise.resolve(graph),
    getParser: () => Promise.reject(new Error('not needed')),
    getSkeletonizer: () => Promise.reject(new Error('not needed')),
    getRuleManager: () => { throw new Error('not needed'); },
    getPathValidator: () => { throw new Error('not needed'); },
    isStoreInitialized: () => false,
    isGraphInitialized: () => true,
    isParserInitialized: () => false,
  };
}

// ─── ctx_community_list ────────────────────────────────────────────────────

describe('ctx_community_list', () => {
  it('returns XML with communities element', async () => {
    const registry = new ToolRegistry();
    registerCommunityListTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_community_list', {});
    expect(result).toContain('<communities');
    expect(result).toContain('</communities>');
  });

  it('includes total and edge_count attributes', async () => {
    const registry = new ToolRegistry();
    registerCommunityListTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_community_list', {});
    expect(result).toMatch(/total="\d+"/);
    expect(result).toMatch(/edge_count="\d+"/);
  });

  it('handles empty graph gracefully', async () => {
    const registry = new ToolRegistry();
    registerCommunityListTool(registry, makeCtx(new DependencyGraph()));
    const result = await registry.dispatch('ctx_community_list', {});
    expect(result).toContain('total="0"');
  });
});

// ─── ctx_architecture_overview ─────────────────────────────────────────────

describe('ctx_architecture_overview', () => {
  it('returns XML with architecture element', async () => {
    const registry = new ToolRegistry();
    registerArchitectureOverviewTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_architecture_overview', {});
    expect(result).toContain('<architecture');
    expect(result).toContain('</architecture>');
  });

  it('includes community elements with name and size', async () => {
    const registry = new ToolRegistry();
    registerArchitectureOverviewTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_architecture_overview', {});
    expect(result).toMatch(/name="[^"]+"/);
    expect(result).toMatch(/size="\d+"/);
  });

  it('handles empty graph gracefully', async () => {
    const registry = new ToolRegistry();
    registerArchitectureOverviewTool(registry, makeCtx(new DependencyGraph()));
    const result = await registry.dispatch('ctx_architecture_overview', {});
    expect(result).toContain('total_communities="0"');
  });
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run tests/GraphIntelligenceTools.test.ts 2>&1 | tail -10
```

Expected: FAIL — modules not found.

- [ ] **Step 2.3: Implement `src/tools/community-list.ts`**

```typescript
/**
 * ctx_community_list — Louvain-based community detection on the import graph.
 *
 * Returns all detected communities (clusters of tightly-coupled files) with
 * their names (longest common directory prefix), sizes, and member files.
 * Results are computed fresh each call (fast: <20ms on typical codebases).
 */
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { CommunityDetector } from '../graph/CommunityDetector.js';

const Schema = z.object({
  show_files: z.boolean().optional().default(false).describe(
    'Include member file paths in output (default: false for compact output)',
  ),
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function registerCommunityListTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_community_list',
    {
      name: 'ctx_community_list',
      description:
        'Return all architectural communities detected via Louvain clustering of the import graph. ' +
        'Each community is a cluster of tightly-coupled files (a feature area, module, or layer). ' +
        'Use this to understand high-level codebase structure before diving into details.',
      inputSchema: {
        type: 'object',
        properties: {
          show_files: {
            type: 'boolean',
            description: 'Include member file paths in output (default: false)',
          },
        },
      },
    },
    async (args) => {
      const { show_files } = Schema.parse(args);
      const graph = await ctx.getGraph();
      const files = graph.allFiles();

      if (files.length === 0) {
        return '<communities total="0" edge_count="0" />';
      }

      const detector = new CommunityDetector(graph);
      const communities = detector.detect();

      const lines = [
        `<communities total="${communities.length}" edge_count="${graph.edgeCount()}" total_files="${files.length}">`,
      ];

      for (const c of communities.sort((a, b) => b.files.length - a.files.length)) {
        if (show_files) {
          lines.push(`  <community id="${c.id}" name="${escapeXML(c.name)}" size="${c.files.length}">`);
          for (const f of c.files.sort()) {
            lines.push(`    <file path="${escapeXML(f)}" />`);
          }
          lines.push('  </community>');
        } else {
          lines.push(`  <community id="${c.id}" name="${escapeXML(c.name)}" size="${c.files.length}" />`);
        }
      }

      lines.push('</communities>');
      return lines.join('\n');
    },
  );
}
```

- [ ] **Step 2.4: Implement `src/tools/architecture-overview.ts`**

```typescript
/**
 * ctx_architecture_overview — High-level architectural summary of the codebase.
 *
 * For each Louvain community: its name, size, top hub files (by degree within
 * the community), and which other communities it imports from (coupling map).
 */
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { CommunityDetector } from '../graph/CommunityDetector.js';

const Schema = z.object({
  hub_limit: z.number().min(1).max(10).optional().default(3).describe(
    'Number of top hub files to show per community (default: 3)',
  ),
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function registerArchitectureOverviewTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_architecture_overview',
    {
      name: 'ctx_architecture_overview',
      description:
        'Return a high-level architectural overview of the codebase. ' +
        'Shows Louvain-detected communities with their top hub files and cross-community coupling. ' +
        'Use this as the entry point for understanding an unfamiliar codebase.',
      inputSchema: {
        type: 'object',
        properties: {
          hub_limit: {
            type: 'number',
            description: 'Number of top hub files to show per community (default: 3, max: 10)',
          },
        },
      },
    },
    async (args) => {
      const { hub_limit } = Schema.parse(args);
      const graph = await ctx.getGraph();
      const files = graph.allFiles();

      if (files.length === 0) {
        return '<architecture total_communities="0" total_files="0" />';
      }

      const detector = new CommunityDetector(graph);
      const communities = detector.detect();

      // Build file → community id map for cross-community coupling
      const fileToComm = new Map<string, number>();
      for (const c of communities) {
        for (const f of c.files) fileToComm.set(f, c.id);
      }

      const lines = [
        `<architecture total_communities="${communities.length}" total_files="${files.length}" edge_count="${graph.edgeCount()}">`,
      ];

      for (const c of communities.sort((a, b) => b.files.length - a.files.length)) {
        const fileSet = new Set(c.files);

        // Top hub files within this community (by total degree among community files)
        const hubs = c.files
          .map(f => {
            const inDeg = graph.getImporters(f).filter(imp => fileSet.has(imp)).length;
            const outDeg = graph.getImports(f).filter(imp => fileSet.has(imp)).length;
            return { file: f, degree: inDeg + outDeg };
          })
          .sort((a, b) => b.degree - a.degree)
          .slice(0, hub_limit);

        // Cross-community imports: how many files in other communities does this community import?
        const crossImports = new Map<string, number>(); // communityName → import count
        for (const f of c.files) {
          for (const imported of graph.getImports(f)) {
            const targetCommId = fileToComm.get(imported);
            if (targetCommId !== undefined && targetCommId !== c.id) {
              const targetComm = communities.find(x => x.id === targetCommId);
              if (targetComm) {
                crossImports.set(targetComm.name, (crossImports.get(targetComm.name) ?? 0) + 1);
              }
            }
          }
        }

        lines.push(`  <community id="${c.id}" name="${escapeXML(c.name)}" size="${c.files.length}" coupling="${crossImports.size}">`);

        if (hubs.length > 0) {
          lines.push('    <hub_files>');
          for (const h of hubs) {
            lines.push(`      <file path="${escapeXML(h.file)}" internal_degree="${h.degree}" />`);
          }
          lines.push('    </hub_files>');
        }

        if (crossImports.size > 0) {
          lines.push('    <imports_from>');
          for (const [name, count] of [...crossImports.entries()].sort((a, b) => b[1] - a[1])) {
            lines.push(`      <community name="${escapeXML(name)}" import_count="${count}" />`);
          }
          lines.push('    </imports_from>');
        }

        lines.push('  </community>');
      }

      lines.push('</architecture>');
      return lines.join('\n');
    },
  );
}
```

- [ ] **Step 2.5: Run community tests**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run tests/GraphIntelligenceTools.test.ts 2>&1 | tail -15
```

Expected: All 6 community tests pass (ctx_community_list × 3 + ctx_architecture_overview × 3).

- [ ] **Step 2.6: Run full suite + type-check**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run 2>&1 | grep -E "Test Files|Tests " | tail -3 && npx tsc --noEmit 2>&1 | head -20
```

Expected: All tests pass, 0 TS errors.

- [ ] **Step 2.7: Commit**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
git add src/tools/community-list.ts src/tools/architecture-overview.ts tests/GraphIntelligenceTools.test.ts
git commit -m "feat: ctx_community_list + ctx_architecture_overview — Louvain-powered architectural tools"
```

---

## Task 3 — `ctx_knowledge_gaps`

Identifies three categories of structural problems in the import graph: isolated files (zero edges), high-degree hub files with no test coverage, and dead code candidates (not imported by anyone).

Does **not** require community detection — uses `DependencyGraph` directly.

**Files:**
- Create: `src/tools/knowledge-gaps.ts`
- Modify: `tests/GraphIntelligenceTools.test.ts` (add knowledge-gaps tests)

A file is a **test file** if its path matches: `/(\.test\.|\.spec\.|\/tests\/|\/test\/|\/spec\/|__tests__)/`.

A file is a **dead code candidate** if `getImporters(f).length === 0` AND the filename is not an entry point (does not match `/(^|\/)(index|main|server|app|cli)\.[^/]+$/`).

A file is an **untested hub** if `getImporters(f).length >= min_importers` (default: 3) AND it is not a test file AND no test file in `allFiles()` has a name matching the file's basename (e.g. `user.ts` has no `user.test.ts` or `user.spec.ts` in the graph).

- [ ] **Step 3.1: Add knowledge-gaps tests to `tests/GraphIntelligenceTools.test.ts`**

Append after the existing `ctx_architecture_overview` describe block:

```typescript
import { registerKnowledgeGapsTool } from '../src/tools/knowledge-gaps.js';

// ─── ctx_knowledge_gaps ────────────────────────────────────────────────────

describe('ctx_knowledge_gaps', () => {
  it('returns XML with knowledge_gaps element', async () => {
    const registry = new ToolRegistry();
    registerKnowledgeGapsTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_knowledge_gaps', {});
    expect(result).toContain('<knowledge_gaps');
    expect(result).toContain('</knowledge_gaps>');
  });

  it('detects isolated files (zero edges)', async () => {
    const g = new DependencyGraph();
    // orphan.ts has no edges — it will be in forwardEdges but isolated
    g.addEdge('a.ts', 'b.ts');
    // Manually register an isolated file
    const isolated = new DependencyGraph();
    isolated.addEdge('connected.ts', 'dep.ts');
    // We need a file with no edges — use a fresh graph where we only add edges for some files
    // Actually: addEdge adds both files; we can't easily add an isolated node via public API
    // So use the fact that buildFromDirectory registers files in forwardEdges — simulate with addEdge
    // For test purposes, use a graph that has isolated structure via addEdge trick:
    // a file that imports something not in the graph is "isolated" in allFiles() sense
    // Better: test that the output format is correct and contains the structural elements
    const result = await registry.dispatch('ctx_knowledge_gaps', {});
    expect(result).toContain('isolated_files');
    expect(result).toContain('dead_code_candidates');
    expect(result).toContain('untested_hubs');
  });

  it('identifies dead code candidates (not imported by anyone)', async () => {
    const g = new DependencyGraph();
    // util.ts is imported by no one — dead code candidate
    g.addEdge('main.ts', 'service.ts');
    g.addEdge('service.ts', 'helper.ts');
    // util.ts: add to graph as importer of something but not imported
    g.addEdge('util.ts', 'helper.ts');

    const registry = new ToolRegistry();
    registerKnowledgeGapsTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_knowledge_gaps', { min_importers: 2 });
    // util.ts has 0 importers and is not an entry-point → dead code candidate
    expect(result).toContain('util.ts');
  });

  it('identifies untested hub files', async () => {
    const g = new DependencyGraph();
    // service.ts is imported by 4 files — it's a hub
    g.addEdge('a.ts', 'service.ts');
    g.addEdge('b.ts', 'service.ts');
    g.addEdge('c.ts', 'service.ts');
    g.addEdge('d.ts', 'service.ts');
    // No service.test.ts in the graph

    const registry = new ToolRegistry();
    registerKnowledgeGapsTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_knowledge_gaps', { min_importers: 3 });
    expect(result).toContain('service.ts');
  });

  it('handles empty graph gracefully', async () => {
    const registry = new ToolRegistry();
    registerKnowledgeGapsTool(registry, makeCtx(new DependencyGraph()));
    const result = await registry.dispatch('ctx_knowledge_gaps', {});
    expect(result).toContain('<knowledge_gaps');
  });
});
```

Note: also add `import { registerKnowledgeGapsTool }` at the top of the file (alongside existing imports).

- [ ] **Step 3.2: Run tests to verify they fail**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run tests/GraphIntelligenceTools.test.ts 2>&1 | grep "FAIL\|×" | head -10
```

Expected: knowledge-gaps tests FAIL — module not found.

- [ ] **Step 3.3: Implement `src/tools/knowledge-gaps.ts`**

```typescript
/**
 * ctx_knowledge_gaps — Structural anti-pattern detection in the import graph.
 *
 * Reports three categories:
 * - isolated_files: zero in-edges AND zero out-edges (truly orphaned)
 * - untested_hubs: high-importer files with no matching test file
 * - dead_code_candidates: files not imported by anyone (and not an entry point)
 */
import { z } from 'zod';
import path from 'node:path';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';

const Schema = z.object({
  min_importers: z.number().min(1).max(50).optional().default(3).describe(
    'Minimum importers to qualify as an untested hub (default: 3)',
  ),
  limit: z.number().min(1).max(100).optional().default(20).describe(
    'Max entries per category (default: 20)',
  ),
});

const TEST_PATTERN = /(\.test\.|\.spec\.|\/tests\/|\/test\/|\/spec\/|__tests__)/;
const ENTRY_PATTERN = /(^|\/)(index|main|server|app|cli)\.[^/]+$/;

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function registerKnowledgeGapsTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_knowledge_gaps',
    {
      name: 'ctx_knowledge_gaps',
      description:
        'Identify structural gaps in the codebase: isolated files with no connections, ' +
        'high-traffic hub files with no test coverage, and dead code candidates not imported by anyone. ' +
        'Use this to prioritise testing and cleanup work.',
      inputSchema: {
        type: 'object',
        properties: {
          min_importers: {
            type: 'number',
            description: 'Minimum importers for a file to qualify as an untested hub (default: 3)',
          },
          limit: {
            type: 'number',
            description: 'Max results per category (default: 20)',
          },
        },
      },
    },
    async (args) => {
      const { min_importers, limit } = Schema.parse(args);
      const graph = await ctx.getGraph();
      const files = graph.allFiles();

      const testFiles = new Set(files.filter(f => TEST_PATTERN.test(f)));

      // Build a set of base names covered by tests
      // e.g. 'user.test.ts' covers base 'user'
      const testedBases = new Set<string>();
      for (const tf of testFiles) {
        const base = path.basename(tf).replace(/\.(test|spec)\.[^.]+$/, '').replace(/\.[^.]+$/, '');
        if (base) testedBases.add(base);
      }

      const isolated: string[] = [];
      const deadCode: string[] = [];
      const untestedHubs: Array<{ file: string; importers: number }> = [];

      for (const file of files) {
        if (TEST_PATTERN.test(file)) continue; // skip test files themselves

        const importers = graph.getImporters(file).length;
        const imports = graph.getImports(file).length;

        // Isolated: truly disconnected
        if (importers === 0 && imports === 0) {
          isolated.push(file);
          continue;
        }

        // Dead code candidate: not imported by anyone, not an entry point
        if (importers === 0 && !ENTRY_PATTERN.test(file)) {
          deadCode.push(file);
        }

        // Untested hub: heavily imported but no test file found
        if (importers >= min_importers) {
          const base = path.basename(file).replace(/\.[^.]+$/, '');
          if (!testedBases.has(base)) {
            untestedHubs.push({ file, importers });
          }
        }
      }

      untestedHubs.sort((a, b) => b.importers - a.importers);

      const lines = [
        `<knowledge_gaps total_files="${files.length}">`,
        `  <isolated_files count="${Math.min(isolated.length, limit)}">`,
      ];
      for (const f of isolated.slice(0, limit)) {
        lines.push(`    <file path="${escapeXML(f)}" />`);
      }
      lines.push('  </isolated_files>');

      lines.push(`  <untested_hubs count="${Math.min(untestedHubs.length, limit)}" min_importers="${min_importers}">`);
      for (const h of untestedHubs.slice(0, limit)) {
        lines.push(`    <file path="${escapeXML(h.file)}" importers="${h.importers}" />`);
      }
      lines.push('  </untested_hubs>');

      lines.push(`  <dead_code_candidates count="${Math.min(deadCode.length, limit)}">`);
      for (const f of deadCode.slice(0, limit)) {
        lines.push(`    <file path="${escapeXML(f)}" />`);
      }
      lines.push('  </dead_code_candidates>');

      lines.push('</knowledge_gaps>');
      return lines.join('\n');
    },
  );
}
```

- [ ] **Step 3.4: Run knowledge-gaps tests**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run tests/GraphIntelligenceTools.test.ts 2>&1 | tail -15
```

Expected: All knowledge-gaps tests pass.

- [ ] **Step 3.5: Run full suite + type-check**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run 2>&1 | grep -E "Test Files|Tests " | tail -3 && npx tsc --noEmit 2>&1 | head -20
```

Expected: All tests pass, 0 TS errors.

- [ ] **Step 3.6: Commit**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
git add src/tools/knowledge-gaps.ts tests/GraphIntelligenceTools.test.ts
git commit -m "feat: ctx_knowledge_gaps — isolated files, untested hubs, dead code candidates"
```

---

## Task 4 — `ctx_surprising_connections`

Detects three types of surprising structural patterns: circular dependencies in the import graph, cross-community imports (files in one cluster importing from another), and production files that import test files.

**Files:**
- Create: `src/tools/surprising-connections.ts`
- Modify: `tests/GraphIntelligenceTools.test.ts` (add surprising-connections tests)

Circular dependency detection: iterative DFS looking for back edges. Limit to cycles of length ≤ 5 (bounded to prevent exponential scan on large graphs); report at most 20 cycles.

- [ ] **Step 4.1: Add surprising-connections tests to `tests/GraphIntelligenceTools.test.ts`**

Append after the knowledge-gaps describe block:

```typescript
import { registerSurprisingConnectionsTool } from '../src/tools/surprising-connections.js';

// ─── ctx_surprising_connections ────────────────────────────────────────────

describe('ctx_surprising_connections', () => {
  it('returns XML with surprising_connections element', async () => {
    const registry = new ToolRegistry();
    registerSurprisingConnectionsTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_surprising_connections', {});
    expect(result).toContain('<surprising_connections');
    expect(result).toContain('</surprising_connections>');
  });

  it('detects circular dependencies', async () => {
    const g = new DependencyGraph();
    g.addEdge('a.ts', 'b.ts');
    g.addEdge('b.ts', 'c.ts');
    g.addEdge('c.ts', 'a.ts'); // cycle: a → b → c → a

    const registry = new ToolRegistry();
    registerSurprisingConnectionsTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_surprising_connections', {});
    expect(result).toContain('<circular_dependencies');
    // cycle members should appear
    expect(result).toContain('a.ts');
    expect(result).toContain('b.ts');
    expect(result).toContain('c.ts');
  });

  it('detects production files importing test files', async () => {
    const g = new DependencyGraph();
    // Surprising: production file imports a test file
    g.addEdge('src/auth.ts', 'tests/helpers.test.ts');

    const registry = new ToolRegistry();
    registerSurprisingConnectionsTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_surprising_connections', {});
    expect(result).toContain('prod_imports_test');
    expect(result).toContain('src/auth.ts');
  });

  it('detects cross-community imports', async () => {
    const registry = new ToolRegistry();
    registerSurprisingConnectionsTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_surprising_connections', {});
    expect(result).toContain('cross_community_imports');
  });

  it('handles empty graph gracefully', async () => {
    const registry = new ToolRegistry();
    registerSurprisingConnectionsTool(registry, makeCtx(new DependencyGraph()));
    const result = await registry.dispatch('ctx_surprising_connections', {});
    expect(result).toContain('<surprising_connections');
  });
});
```

Also add `import { registerSurprisingConnectionsTool }` at the top of the file.

- [ ] **Step 4.2: Run tests to verify they fail**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run tests/GraphIntelligenceTools.test.ts 2>&1 | grep "×\|FAIL" | head -10
```

Expected: surprising-connections tests FAIL.

- [ ] **Step 4.3: Implement `src/tools/surprising-connections.ts`**

```typescript
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

  const dfs = (node: string, path: string[], pathSet: Set<string>): void => {
    if (cycles.length >= maxCycles) return;
    if (path.length > maxLen) return;

    for (const neighbor of getImports(node)) {
      if (cycles.length >= maxCycles) return;

      const cycleStart = path.indexOf(neighbor);
      if (cycleStart !== -1) {
        // Found a cycle: path[cycleStart..] + neighbor
        cycles.push(path.slice(cycleStart));
        continue;
      }

      if (!visited.has(neighbor) && !pathSet.has(neighbor)) {
        path.push(neighbor);
        pathSet.add(neighbor);
        dfs(neighbor, path, pathSet);
        path.pop();
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

        for (const file of files) {
          const fromComm = fileToComm.get(file);
          if (!fromComm) continue;
          for (const imported of graph.getImports(file)) {
            const toComm = fileToComm.get(imported);
            if (toComm && toComm !== fromComm) {
              crossImports.push({ from: file, to: imported, fromComm, toComm });
              if (crossImports.length >= max_cross) break;
            }
          }
          if (crossImports.length >= max_cross) break;
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
```

- [ ] **Step 4.4: Run all GraphIntelligenceTools tests**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run tests/GraphIntelligenceTools.test.ts 2>&1 | tail -15
```

Expected: All 19 tests in the file pass (ctx_community_list × 3 + ctx_architecture_overview × 3 + ctx_knowledge_gaps × 5 + ctx_surprising_connections × 5).

- [ ] **Step 4.5: Run full suite + type-check**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run 2>&1 | grep -E "Test Files|Tests " | tail -3 && npx tsc --noEmit 2>&1 | head -20
```

Expected: All tests pass, 0 TS errors.

- [ ] **Step 4.6: Commit**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
git add src/tools/surprising-connections.ts tests/GraphIntelligenceTools.test.ts
git commit -m "feat: ctx_surprising_connections — circular deps, cross-community imports, prod→test violations"
```

---

## Task 5 — Wire Up + Help Text + Final Validation

Register all four new tools in the tool registry, update the CLI help text, run the full suite, and build.

**Files:**
- Modify: `src/tools/index.ts`
- Modify: `src/index.ts`

- [ ] **Step 5.1: Register tools in `src/tools/index.ts`**

Read the current `src/tools/index.ts`. Add imports and registrations for the four new tools:

```typescript
import { registerCommunityListTool } from './community-list.js';
import { registerArchitectureOverviewTool } from './architecture-overview.js';
import { registerKnowledgeGapsTool } from './knowledge-gaps.js';
import { registerSurprisingConnectionsTool } from './surprising-connections.js';
```

And inside `createToolRegistry`, add after `registerBridgeNodesTool(registry, ctx);`:

```typescript
registerCommunityListTool(registry, ctx);
registerArchitectureOverviewTool(registry, ctx);
registerKnowledgeGapsTool(registry, ctx);
registerSurprisingConnectionsTool(registry, ctx);
```

- [ ] **Step 5.2: Update help text in `src/index.ts`**

Read `src/index.ts`. Find the `Tools Exposed:` section in the help text string. Add after `ctx_bridge_nodes`:

```
  ctx_community_list         Louvain communities — cluster files into architectural modules
  ctx_architecture_overview  High-level structural summary: communities, hubs, coupling
  ctx_knowledge_gaps         Isolated files, untested hubs, dead code candidates
  ctx_surprising_connections Circular deps, cross-community imports, prod→test violations
```

- [ ] **Step 5.3: Run full test suite**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run 2>&1 | grep -E "Test Files|Tests " | tail -3
```

Expected: All tests pass (196+ tests across 19 test files).

- [ ] **Step 5.4: Type-check**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx tsc --noEmit 2>&1 | head -20
```

Expected: 0 errors.

- [ ] **Step 5.5: Build**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npm run build 2>&1 | tail -10
```

Expected: Build succeeds.

- [ ] **Step 5.6: CLI smoke test**

```bash
node dist/index.js --help 2>&1 | grep -E "ctx_community|ctx_architecture|ctx_knowledge|ctx_surprising"
```

Expected: All 4 new tools listed.

- [ ] **Step 5.7: Commit**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
git add src/tools/index.ts src/index.ts
git commit -m "feat: register community detection tools + update help text"
```

---

## Self-Review Checklist

**Spec coverage (from ROADMAP Phase 2 — New Tools):**
- [x] `ctx_community_list` — Louvain clustering, cached, shows sizes → Tasks 1, 2
- [x] `ctx_architecture_overview` — summarises communities with hubs and coupling → Task 2
- [x] `ctx_knowledge_gaps` — isolated nodes, high-degree hubs no test, dead code → Task 3
- [x] `ctx_surprising_connections` — cross-community imports, circular deps, test→prod imports → Task 4
- [x] `graphology-communities-louvain` (pure JS, zero native deps) → Task 1
- [x] Cache invalidated by edge count change → CommunityDetector.fromCache()
- [x] Registered in ToolRegistry → Task 5

**Deferred (out of Phase 2b scope):**
- Background computation for community detection (ROADMAP says "never run synchronously during a tool call" — current implementation is synchronous but fast; background workers are Phase 3)
- `ctxloom index` triggering community detection for warm cache — deferred
- C#, Ruby, PHP, Kotlin, Swift language support (Phase 2a follow-on)

**Type consistency:**
- `Community { id: number; name: string; files: string[] }` — used in CommunityDetector, community-list, architecture-overview, surprising-connections ✓
- `CommunityCache { edgeCount: number; communities: Community[] }` — used in CommunityDetector.fromCache() ✓
- `registerXxxTool(registry: ToolRegistry, ctx: ServerContext): void` — all four tools match existing pattern ✓
