# Web Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web dashboard (`apps/dashboard/`) that visualises ctxloom's graph, risk, churn, ownership, and community data via a local Express API + React SPA — distributed as a paid addon.

**Architecture:** An Express server hydrates `DependencyGraph` and `GitOverlayStore` from the existing `.ctxloom/` snapshot files (no re-indexing needed), then exposes REST endpoints. A Vite-built React SPA consumes those endpoints and renders five views: Overview, Graph, Risk, Communities, and Ownership. A new `ctxloom dashboard` CLI command starts the server and opens the browser.

**Tech Stack:** Node 20+, TypeScript ESM (NodeNext), Express 4, React 18, Vite 5, Tailwind CSS 3, D3.js v7, Recharts 2, React Router v6, Vitest, React Testing Library.

**Branch:** `feat/web-dashboard`

**Monorepo:** `apps/dashboard/` — follows the same pattern as `apps/pr-bot/`.

---

## Codebase Context (read before starting)

### Key source files
| File | What it does |
|------|-------------|
| `src/graph/DependencyGraph.ts` | Bidirectional import graph. Call `buildFromDirectory(root)` or hydrate from snapshot via `loadSnapshot()` (private — use `buildFromDirectory` which auto-loads snapshot). Key methods: `allFiles()`, `getImports(file)`, `getImporters(file)`, `edgeCount()`. |
| `src/git/GitOverlayStore.ts` | Loads `.ctxloom/git-overlay.json` sidecar via `loadSnapshot(): Promise<boolean>`. Exposes `.coChange`, `.churn`, `.ownership`. |
| `src/git/ChurnIndex.ts` | `statsFor(file)` → `ChurnStats \| null` with `{ totalLines, buckets, commitCount }`. |
| `src/git/OwnershipIndex.ts` | `statsFor(file)` → `OwnershipStats \| null` with `{ owners: [{author, share}] }`. |
| `src/git/CoChangeIndex.ts` | `topFor({ node, limit, minConfidence })` → coupled files list. |
| `src/graph/CommunityDetector.ts` | `new CommunityDetector(graph).detect()` → `Array<{ id, name, files }>`. |
| `src/lib/analysis.ts` | `detectChanges()` and `getImpactRadius()` pure analysis functions. |

### Existing data files (written by ctxloom after indexing)
- `.ctxloom/graph-snapshot.json` — serialised DependencyGraph
- `.ctxloom/git-overlay.json` — serialised GitOverlayStore sidecar
- `.ctxloom/call-graph-snapshot.json` — call graph data

### Existing app pattern
`apps/pr-bot/` is the reference implementation. Follow the same:
- `package.json` with `"type": "module"`, `"private": true`
- `tsconfig.json` extending `../../tsconfig.json`
- `vitest.config.ts` for tests

---

## File Structure

```
apps/dashboard/
├── package.json
├── tsconfig.json
├── tsconfig.server.json        # server-only build (NodeNext)
├── vite.config.ts              # client build
├── server/
│   ├── index.ts                # Express entry — mounts routes, serves client
│   ├── loader.ts               # hydrate DependencyGraph + GitOverlayStore
│   ├── types.ts                # shared API response types (imported by client too)
│   └── routes/
│       ├── overview.ts         # GET /api/overview
│       ├── graph.ts            # GET /api/graph
│       ├── risk.ts             # GET /api/risk
│       ├── communities.ts      # GET /api/communities
│       ├── churn.ts            # GET /api/churn
│       └── ownership.ts        # GET /api/ownership
├── client/
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx             # React Router setup
│       ├── lib/
│       │   └── api.ts          # typed fetch helpers for each endpoint
│       ├── hooks/
│       │   └── useApi.ts       # generic data fetching hook
│       ├── components/
│       │   ├── Layout.tsx      # sidebar nav + content area
│       │   ├── StatCard.tsx    # metric card (label + value)
│       │   ├── RiskBadge.tsx   # coloured risk label
│       │   └── ErrorBanner.tsx
│       └── pages/
│           ├── Overview.tsx    # stat cards + top hubs + risk donut
│           ├── GraphView.tsx   # D3 force-directed graph
│           ├── RiskTable.tsx   # sortable file risk table
│           ├── Communities.tsx # community cards with file lists
│           └── Ownership.tsx   # files by owner, bus factor warnings
└── tests/
    ├── loader.test.ts
    ├── routes.overview.test.ts
    ├── routes.graph.test.ts
    ├── routes.risk.test.ts
    └── Overview.test.tsx
```

**CLI change (existing file):**
- `src/index.ts` — add `ctxloom dashboard` command that spawns the dashboard server

---

## Task 1: Project Scaffold

**Files:**
- Create: `apps/dashboard/package.json`
- Create: `apps/dashboard/tsconfig.json`
- Create: `apps/dashboard/tsconfig.server.json`
- Create: `apps/dashboard/vite.config.ts`
- Create: `apps/dashboard/client/index.html`

- [ ] **Step 1: Create apps/dashboard/package.json**

```json
{
  "name": "@ctxloom/dashboard",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev:server": "tsx server/index.ts",
    "dev:client": "vite client",
    "build": "tsc -p tsconfig.server.json && vite build client --outDir ../dist/dashboard",
    "test": "vitest run",
    "preview": "vite preview client"
  },
  "dependencies": {
    "express": "^4.18.0",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/d3": "^7.4.0",
    "@vitejs/plugin-react": "^4.3.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.4.0",
    "autoprefixer": "^10.4.0",
    "d3": "^7.9.0",
    "postcss": "^8.4.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.23.0",
    "recharts": "^2.12.0",
    "tailwindcss": "^3.4.0",
    "tsx": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^5.3.0",
    "vitest": "^3.0.0",
    "jsdom": "^24.0.0"
  }
}
```

- [ ] **Step 2: Create apps/dashboard/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "baseUrl": ".",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM"],
    "types": ["node"]
  },
  "include": ["server/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create apps/dashboard/tsconfig.server.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist/server",
    "rootDir": "server"
  },
  "include": ["server/**/*"]
}
```

- [ ] **Step 4: Create apps/dashboard/vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'client',
  build: {
    outDir: '../../dist/dashboard/client',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:7842',
    },
  },
});
```

- [ ] **Step 5: Create apps/dashboard/client/index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ctxloom dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create apps/dashboard/client/src/main.tsx**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
```

- [ ] **Step 7: Create apps/dashboard/client/src/index.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 8: Create apps/dashboard/client/postcss.config.js**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 9: Create apps/dashboard/client/tailwind.config.js**

```js
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

- [ ] **Step 10: Install deps from repo root**

