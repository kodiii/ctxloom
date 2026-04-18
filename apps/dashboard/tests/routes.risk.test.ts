import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildRiskRouter } from '../server/routes/risk.js';
import type { DashboardContext } from '../server/loader.js';

const hotChurn = { node: 'src/hot.ts', commits: 50, churnLines: 1200, bugCommits: 5, bugDensity: 0.1, authorEntropy: 1, lastTouch: 0 };
const coldChurn = { node: 'src/cold.ts', commits: 2, churnLines: 10, bugCommits: 0, bugDensity: 0, authorEntropy: 0, lastTouch: 0 };
const ownership = { node: 'f', owners: [{ author: 'alice', email: 'a@a', share: 0.9 }], stalenessDays: 0, busFactor: 1 };

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
      statsFor: (f: string) => (f === 'src/hot.ts' ? hotChurn : coldChurn),
    },
    ownership: { statsFor: () => ownership },
    coChange: { topFor: () => [] },
  } as any,
};

describe('GET /api/risk', () => {
  it('returns sorted risk entries with hot file first', async () => {
    const app = express();
    app.use('/api/risk', buildRiskRouter(mockCtx));
    const res = await request(app).get('/api/risk');
    expect(res.status).toBe(200);
    expect(res.body.entries[0].file).toBe('src/hot.ts');
    expect(res.body.entries[0].riskScore).toBeGreaterThan(res.body.entries[1].riskScore);
  });

  it('returns empty entries when git disabled', async () => {
    const app = express();
    app.use('/api/risk', buildRiskRouter({ ...mockCtx, gitEnabled: false }));
    const res = await request(app).get('/api/risk');
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(0);
  });
});
