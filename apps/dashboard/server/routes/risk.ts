import { Router } from 'express';
import type { DashboardContext } from '../loader.js';
import type { RiskResponse, RiskEntry } from '../types.js';
import {
  assignLabelsByPercentile,
  computeRiskBreakdown,
  computeRiskCaps,
  isSiloed,
  scoreFromBreakdown,
  type RawRiskMetrics,
} from '../lib/risk.js';

interface RawWithIdentity extends RawRiskMetrics {
  file: string;
  topOwner: string | null;
}

export function buildRiskRouter(ctx: DashboardContext): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const { graph, overlay, gitEnabled } = ctx;

    if (!gitEnabled) {
      const body: RiskResponse = {
        entries: [],
        overallRiskScore: 0,
        caps: { churn: 0, coupling: 0 },
        bands: { criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, totalRanked: 0 },
      };
      return res.json(body);
    }

    const files = graph.allFiles();

    const raw: RawWithIdentity[] = files.map(f => {
      const churn = overlay.churn.statsFor(f);
      const ownership = overlay.ownership.statsFor(f);
      const coupled = overlay.coChange.topFor({ node: f, limit: 100, minConfidence: 0.1 });

      return {
        file: f,
        churnLines: churn?.churnLines ?? 0,
        bugDensity: churn?.bugDensity ?? 0,
        busFactor: ownership?.busFactor ?? 1,
        topOwner: ownership?.owners?.[0]?.author ?? null,
        couplingFanOut: coupled.length,
      };
    });

    const caps = computeRiskCaps(raw);

    const scored = raw.map(m => {
      const breakdown = computeRiskBreakdown(m, caps);
      return { m, breakdown, score: scoreFromBreakdown(breakdown) };
    });

    const { labels, bands } = assignLabelsByPercentile(scored.map(s => s.score));

    const entries: RiskEntry[] = scored.map(({ m, breakdown, score }, idx) => ({
      file: m.file,
      riskScore: Math.round(score * 100) / 100,
      riskLabel: labels[idx],
      churnLines: m.churnLines,
      bugDensity: m.bugDensity,
      busFactor: m.busFactor,
      topOwner: m.topOwner,
      couplingFanOut: m.couplingFanOut,
      breakdown,
      siloed: isSiloed(m),
    }));

    entries.sort((a, b) => b.riskScore - a.riskScore);

    const overallRiskScore = entries.length > 0
      ? Math.round((entries.reduce((s, e) => s + e.riskScore, 0) / entries.length) * 100) / 100
      : 0;

    res.json({ entries, overallRiskScore, caps, bands } satisfies RiskResponse);
  });

  return router;
}