```bash
npm install
```

Expected: no errors. `apps/dashboard` appears in workspace.

- [ ] **Step 11: Commit**

```bash
git add apps/dashboard/package.json apps/dashboard/tsconfig.json apps/dashboard/tsconfig.server.json apps/dashboard/vite.config.ts apps/dashboard/client/index.html apps/dashboard/client/src/main.tsx apps/dashboard/client/src/index.css apps/dashboard/client/postcss.config.js apps/dashboard/client/tailwind.config.js package-lock.json
git commit -m "feat(dashboard): scaffold apps/dashboard workspace"
```

---

## Task 2: Shared API Types

**Files:**
- Create: `apps/dashboard/server/types.ts`

- [ ] **Step 1: Create server/types.ts**

```typescript
// Shared API response types — imported by both server routes and client fetch helpers.

export interface OverviewResponse {
  totalFiles: number;
  totalEdges: number;
  totalCommunities: number;
  risk: { critical: number; high: number; medium: number; low: number };
  topHubs: Array<{ file: string; inDegree: number; outDegree: number; totalDegree: number }>;
  gitEnabled: boolean;
}

export interface GraphNode {
  id: string;
  label: string;
  community: number;
  inDegree: number;
  outDegree: number;
  riskScore: number | null;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface RiskEntry {
  file: string;
  riskScore: number;
  riskLabel: 'low' | 'medium' | 'high';
  churnLines: number;
  bugDensity: number;
  busFactor: number;
  topOwner: string | null;
  couplingFanOut: number;
}

export interface RiskResponse {
  entries: RiskEntry[];
  overallRiskScore: number;
}

export interface Community {
  id: number;
  name: string;
  size: number;
  files: string[];
}

export interface CommunitiesResponse {
  communities: Community[];
  totalFiles: number;
  totalEdges: number;
}

export interface ChurnEntry {
  file: string;
  totalLines: number;
  bucket: 'low' | 'medium' | 'high';
  commitCount: number;
}

export interface ChurnResponse {
  entries: ChurnEntry[];
}

export interface OwnerEntry {
  file: string;
  primaryOwner: string;
  primaryShare: number;
  busFactor: number;
  coOwners: Array<{ author: string; share: number }>;
}

export interface OwnershipResponse {
  entries: OwnerEntry[];
  totalAuthors: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/server/types.ts
git commit -m "feat(dashboard): add shared API response types"
```

---

## Task 3: Loader

The loader hydrates `DependencyGraph` and `GitOverlayStore` from existing `.ctxloom/` snapshots. It does NOT re-index — it reads the cached data.

**Files:**
- Create: `apps/dashboard/server/loader.ts`
- Create: `apps/dashboard/tests/loader.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/tests/loader.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

// Mock the ctxloom modules so tests don't need a real repo
vi.mock('../../src/graph/DependencyGraph.js', () => ({
  DependencyGraph: vi.fn().mockImplementation(() => ({
    buildFromDirectory: vi.fn().mockResolvedValue(undefined),
    allFiles: vi.fn().mockReturnValue(['src/a.ts', 'src/b.ts']),
    edgeCount: vi.fn().mockReturnValue(3),
    getImports: vi.fn().mockReturnValue([]),
    getImporters: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock('../../src/git/GitOverlayStore.js', () => ({
  GitOverlayStore: vi.fn().mockImplementation(() => ({
    loadSnapshot: vi.fn().mockResolvedValue(true),
    churn: { statsFor: vi.fn().mockReturnValue(null) },
    ownership: { statsFor: vi.fn().mockReturnValue(null) },
    coChange: { topFor: vi.fn().mockReturnValue([]) },
  })),
}));

import { loadContext } from '../server/loader.js';

describe('loadContext', () => {
  it('returns graph and overlay for a valid root', async () => {
    const ctx = await loadContext('/fake/root');
    expect(ctx.graph).toBeDefined();
    expect(ctx.overlay).toBeDefined();
    expect(ctx.root).toBe('/fake/root');
  });

  it('sets gitEnabled=false when overlay snapshot is missing', async () => {
    const { GitOverlayStore } = await import('../../src/git/GitOverlayStore.js');
    vi.mocked(GitOverlayStore).mockImplementationOnce(() => ({
      loadSnapshot: vi.fn().mockResolvedValue(false),
      churn: { statsFor: vi.fn().mockReturnValue(null) },
      ownership: { statsFor: vi.fn().mockReturnValue(null) },
      coChange: { topFor: vi.fn().mockReturnValue([]) },
    }) as any);

    const ctx = await loadContext('/fake/root');
    expect(ctx.gitEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/dashboard && npx vitest run tests/loader.test.ts
```

Expected: FAIL — `Cannot find module '../server/loader.js'`

- [ ] **Step 3: Create server/loader.ts**

```typescript
import path from 'node:path';
import { DependencyGraph } from '../../src/graph/DependencyGraph.js';
import { GitOverlayStore } from '../../src/git/GitOverlayStore.js';

export interface DashboardContext {
  root: string;
  graph: DependencyGraph;
  overlay: GitOverlayStore;
  gitEnabled: boolean;
}

export async function loadContext(root: string): Promise<DashboardContext> {
  const absRoot = path.resolve(root);

  const graph = new DependencyGraph();
  await graph.buildFromDirectory(absRoot);

  const overlay = new GitOverlayStore();
  const gitEnabled = await overlay.loadSnapshot(absRoot);

  return { root: absRoot, graph, overlay, gitEnabled };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/dashboard && npx vitest run tests/loader.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/loader.ts apps/dashboard/tests/loader.test.ts
git commit -m "feat(dashboard): add context loader (graph + git overlay hydration)"
```

---

## Task 4: Overview Route

**Files:**
- Create: `apps/dashboard/server/routes/overview.ts`
- Create: `apps/dashboard/tests/routes.overview.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/tests/routes.overview.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildOverviewRouter } from '../server/routes/overview.js';
import type { DashboardContext } from '../server/loader.js';

// supertest: npm install -D supertest @types/supertest (add to package.json devDeps)

const mockCtx: DashboardContext = {
  root: '/fake',
  gitEnabled: true,
  graph: {
    allFiles: () => ['a.ts', 'b.ts', 'c.ts'],
    edgeCount: () => 5,
    getImports: (f: string) => f === 'a.ts' ? ['b.ts'] : [],
    getImporters: (f: string) => f === 'b.ts' ? ['a.ts'] : [],
  } as any,
  overlay: {
    churn: { statsFor: () => null },
    ownership: { statsFor: () => null },
    coChange: { topFor: () => [] },
  } as any,
};

describe('GET /api/overview', () => {
  it('returns overview stats', async () => {
    const app = express();
    app.use('/api/overview', buildOverviewRouter(mockCtx));
    const res = await request(app).get('/api/overview');
    expect(res.status).toBe(200);
    expect(res.body.totalFiles).toBe(3);
    expect(res.body.totalEdges).toBe(5);
    expect(res.body.gitEnabled).toBe(true);
    expect(Array.isArray(res.body.topHubs)).toBe(true);
  });
});
```

