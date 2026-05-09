import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildOverviewRouter } from '../server/routes/overview.js';
import type { DashboardContext } from '../server/loader.js';

const mockCtx: DashboardContext = {
  root: '/fake',
  gitEnabled: true,
  graph: {
    allFiles: () => ['a.ts', 'b.ts', 'c.ts'],
    edgeCount: () => 5,
    getImports: (f: string) => (f === 'a.ts' ? ['b.ts'] : []),
    getImporters: (f: string) => (f === 'b.ts' ? ['a.ts'] : []),
  } as any,
  overlay: {
    churn: {
      statsFor: (f: string) =>
        f === 'a.ts'
          ? { node: f, commits: 10, churnLines: 1200, bugCommits: 1, bugDensity: 0.1, authorEntropy: 1, lastTouch: 0 }
          : null,
    },
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

  it('returns risk breakdown using unified scoring', async () => {
    const app = express();
    app.use('/api/overview', buildOverviewRouter(mockCtx));
    const res = await request(app).get('/api/overview');
    // With unified algo: bus factor 1 contributes 0.4 to every file (no ownership data).
    // a.ts adds saturated churn (p90=1200) + small bug density → high.
    // b.ts/c.ts have only the bus contribution → medium.
    const total = res.body.risk.critical + res.body.risk.high + res.body.risk.medium + res.body.risk.low;
    expect(total).toBe(3);
    expect(res.body.risk.high).toBe(1);
    expect(res.body.risk.medium).toBe(2);
  });
});
