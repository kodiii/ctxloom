import { Router } from 'express';
import type { DashboardContext } from '../loader.js';
import type { RiskResponse, RiskEntry } from '../types.js';

function computeRiskScore(churnLines: number, bugDensity: number, busFactor: number, couplingFanOut: number): number {
  const churnPart = Math.min(1, churnLines / 1000);
  const bugPart = Math.min(1, bugDensity * 2);
  const busPart = busFactor <= 1 ? 1 : busFactor <= 2 ? 0.5 : 0;
  const couplingPart = Math.min(1, couplingFanOut / 10);
  return churnPart * 0.3 + bugPart * 0.3 + busPart * 0.2 + couplingPart * 0.2;
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

    if (!gitEnabled) {
      const body: RiskResponse = { entries: [], overallRiskScore: 0 };
      return res.json(body);
    }

    const files = graph.allFiles();

    const entries: RiskEntry[] = files.map(f => {
      const churn = overlay.churn.statsFor(f);
      const ownership = overlay.ownership.statsFor(f);
      const coupled = overlay.coChange.topFor({ node: f, limit: 100, minConfidence: 0.1 });

      const churnLines = churn?.churnLines ?? 0;
      const bugDensity = churn?.bugDensity ?? 0;
      const busFactor = ownership?.busFactor ?? 1;
      const topOwner = ownership?.owners?.[0]?.author ?? null;
      const couplingFanOut = coupled.length;
      const score = computeRiskScore(churnLines, bugDensity, busFactor, couplingFanOut);

      return {
        file: f,
        riskScore: Math.round(score * 100) / 100,
        riskLabel: riskLabel(score),
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

    res.json({ entries, overallRiskScore } satisfies RiskResponse);
  });

  return router;
}