> **Note:** Add `supertest` and `@types/supertest` to `apps/dashboard/package.json` devDependencies, then run `npm install` from repo root.

- [ ] **Step 2: Add supertest to package.json devDependencies**

In `apps/dashboard/package.json`, add to `devDependencies`:
```json
"supertest": "^7.0.0",
"@types/supertest": "^6.0.0"
```

Then run:
```bash
npm install
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd apps/dashboard && npx vitest run tests/routes.overview.test.ts
```

Expected: FAIL — `Cannot find module '../server/routes/overview.js'`

- [ ] **Step 4: Create server/routes/overview.ts**

```typescript
import { Router } from 'express';
import { CommunityDetector } from '../../../src/graph/CommunityDetector.js';
import type { DashboardContext } from '../loader.js';
import type { OverviewResponse } from '../types.js';

export function buildOverviewRouter(ctx: DashboardContext): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const { graph, overlay, gitEnabled } = ctx;
    const files = graph.allFiles();

    // Community count
    const detector = new CommunityDetector(graph);
    const communities = files.length > 0 ? detector.detect() : [];

    // Top hubs by total degree
    const hubList = files
      .map(f => ({
        file: f,
        inDegree: graph.getImporters(f).length,
        outDegree: graph.getImports(f).length,
        totalDegree: graph.getImporters(f).length + graph.getImports(f).length,
      }))
      .sort((a, b) => b.totalDegree - a.totalDegree)
      .slice(0, 10);

    // Risk breakdown from churn if git enabled
    const risk = { critical: 0, high: 0, medium: 0, low: 0 };
    if (gitEnabled) {
      for (const f of files) {
        const churn = overlay.churn.statsFor(f);
        if (!churn) { risk.low++; continue; }
        if (churn.totalLines > 1000) risk.critical++;
        else if (churn.totalLines > 500) risk.high++;
        else if (churn.totalLines > 100) risk.medium++;
        else risk.low++;
      }
    }

    const body: OverviewResponse = {
      totalFiles: files.length,
      totalEdges: graph.edgeCount(),
      totalCommunities: communities.length,
      risk,
      topHubs: hubList,
      gitEnabled,
    };

    res.json(body);
  });

  return router;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/dashboard && npx vitest run tests/routes.overview.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/server/routes/overview.ts apps/dashboard/tests/routes.overview.test.ts apps/dashboard/package.json package-lock.json
git commit -m "feat(dashboard): add overview API route"
```

---

## Task 5: Graph Route

**Files:**
- Create: `apps/dashboard/server/routes/graph.ts`
- Create: `apps/dashboard/tests/routes.graph.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/tests/routes.graph.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildGraphRouter } from '../server/routes/graph.js';
import type { DashboardContext } from '../server/loader.js';

const mockCtx: DashboardContext = {
  root: '/fake',
  gitEnabled: false,
  graph: {
    allFiles: () => ['src/a.ts', 'src/b.ts'],
    edgeCount: () => 1,
    getImports: (f: string) => f === 'src/a.ts' ? ['src/b.ts'] : [],
    getImporters: (f: string) => f === 'src/b.ts' ? ['src/a.ts'] : [],
  } as any,
  overlay: {} as any,
};

describe('GET /api/graph', () => {
  it('returns nodes and edges', async () => {
    const app = express();
    app.use('/api/graph', buildGraphRouter(mockCtx));
    const res = await request(app).get('/api/graph');
    expect(res.status).toBe(200);
    expect(res.body.nodes).toHaveLength(2);
    expect(res.body.edges).toHaveLength(1);
    expect(res.body.edges[0]).toMatchObject({ source: 'src/a.ts', target: 'src/b.ts' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/dashboard && npx vitest run tests/routes.graph.test.ts
```

Expected: FAIL

- [ ] **Step 3: Create server/routes/graph.ts**

```typescript
import { Router } from 'express';
import { CommunityDetector } from '../../../src/graph/CommunityDetector.js';
import type { DashboardContext } from '../loader.js';
import type { GraphResponse, GraphNode, GraphEdge } from '../types.js';

export function buildGraphRouter(ctx: DashboardContext): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const { graph, overlay, gitEnabled } = ctx;
    const files = graph.allFiles();

    // Assign community IDs
    const communityMap = new Map<string, number>();
    if (files.length > 0) {
      const detector = new CommunityDetector(graph);
      const communities = detector.detect();
      for (const c of communities) {
        for (const f of c.files) communityMap.set(f, c.id);
      }
    }

    const nodes: GraphNode[] = files.map(f => {
      const churn = gitEnabled ? overlay.churn.statsFor(f) : null;
      const riskScore = churn
        ? Math.min(1, churn.totalLines / 1000)
        : null;
      return {
        id: f,
        label: f.split('/').pop() ?? f,
        community: communityMap.get(f) ?? 0,
        inDegree: graph.getImporters(f).length,
        outDegree: graph.getImports(f).length,
        riskScore,
      };
    });

    const edgeSet = new Set<string>();
    const edges: GraphEdge[] = [];
    for (const f of files) {
      for (const imp of graph.getImports(f)) {
        const key = `${f}→${imp}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ source: f, target: imp });
        }
      }
    }

    const body: GraphResponse = { nodes, edges };
    res.json(body);
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/dashboard && npx vitest run tests/routes.graph.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/routes/graph.ts apps/dashboard/tests/routes.graph.test.ts
git commit -m "feat(dashboard): add graph API route"
```

---

## Task 6: Risk, Communities, Churn, Ownership Routes

**Files:**
- Create: `apps/dashboard/server/routes/risk.ts`
- Create: `apps/dashboard/server/routes/communities.ts`
- Create: `apps/dashboard/server/routes/churn.ts`
- Create: `apps/dashboard/server/routes/ownership.ts`
- Create: `apps/dashboard/tests/routes.risk.test.ts`

- [ ] **Step 1: Create server/routes/risk.ts**

```typescript
import { Router } from 'express';
import type { DashboardContext } from '../loader.js';
import type { RiskResponse, RiskEntry } from '../types.js';

