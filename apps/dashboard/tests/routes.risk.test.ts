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
    expect(res.body.caps).toEqual({ churn: 0, coupling: 0 });
    expect(res.body.bands).toEqual({
      criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, totalRanked: 0,
    });
  });

  it('returns intrinsic-only breakdown (no bus factor in score)', async () => {
    const app = express();
    app.use('/api/risk', buildRiskRouter(mockCtx));
    const res = await request(app).get('/api/risk');

    expect(res.body.caps.churn).toBeGreaterThan(0);

    for (const entry of res.body.entries) {
      expect(entry.breakdown).toEqual({
        churn: expect.any(Number),
        bugDensity: expect.any(Number),
        coupling: expect.any(Number),
      });
      expect(entry.breakdown).not.toHaveProperty('busFactor');

      for (const v of Object.values(entry.breakdown)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }

      // weighted sum 0.4 churn + 0.3 bugs + 0.3 coupling ≈ stored riskScore
      const b = entry.breakdown as Record<string, number>;
      const recomputed = b.churn * 0.4 + b.bugDensity * 0.3 + b.coupling * 0.3;
      expect(Math.abs(recomputed - entry.riskScore)).toBeLessThan(0.011);

      // bus factor surfaced as a separate per-file annotation
      expect(typeof entry.busFactor).toBe('number');
      expect(typeof entry.siloed).toBe('boolean');
      expect(entry.siloed).toBe(entry.busFactor <= 1);
    }
  });

  it('assigns labels by percentile band, not absolute threshold', async () => {
    const app = express();
    app.use('/api/risk', buildRiskRouter(mockCtx));
    const res = await request(app).get('/api/risk');

    // hot.ts is the higher-scoring of two files, so it should land in
    // 'critical' (top 5% with min-1 floor for tiny repos). cold.ts has
    // near-zero metrics — its score is below SCORE_FLOOR, so it should
    // be 'low' regardless of rank.
    const hot = res.body.entries.find((e: any) => e.file === 'src/hot.ts');
    const cold = res.body.entries.find((e: any) => e.file === 'src/cold.ts');
    expect(hot.riskLabel).toBe('critical');
    expect(cold.riskLabel).toBe('low');
    expect(res.body.bands.criticalCount).toBe(1);
    expect(res.body.bands.lowCount).toBe(1);
  });
});
