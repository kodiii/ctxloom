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
    getImports: (f: string) => (f === 'src/a.ts' ? ['src/b.ts'] : []),
    getImporters: (f: string) => (f === 'src/b.ts' ? ['src/a.ts'] : []),
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

  it('deduplicates edges', async () => {
    const app = express();
    app.use('/api/graph', buildGraphRouter(mockCtx));
    const res = await request(app).get('/api/graph');
    const edgeKeys = res.body.edges.map((e: any) => `${e.source}→${e.target}`);
    expect(new Set(edgeKeys).size).toBe(edgeKeys.length);
  });
});