function computeRiskScore(churnLines: number, bugDensity: number, busFactor: number, couplingFanOut: number): number {
  const churnPart = Math.min(1, churnLines / 1000);
  const bugPart = Math.min(1, bugDensity * 2);
  const busPart = busFactor <= 1 ? 1 : busFactor <= 2 ? 0.5 : 0;
  const couplingPart = Math.min(1, couplingFanOut / 10);
  return (churnPart * 0.3 + bugPart * 0.3 + busPart * 0.2 + couplingPart * 0.2);
}

function riskLabel(score: number): 'low' | 'medium' | 'high' {
  if (score >= 0.66) return 'high';
  if (score >= 0.33) return 'medium';
  return 'low';
}

export function buildRiskRouter(ctx: DashboardContext): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const { graph, overlay, gitEnabled } = ctx;
    const files = graph.allFiles();

    if (!gitEnabled) {
      const body: RiskResponse = { entries: [], overallRiskScore: 0 };
      return res.json(body);
    }

    const entries: RiskEntry[] = files.map(f => {
      const churn = overlay.churn.statsFor(f);
      const ownership = overlay.ownership.statsFor(f);
      const coupled = overlay.coChange.topFor({ node: f, limit: 100, minConfidence: 0.1 });

      const churnLines = churn?.totalLines ?? 0;
      const bugDensity = 0; // future: parse commit messages for fix/bug
      const busFactor = ownership?.owners?.length ?? 1;
      const topOwner = ownership?.owners?.[0]?.author ?? null;
      const couplingFanOut = coupled.length;
      const riskScore = computeRiskScore(churnLines, bugDensity, busFactor, couplingFanOut);

      return {
        file: f,
        riskScore: Math.round(riskScore * 100) / 100,
        riskLabel: riskLabel(riskScore),
        churnLines,
        bugDensity,
        busFactor,
        topOwner,
        couplingFanOut,
      };
    });

    entries.sort((a, b) => b.riskScore - a.riskScore);

    const overallRiskScore = entries.length > 0
      ? Math.round((entries.reduce((s, e) => s + e.riskScore, 0) / entries.length) * 100) / 100
      : 0;

    const body: RiskResponse = { entries, overallRiskScore };
    res.json(body);
  });

  return router;
}
```

- [ ] **Step 2: Create server/routes/communities.ts**

```typescript
import { Router } from 'express';
import { CommunityDetector } from '../../../src/graph/CommunityDetector.js';
import type { DashboardContext } from '../loader.js';
import type { CommunitiesResponse } from '../types.js';

export function buildCommunitiesRouter(ctx: DashboardContext): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const { graph } = ctx;
    const files = graph.allFiles();

    if (files.length === 0) {
      const body: CommunitiesResponse = { communities: [], totalFiles: 0, totalEdges: 0 };
      return res.json(body);
    }

    const detector = new CommunityDetector(graph);
    const raw = detector.detect();
    const communities = raw
      .sort((a, b) => b.files.length - a.files.length)
      .map(c => ({ id: c.id, name: c.name, size: c.files.length, files: c.files }));

    const body: CommunitiesResponse = {
      communities,
      totalFiles: files.length,
      totalEdges: graph.edgeCount(),
    };
    res.json(body);
  });

  return router;
}
```

- [ ] **Step 3: Create server/routes/churn.ts**

```typescript
import { Router } from 'express';
import type { DashboardContext } from '../loader.js';
import type { ChurnResponse, ChurnEntry } from '../types.js';

export function buildChurnRouter(ctx: DashboardContext): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const { graph, overlay, gitEnabled } = ctx;

    if (!gitEnabled) {
      const body: ChurnResponse = { entries: [] };
      return res.json(body);
    }

    const entries: ChurnEntry[] = graph.allFiles()
      .map(f => {
        const stats = overlay.churn.statsFor(f);
        if (!stats) return null;
        const bucket: 'low' | 'medium' | 'high' =
          stats.totalLines > 500 ? 'high' : stats.totalLines > 100 ? 'medium' : 'low';
        return {
          file: f,
          totalLines: stats.totalLines,
          bucket,
          commitCount: stats.commitCount ?? 0,
        };
      })
      .filter((e): e is ChurnEntry => e !== null)
      .sort((a, b) => b.totalLines - a.totalLines);

    res.json({ entries } satisfies ChurnResponse);
  });

  return router;
}
```

- [ ] **Step 4: Create server/routes/ownership.ts**

```typescript
import { Router } from 'express';
import type { DashboardContext } from '../loader.js';
import type { OwnershipResponse, OwnerEntry } from '../types.js';

export function buildOwnershipRouter(ctx: DashboardContext): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const { graph, overlay, gitEnabled } = ctx;

    if (!gitEnabled) {
      const body: OwnershipResponse = { entries: [], totalAuthors: 0 };
      return res.json(body);
    }

    const authorSet = new Set<string>();
    const entries: OwnerEntry[] = graph.allFiles()
      .map(f => {
        const stats = overlay.ownership.statsFor(f);
        if (!stats || !stats.owners?.length) return null;
        const [primary, ...rest] = stats.owners;
        authorSet.add(primary.author);
        rest.forEach(o => authorSet.add(o.author));
        return {
          file: f,
          primaryOwner: primary.author,
          primaryShare: Math.round(primary.share * 100) / 100,
          busFactor: stats.owners.length,
          coOwners: rest.map(o => ({ author: o.author, share: Math.round(o.share * 100) / 100 })),
        };
      })
      .filter((e): e is OwnerEntry => e !== null)
      .sort((a, b) => a.busFactor - b.busFactor);

    res.json({ entries, totalAuthors: authorSet.size } satisfies OwnershipResponse);
  });

  return router;
}
```

- [ ] **Step 5: Write and run risk route test**

Create `apps/dashboard/tests/routes.risk.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildRiskRouter } from '../server/routes/risk.js';
import type { DashboardContext } from '../server/loader.js';

const mockCtx: DashboardContext = {
  root: '/fake',
  gitEnabled: true,
  graph: {
    allFiles: () => ['src/hot.ts', 'src/cold.ts'],
    getImports: () => [],
    getImporters: () => [],
    edgeCount: () => 0,
  } as any,
  overlay: {
    churn: {
      statsFor: (f: string) =>
        f === 'src/hot.ts'
          ? { totalLines: 1200, commitCount: 50 }
          : { totalLines: 10, commitCount: 2 },
    },
    ownership: { statsFor: () => ({ owners: [{ author: 'alice', share: 0.9 }] }) },
    coChange: { topFor: () => [] },
  } as any,
};

