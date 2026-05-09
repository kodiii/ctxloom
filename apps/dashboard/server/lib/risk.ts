import type { RiskBands, RiskBreakdown, RiskCaps } from '../types.js';

export interface RawRiskMetrics {
  churnLines: number;
  bugDensity: number;
  busFactor: number;
  couplingFanOut: number;
}

// Score is intrinsic file risk only — properties of the file itself.
// Bus factor is *not* in the score: in solo projects it's a project-wide
// constant (no per-file signal), and in team projects it's an amplifier of
// other risks rather than a primary risk. Surface it as separate context
// (the `siloed` flag and the `busFactor` field on RiskEntry) so users can
// see it without it inflating critical counts.
export const RISK_WEIGHTS = { churn: 0.4, bug: 0.3, coupling: 0.3 } as const;

// Labels are percentile-banded within the project: critical = top 5% by
// score, high = next 10%, medium = next 20%, low = bottom 65%. A file
// scoring below SCORE_FLOOR is always low regardless of rank — prevents
// labelling trivially-clean files as critical just because they happened
// to be at the top of an otherwise-quiet repo.
export const BAND_PCT = { critical: 0.05, high: 0.15, medium: 0.35 } as const;
export const SCORE_FLOOR = 0.05;

// A file is "siloed" when only one author has touched it. Surfaced
// separately from the score so users see knowledge concentration without
// it driving severity.
export const SILO_BUS_FACTOR = 1;

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

export function computeRiskCaps(samples: RawRiskMetrics[], p = 0.9): RiskCaps {
  return {
    churn: percentile(samples.map(s => s.churnLines), p),
    coupling: percentile(samples.map(s => s.couplingFanOut), p),
  };
}

export function computeRiskBreakdown(m: RawRiskMetrics, caps: RiskCaps): RiskBreakdown {
  const churnDenom = Math.max(caps.churn, 1);
  const couplingDenom = Math.max(caps.coupling, 1);
  return {
    churn: Math.min(1, m.churnLines / churnDenom),
    bugDensity: Math.min(1, m.bugDensity * 2),
    coupling: Math.min(1, m.couplingFanOut / couplingDenom),
  };
}

export function scoreFromBreakdown(b: RiskBreakdown): number {
  return (
    b.churn * RISK_WEIGHTS.churn +
    b.bugDensity * RISK_WEIGHTS.bug +
    b.coupling * RISK_WEIGHTS.coupling
  );
}

export type RiskLabel = 'low' | 'medium' | 'high' | 'critical';

export function isSiloed(m: RawRiskMetrics): boolean {
  return m.busFactor <= SILO_BUS_FACTOR;
}

export interface BandResult {
  labels: RiskLabel[];
  bands: RiskBands;
}

export function assignLabelsByPercentile(scores: number[]): BandResult {
  const n = scores.length;
  const bands: RiskBands = { criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, totalRanked: n };
  if (n === 0) return { labels: [], bands };

  const ranked = scores
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s - a.s);

  // Cumulative cutoffs by rank. Math.max guards keep ordering sensible on
  // very small repos (e.g. n=2) where naive ceil(n*p) collapses to 0/1.
  const criticalCutoff = Math.max(1, Math.ceil(n * BAND_PCT.critical));
  const highCutoff = Math.max(criticalCutoff + 1, Math.ceil(n * BAND_PCT.high));
  const mediumCutoff = Math.max(highCutoff + 1, Math.ceil(n * BAND_PCT.medium));

  const labels: RiskLabel[] = new Array(n).fill('low');
  for (let rank = 0; rank < n; rank++) {
    const { s, i } = ranked[rank];
    if (s < SCORE_FLOOR) {
      labels[i] = 'low';
      bands.lowCount++;
      continue;
    }
    if (rank < criticalCutoff) {
      labels[i] = 'critical';
      bands.criticalCount++;
    } else if (rank < highCutoff) {
      labels[i] = 'high';
      bands.highCount++;
    } else if (rank < mediumCutoff) {
      labels[i] = 'medium';
      bands.mediumCount++;
    } else {
      labels[i] = 'low';
      bands.lowCount++;
    }
  }
  return { labels, bands };
}