describe('GET /api/risk', () => {
  it('returns sorted risk entries', async () => {
    const app = express();
    app.use('/api/risk', buildRiskRouter(mockCtx));
    const res = await request(app).get('/api/risk');
    expect(res.status).toBe(200);
    expect(res.body.entries[0].file).toBe('src/hot.ts');
    expect(res.body.entries[0].riskScore).toBeGreaterThan(res.body.entries[1].riskScore);
  });

  it('returns empty entries when git disabled', async () => {
    const app = express();
    const noGitCtx = { ...mockCtx, gitEnabled: false };
    app.use('/api/risk', buildRiskRouter(noGitCtx));
    const res = await request(app).get('/api/risk');
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(0);
  });
});
```

```bash
cd apps/dashboard && npx vitest run tests/routes.risk.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/server/routes/
git add apps/dashboard/tests/routes.risk.test.ts
git commit -m "feat(dashboard): add risk, communities, churn, ownership API routes"
```

---

## Task 7: Express Server Entry

**Files:**
- Create: `apps/dashboard/server/index.ts`

- [ ] **Step 1: Create server/index.ts**

```typescript
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContext } from './loader.js';
import { buildOverviewRouter } from './routes/overview.js';
import { buildGraphRouter } from './routes/graph.js';
import { buildRiskRouter } from './routes/risk.js';
import { buildCommunitiesRouter } from './routes/communities.js';
import { buildChurnRouter } from './routes/churn.js';
import { buildOwnershipRouter } from './routes/ownership.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function startDashboard(options: {
  root: string;
  port: number;
  open: boolean;
}): Promise<void> {
  const { root, port, open } = options;

  console.log(`ctxloom dashboard — loading context from ${root}...`);
  const ctx = await loadContext(root);
  console.log(`  ${ctx.graph.allFiles().length} files, ${ctx.graph.edgeCount()} edges, git=${ctx.gitEnabled}`);

  const app = express();
  app.use(cors());
  app.use(express.json());

  // API routes
  app.use('/api/overview', buildOverviewRouter(ctx));
  app.use('/api/graph', buildGraphRouter(ctx));
  app.use('/api/risk', buildRiskRouter(ctx));
  app.use('/api/communities', buildCommunitiesRouter(ctx));
  app.use('/api/churn', buildChurnRouter(ctx));
  app.use('/api/ownership', buildOwnershipRouter(ctx));

  // Health check
  app.get('/api/health', (_req, res) => res.json({ ok: true, root, gitEnabled: ctx.gitEnabled }));

  // Serve built client (production)
  const clientDist = path.join(__dirname, '../../dist/dashboard/client');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  app.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`\nctxloom dashboard running at ${url}\n`);
    if (open) {
      // Dynamic import to avoid pulling in open at build time
      import('open').then(m => m.default(url)).catch(() => {});
    }
  });
}

// Allow direct invocation: tsx server/index.ts
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.env.CTXLOOM_ROOT ?? process.cwd();
  const port = Number(process.env.PORT ?? 7842);
  startDashboard({ root, port, open: false });
}
```

- [ ] **Step 2: Add `open` to dependencies in package.json**

In `apps/dashboard/package.json` add to `dependencies`:
```json
"open": "^10.1.0"
```

```bash
npm install
```

- [ ] **Step 3: Smoke test server startup**

```bash
cd apps/dashboard && npx tsx server/index.ts
```

Expected output includes: `ctxloom dashboard — loading context from ...` and `ctxloom dashboard running at http://localhost:7842`

Stop with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/server/index.ts apps/dashboard/package.json package-lock.json
git commit -m "feat(dashboard): add Express server entry with all API routes mounted"
```

---

## Task 8: React Client — App Shell

**Files:**
- Create: `apps/dashboard/client/src/App.tsx`
- Create: `apps/dashboard/client/src/lib/api.ts`
- Create: `apps/dashboard/client/src/hooks/useApi.ts`
- Create: `apps/dashboard/client/src/components/Layout.tsx`
- Create: `apps/dashboard/client/src/components/StatCard.tsx`
- Create: `apps/dashboard/client/src/components/RiskBadge.tsx`
- Create: `apps/dashboard/client/src/components/ErrorBanner.tsx`

- [ ] **Step 1: Create client/src/lib/api.ts**

```typescript
import type {
  OverviewResponse,
  GraphResponse,
  RiskResponse,
  CommunitiesResponse,
  ChurnResponse,
  OwnershipResponse,
} from '../../server/types.js';

const BASE = '/api';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  overview: () => get<OverviewResponse>('/overview'),
  graph: () => get<GraphResponse>('/graph'),
  risk: () => get<RiskResponse>('/risk'),
  communities: () => get<CommunitiesResponse>('/communities'),
  churn: () => get<ChurnResponse>('/churn'),
  ownership: () => get<OwnershipResponse>('/ownership'),
};
```

- [ ] **Step 2: Create client/src/hooks/useApi.ts**

```typescript
import { useState, useEffect } from 'react';

export type ApiState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; message: string };

export function useApi<T>(fetcher: () => Promise<T>): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetcher()
      .then(data => { if (!cancelled) setState({ status: 'success', data }); })
      .catch(err => { if (!cancelled) setState({ status: 'error', message: String(err) }); });
    return () => { cancelled = true; };
  }, []);

  return state;
}
```

- [ ] **Step 3: Create client/src/components/ErrorBanner.tsx**

```tsx
export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md bg-red-50 border border-red-200 p-4 text-red-800 text-sm">
      {message}
    </div>
  );
}
```

- [ ] **Step 4: Create client/src/components/StatCard.tsx**

```tsx
interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
}

export function StatCard({ label, value, sub }: StatCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-gray-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}
```

- [ ] **Step 5: Create client/src/components/RiskBadge.tsx**

```tsx
const COLOURS: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-green-100 text-green-700',
  critical: 'bg-red-200 text-red-900 font-bold',
};

export function RiskBadge({ level }: { level: string }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs ${COLOURS[level] ?? 'bg-gray-100 text-gray-600'}`}>
      {level}
    </span>
  );
}
```

- [ ] **Step 6: Create client/src/components/Layout.tsx**

```tsx
import { NavLink, Outlet } from 'react-router-dom';

const NAV = [
  { to: '/', label: 'Overview' },
  { to: '/graph', label: 'Graph' },
  { to: '/risk', label: 'Risk' },
  { to: '/communities', label: 'Communities' },
  { to: '/ownership', label: 'Ownership' },
];

export function Layout() {
  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-52 shrink-0 border-r border-gray-200 bg-white flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100">
          <span className="text-sm font-semibold text-gray-900">ctxloom</span>
          <span className="ml-1 text-xs text-gray-400">dashboard</span>
        </div>
        <nav className="flex-1 py-4 space-y-1 px-2">
          {NAV.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-gray-100 text-gray-900 font-medium'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 7: Create client/src/App.tsx**

```tsx
import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout.tsx';
import { Overview } from './pages/Overview.tsx';
import { GraphView } from './pages/GraphView.tsx';
import { RiskTable } from './pages/RiskTable.tsx';
import { Communities } from './pages/Communities.tsx';
import { Ownership } from './pages/Ownership.tsx';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="graph" element={<GraphView />} />
        <Route path="risk" element={<RiskTable />} />
        <Route path="communities" element={<Communities />} />
        <Route path="ownership" element={<Ownership />} />
      </Route>
    </Routes>
  );
}
```

- [ ] **Step 8: Create stub pages so the app compiles**

Create `apps/dashboard/client/src/pages/Overview.tsx`:
```tsx
export function Overview() { return <div>Overview</div>; }
```

Create `apps/dashboard/client/src/pages/GraphView.tsx`:
```tsx
export function GraphView() { return <div>Graph</div>; }
```

Create `apps/dashboard/client/src/pages/RiskTable.tsx`:
```tsx
export function RiskTable() { return <div>Risk</div>; }
```

Create `apps/dashboard/client/src/pages/Communities.tsx`:
```tsx
export function Communities() { return <div>Communities</div>; }
```

Create `apps/dashboard/client/src/pages/Ownership.tsx`:
```tsx
export function Ownership() { return <div>Ownership</div>; }
```

- [ ] **Step 9: Verify client builds**

```bash
cd apps/dashboard && npx vite build client --outDir ../dist/dashboard
```

Expected: build completes with no errors.

- [ ] **Step 10: Commit**

```bash
git add apps/dashboard/client/
git commit -m "feat(dashboard): add React client shell — router, layout, shared components"
```

---

## Task 9: Overview Page

**Files:**
- Modify: `apps/dashboard/client/src/pages/Overview.tsx`
- Create: `apps/dashboard/tests/Overview.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/tests/Overview.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { Overview } from '../client/src/pages/Overview.tsx';

vi.mock('../client/src/lib/api.ts', () => ({
  api: {
    overview: vi.fn().mockResolvedValue({
      totalFiles: 42,
      totalEdges: 130,
      totalCommunities: 7,
      risk: { critical: 2, high: 5, medium: 10, low: 25 },
      topHubs: [
        { file: 'src/index.ts', inDegree: 20, outDegree: 5, totalDegree: 25 },
      ],
      gitEnabled: true,
    }),
  },
}));

describe('Overview page', () => {
  it('renders stat cards with data', async () => {
    render(<MemoryRouter><Overview /></MemoryRouter>);
    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(await screen.findByText('130')).toBeInTheDocument();
    expect(await screen.findByText('7')).toBeInTheDocument();
  });
});
```

Add to `apps/dashboard/package.json` under `"test"` script:
```json
"test": "vitest run --environment jsdom"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/dashboard && npx vitest run tests/Overview.test.tsx --environment jsdom
```

Expected: FAIL

- [ ] **Step 3: Implement Overview.tsx**

```tsx
import { useApi } from '../hooks/useApi.ts';
import { api } from '../lib/api.ts';
import { StatCard } from '../components/StatCard.tsx';
import { RiskBadge } from '../components/RiskBadge.tsx';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const RISK_COLOURS: Record<string, string> = {
  critical: '#dc2626',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
};

export function Overview() {
  const state = useApi(api.overview);

  if (state.status === 'loading') return <div className="text-gray-400 text-sm">Loading...</div>;
  if (state.status === 'error') return <ErrorBanner message={state.message} />;

  const { data } = state;
  const riskData = Object.entries(data.risk).map(([name, value]) => ({ name, value }));

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold text-gray-900">Overview</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Files" value={data.totalFiles} />
        <StatCard label="Edges" value={data.totalEdges} />
        <StatCard label="Communities" value={data.totalCommunities} />
        <StatCard label="Git history" value={data.gitEnabled ? 'enabled' : 'disabled'} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Risk breakdown */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-medium text-gray-700 mb-4">Risk breakdown</h2>
          <div className="flex items-center gap-6">
            <ResponsiveContainer width={140} height={140}>
              <PieChart>
                <Pie data={riskData} dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={60}>
                  {riskData.map(entry => (
                    <Cell key={entry.name} fill={RISK_COLOURS[entry.name] ?? '#ccc'} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2">
              {riskData.map(({ name, value }) => (
                <div key={name} className="flex items-center gap-2 text-sm">
                  <RiskBadge level={name} />
                  <span className="text-gray-600">{value} files</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top hubs */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-medium text-gray-700 mb-4">Top architectural hubs</h2>
          <ul className="space-y-2">
            {data.topHubs.slice(0, 8).map(hub => (
              <li key={hub.file} className="flex items-center justify-between text-sm">
                <span className="truncate text-gray-700 max-w-[60%]" title={hub.file}>
                  {hub.file.split('/').pop()}
                </span>
                <span className="text-gray-400 text-xs">
                  ↑{hub.inDegree} ↓{hub.outDegree}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/dashboard && npx vitest run tests/Overview.test.tsx --environment jsdom
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/client/src/pages/Overview.tsx apps/dashboard/tests/Overview.test.tsx
git commit -m "feat(dashboard): implement Overview page with stat cards and risk donut"
```

---

## Task 10: Risk Table Page

**Files:**
- Modify: `apps/dashboard/client/src/pages/RiskTable.tsx`

- [ ] **Step 1: Implement RiskTable.tsx**

```tsx
import { useState } from 'react';
import { useApi } from '../hooks/useApi.ts';
import { api } from '../lib/api.ts';
import { RiskBadge } from '../components/RiskBadge.tsx';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import type { RiskEntry } from '../../../server/types.js';

type SortKey = keyof Pick<RiskEntry, 'riskScore' | 'churnLines' | 'busFactor' | 'couplingFanOut'>;

export function RiskTable() {
  const state = useApi(api.risk);
  const [sort, setSort] = useState<SortKey>('riskScore');
  const [filter, setFilter] = useState('');

  if (state.status === 'loading') return <div className="text-gray-400 text-sm">Loading...</div>;
  if (state.status === 'error') return <ErrorBanner message={state.message} />;

  const { entries, overallRiskScore } = state.data;

  if (entries.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-gray-900">Risk</h1>
        <p className="text-gray-500 text-sm">No git history available. Run <code>ctxloom index --with-git</code> to enable risk analysis.</p>
      </div>
    );
  }

  const filtered = entries
    .filter(e => e.file.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => b[sort] - a[sort]);

  const cols: { key: SortKey; label: string }[] = [
    { key: 'riskScore', label: 'Risk' },
    { key: 'churnLines', label: 'Churn lines' },
    { key: 'busFactor', label: 'Bus factor' },
    { key: 'couplingFanOut', label: 'Coupling' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Risk</h1>
        <span className="text-sm text-gray-400">avg score: {overallRiskScore}</span>
      </div>

      <input
        type="text"
        placeholder="Filter by file..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
        className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-300"
      />

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">File</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Owner</th>
              {cols.map(c => (
                <th
                  key={c.key}
                  onClick={() => setSort(c.key)}
                  className={`px-4 py-3 text-left text-xs font-medium cursor-pointer select-none ${sort === c.key ? 'text-gray-900' : 'text-gray-500'}`}
                >
                  {c.label} {sort === c.key ? '↓' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map(e => (
              <tr key={e.file} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs text-gray-700 max-w-xs truncate" title={e.file}>{e.file}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{e.topOwner ?? '—'}</td>
                <td className="px-4 py-3"><RiskBadge level={e.riskLabel} /></td>
                <td className="px-4 py-3 text-gray-700">{e.churnLines.toLocaleString()}</td>
                <td className="px-4 py-3 text-gray-700">{e.busFactor}</td>
                <td className="px-4 py-3 text-gray-700">{e.couplingFanOut}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/client/src/pages/RiskTable.tsx
git commit -m "feat(dashboard): implement Risk table with sort and filter"
```

---

## Task 11: Dependency Graph Page (D3)

**Files:**
- Modify: `apps/dashboard/client/src/pages/GraphView.tsx`

- [ ] **Step 1: Implement GraphView.tsx**

```tsx
import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { useApi } from '../hooks/useApi.ts';
import { api } from '../lib/api.ts';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import type { GraphNode, GraphEdge } from '../../../server/types.js';

interface SimNode extends GraphNode, d3.SimulationNodeDatum {}
interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  source: SimNode;
  target: SimNode;
}

const COMMUNITY_COLOURS = d3.schemeTableau10;

export function GraphView() {
  const state = useApi(api.graph);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (state.status !== 'success' || !svgRef.current) return;

    const { nodes, edges } = state.data;
    // Limit to top 300 nodes by total degree to keep the graph readable
    const topNodes = [...nodes]
      .sort((a, b) => (b.inDegree + b.outDegree) - (a.inDegree + a.outDegree))
      .slice(0, 300);
    const nodeIds = new Set(topNodes.map(n => n.id));
    const visibleEdges = edges.filter(e => nodeIds.has(e.source as string) && nodeIds.has(e.target as string));

    const el = svgRef.current;
    const width = el.clientWidth || 900;
    const height = el.clientHeight || 600;

    const svg = d3.select(el);
    svg.selectAll('*').remove();

    const g = svg.append('g');

    svg.call(
      d3.zoom<SVGSVGElement, unknown>().on('zoom', e => g.attr('transform', e.transform))
    );

    const simNodes: SimNode[] = topNodes.map(n => ({ ...n }));
    const nodeMap = new Map(simNodes.map(n => [n.id, n]));
    const simLinks: SimLink[] = visibleEdges
      .map(e => ({ source: nodeMap.get(e.source as string)!, target: nodeMap.get(e.target as string)! }))
      .filter(l => l.source && l.target);

    const sim = d3.forceSimulation(simNodes)
      .force('link', d3.forceLink<SimNode, SimLink>(simLinks).id(d => d.id).distance(60))
      .force('charge', d3.forceManyBody().strength(-120))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide(8));

    const link = g.append('g')
      .selectAll('line')
      .data(simLinks)
      .join('line')
      .attr('stroke', '#d1d5db')
      .attr('stroke-width', 0.8)
      .attr('stroke-opacity', 0.6);

    const node = g.append('g')
      .selectAll('circle')
      .data(simNodes)
      .join('circle')
      .attr('r', d => 3 + Math.min(10, (d.inDegree + d.outDegree) * 0.5))
      .attr('fill', d => COMMUNITY_COLOURS[d.community % COMMUNITY_COLOURS.length])
      .attr('stroke', '#fff')
      .attr('stroke-width', 1)
      .call(
        d3.drag<SVGCircleElement, SimNode>()
          .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
          .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
          .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
      );

    node.append('title').text(d => d.id);

    sim.on('tick', () => {
      link
        .attr('x1', d => d.source.x ?? 0)
        .attr('y1', d => d.source.y ?? 0)
        .attr('x2', d => d.target.x ?? 0)
        .attr('y2', d => d.target.y ?? 0);
      node
        .attr('cx', d => d.x ?? 0)
        .attr('cy', d => d.y ?? 0);
    });

    return () => { sim.stop(); };
  }, [state]);

  if (state.status === 'loading') return <div className="text-gray-400 text-sm">Building graph...</div>;
  if (state.status === 'error') return <ErrorBanner message={state.message} />;

  return (
    <div className="space-y-4 h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Dependency Graph</h1>
        <span className="text-xs text-gray-400">{state.data.nodes.length} nodes · {state.data.edges.length} edges · scroll to zoom · drag to pan</span>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm" style={{ height: 'calc(100vh - 160px)' }}>
        <svg ref={svgRef} width="100%" height="100%" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/client/src/pages/GraphView.tsx
git commit -m "feat(dashboard): implement D3 force-directed dependency graph"
```

---

## Task 12: Communities and Ownership Pages

**Files:**
- Modify: `apps/dashboard/client/src/pages/Communities.tsx`
- Modify: `apps/dashboard/client/src/pages/Ownership.tsx`

- [ ] **Step 1: Implement Communities.tsx**

```tsx
import { useState } from 'react';
import { useApi } from '../hooks/useApi.ts';
import { api } from '../lib/api.ts';
import { ErrorBanner } from '../components/ErrorBanner.tsx';

export function Communities() {
  const state = useApi(api.communities);
  const [expanded, setExpanded] = useState<number | null>(null);

  if (state.status === 'loading') return <div className="text-gray-400 text-sm">Loading...</div>;
  if (state.status === 'error') return <ErrorBanner message={state.message} />;

  const { communities, totalFiles, totalEdges } = state.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Communities</h1>
        <span className="text-sm text-gray-400">{communities.length} clusters · {totalFiles} files · {totalEdges} edges</span>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {communities.map(c => (
          <div key={c.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <button
              className="w-full flex items-center justify-between text-left"
              onClick={() => setExpanded(expanded === c.id ? null : c.id)}
            >
              <div>
                <span className="text-sm font-medium text-gray-800">{c.name}</span>
                <span className="ml-2 text-xs text-gray-400">{c.size} files</span>
              </div>
              <span className="text-gray-400 text-xs">{expanded === c.id ? '▲' : '▼'}</span>
            </button>

            {expanded === c.id && (
              <ul className="mt-3 space-y-1 border-t border-gray-100 pt-3">
                {c.files.map(f => (
                  <li key={f} className="font-mono text-xs text-gray-500 truncate" title={f}>{f}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement Ownership.tsx**

```tsx
import { useState } from 'react';
import { useApi } from '../hooks/useApi.ts';
import { api } from '../lib/api.ts';
import { ErrorBanner } from '../components/ErrorBanner.tsx';

export function Ownership() {
  const state = useApi(api.ownership);
  const [filter, setFilter] = useState('');

  if (state.status === 'loading') return <div className="text-gray-400 text-sm">Loading...</div>;
  if (state.status === 'error') return <ErrorBanner message={state.message} />;

  const { entries, totalAuthors } = state.data;

  if (entries.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-gray-900">Ownership</h1>
        <p className="text-gray-500 text-sm">No git history available. Run <code>ctxloom index --with-git</code> to enable ownership analysis.</p>
      </div>
    );
  }

  const filtered = entries.filter(
    e => e.file.toLowerCase().includes(filter.toLowerCase()) ||
         e.primaryOwner.toLowerCase().includes(filter.toLowerCase())
  );

  const busFactor1 = entries.filter(e => e.busFactor === 1).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Ownership</h1>
        <span className="text-sm text-gray-400">{totalAuthors} authors · {busFactor1} single-owner files</span>
      </div>

      {busFactor1 > 0 && (
        <div className="rounded-md bg-yellow-50 border border-yellow-200 p-3 text-yellow-800 text-sm">
          ⚠ {busFactor1} files have only one contributor — bus factor risk.
        </div>
      )}

      <input
        type="text"
        placeholder="Filter by file or owner..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
        className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-300"
      />

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">File</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Primary owner</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Share</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Contributors</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map(e => (
              <tr key={e.file} className={`hover:bg-gray-50 ${e.busFactor === 1 ? 'bg-yellow-50/40' : ''}`}>
                <td className="px-4 py-3 font-mono text-xs text-gray-700 max-w-xs truncate" title={e.file}>{e.file}</td>
                <td className="px-4 py-3 text-xs text-gray-700">{e.primaryOwner}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{Math.round(e.primaryShare * 100)}%</td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  {e.busFactor === 1
                    ? <span className="text-yellow-600 font-medium">sole owner</span>
                    : e.busFactor
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/client/src/pages/Communities.tsx apps/dashboard/client/src/pages/Ownership.tsx
git commit -m "feat(dashboard): implement Communities and Ownership pages"
```

---

## Task 13: CLI Integration

Add `ctxloom dashboard` command to the existing CLI in `src/index.ts`.

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add dashboard case to the CLI switch in src/index.ts**

Find the switch block in `src/index.ts` that handles `case 'index':`, `case 'setup':`, etc. Add before the `default:` case:

```typescript
case 'dashboard': {
  const port = Number(
    args.find(a => a.startsWith('--port='))?.split('=')[1] ?? '7842'
  );
  const open = args.includes('--open') || args.includes('-o');
  const root = process.env.CTXLOOM_ROOT ?? process.cwd();

  const { startDashboard } = await import('./dashboard.js');
  await startDashboard({ root, port, open });
  break;
}
```

- [ ] **Step 2: Create src/dashboard.ts (thin re-export)**

```typescript
export { startDashboard } from '../apps/dashboard/server/index.js';
```

> **Note:** Because `apps/dashboard` is a workspace peer (not a built package yet), for the initial implementation the CLI will invoke the dashboard server directly from the monorepo. For distribution, the dashboard will be pre-built and bundled. This is acceptable for now.

- [ ] **Step 3: Update help text in src/index.ts**

Find the help text block (the string starting with `ctxloom — The Universal Code Context Engine`) and add:
```
  ctxloom dashboard            Start the web dashboard (port 7842)
  ctxloom dashboard --port=N   Start on custom port
  ctxloom dashboard --open     Open browser automatically
```

- [ ] **Step 4: Test the CLI command**

```bash
npx tsx src/index.ts dashboard --port=7843
```

Expected: server starts on port 7843, prints URL.
Stop with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/dashboard.ts
git commit -m "feat: add ctxloom dashboard CLI command"
```

---

## Task 14: Build Verification

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: all tests pass across root workspace and `apps/dashboard`.

- [ ] **Step 2: Build the client**

```bash
cd apps/dashboard && npx vite build client --outDir ../dist/dashboard
```

Expected: `dist/dashboard/client/` created with `index.html` and assets.

- [ ] **Step 3: Start full stack and verify in browser**

In one terminal:
```bash
npx tsx src/index.ts dashboard --open
```

Visit `http://localhost:7842`. Verify:
- [ ] Overview page loads with stat cards
- [ ] Graph page renders force-directed graph
- [ ] Risk page shows table (sortable by clicking column headers)
- [ ] Communities page shows expandable community cards
- [ ] Ownership page shows ownership table

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "feat(dashboard): complete web dashboard addon — all pages, API, CLI integration"
```

- [ ] **Step 5: Push branch**

```bash
git push origin feat/web-dashboard
```

---

## Definition of Done

- [ ] All 5 dashboard pages render real data from the local ctxloom context
- [ ] `ctxloom dashboard` CLI command starts the server
- [ ] All Vitest tests pass
- [ ] Client builds without errors
- [ ] Server handles missing git overlay gracefully (gitEnabled=false path)
- [ ] No TypeScript errors (`npm run lint` passes)

---

## Notes for Implementer

- The `DependencyGraph` and `GitOverlayStore` **already exist** in `src/` — the dashboard just reads their outputs. Do not re-implement them.
- `CommunityDetector` lives at `src/graph/CommunityDetector.ts` — import it directly.
- The `.ctxloom/` directory in the target repo must exist (i.e., `ctxloom index` must have been run). If it doesn't exist, `loadContext` will build the graph from scratch — this is handled by `buildFromDirectory`.
- The dashboard is intended as a **paid addon**. License enforcement (Keygen.sh integration) will be added in a future phase — for now it runs freely.
- Port 7842 is reserved for ctxloom dashboard. Do not change it without updating the Vite proxy config too.
