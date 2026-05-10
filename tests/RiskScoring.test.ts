import { describe, it, expect } from 'vitest';
import {
  assignLabelsByPercentile,
  BAND_PCT,
  computeRiskBreakdown,
  computeRiskCaps,
  isSiloed,
  RISK_WEIGHTS,
  scoreAll,
  scoreFromBreakdown,
  SCORE_FLOOR,
  type RawRiskMetrics,
} from '../packages/core/src/risk/scoring.js';

function raw(over: Partial<RawRiskMetrics> = {}): RawRiskMetrics {
  return { churnLines: 0, bugDensity: 0, busFactor: 1, couplingFanOut: 0, ...over };
}

describe('computeRiskBreakdown', () => {
  it('normalizes churn against the p90 cap and saturates at 1.0', () => {
    const caps = { churn: 100, coupling: 10 };
    expect(computeRiskBreakdown(raw({ churnLines: 50 }), caps).churn).toBe(0.5);
    expect(computeRiskBreakdown(raw({ churnLines: 100 }), caps).churn).toBe(1);
    expect(computeRiskBreakdown(raw({ churnLines: 250 }), caps).churn).toBe(1);
  });

  it('does not divide by zero when caps are 0', () => {
    const caps = { churn: 0, coupling: 0 };
    const b = computeRiskBreakdown(raw({ churnLines: 50, couplingFanOut: 10 }), caps);
    expect(Number.isFinite(b.churn)).toBe(true);
    expect(Number.isFinite(b.coupling)).toBe(true);
    expect(b.churn).toBe(1); // 50/max(0,1)=50 → clamped to 1
  });

  it('does not include bus factor in the breakdown', () => {
    const b = computeRiskBreakdown(raw({ busFactor: 1 }), { churn: 100, coupling: 10 });
    expect(b).toEqual({ churn: 0, bugDensity: 0, coupling: 0 });
    expect(b).not.toHaveProperty('busFactor');
  });
});

describe('scoreFromBreakdown', () => {
  it('uses the documented weights (40/30/30, no bus)', () => {
    const score = scoreFromBreakdown({ churn: 1, bugDensity: 1, coupling: 1 });
    expect(score).toBeCloseTo(1, 5);
  });

  it('weights match exported RISK_WEIGHTS', () => {
    expect(RISK_WEIGHTS.churn + RISK_WEIGHTS.bug + RISK_WEIGHTS.coupling).toBeCloseTo(1, 5);
  });
});

describe('assignLabelsByPercentile', () => {
  it('assigns critical to the top 5%, high to next 10%, medium to next 20%', () => {
    const scores = Array.from({ length: 100 }, (_, i) => 0.5 + i / 200);
    const { labels, bands } = assignLabelsByPercentile(scores);
    expect(bands.totalRanked).toBe(100);
    expect(bands.criticalCount).toBe(Math.ceil(100 * BAND_PCT.critical));
    expect(bands.criticalCount + bands.highCount).toBe(Math.ceil(100 * BAND_PCT.high));
    expect(bands.criticalCount + bands.highCount + bands.mediumCount).toBe(Math.ceil(100 * BAND_PCT.medium));
    // Highest-scored file is critical
    const topIdx = scores.indexOf(Math.max(...scores));
    expect(labels[topIdx]).toBe('critical');
  });

  it('forces files below SCORE_FLOOR to low even at the top', () => {
    const scores = [0.04, 0.03, 0.02, 0.01];
    const { labels, bands } = assignLabelsByPercentile(scores);
    expect(labels.every(l => l === 'low')).toBe(true);
    expect(bands.criticalCount).toBe(0);
    expect(bands.lowCount).toBe(4);
  });

  it('handles small repos: n=2 still labels the top file critical if above floor', () => {
    const { labels } = assignLabelsByPercentile([0.7, 0.02]);
    expect(labels[0]).toBe('critical');
    expect(labels[1]).toBe('low');
  });

  it('handles n=0 cleanly', () => {
    const { labels, bands } = assignLabelsByPercentile([]);
    expect(labels).toHaveLength(0);
    expect(bands.totalRanked).toBe(0);
  });

  it('SCORE_FLOOR is the documented 0.05', () => {
    expect(SCORE_FLOOR).toBe(0.05);
    const { labels } = assignLabelsByPercentile([0.0499, 0.06]);
    expect(labels[0]).toBe('low');
    expect(labels[1]).toBe('critical');
  });
});

describe('computeRiskCaps (p90)', () => {
  it('returns the 90th-percentile churn and coupling values', () => {
    const samples = Array.from({ length: 10 }, (_, i) => raw({
      churnLines: i * 100,
      couplingFanOut: i,
    }));
    const caps = computeRiskCaps(samples);
    // Sorted churn: [0,100,200,...,900]. p90 = idx floor(10*0.9) = 9 → 900.
    expect(caps.churn).toBe(900);
    expect(caps.coupling).toBe(9);
  });
});

describe('isSiloed', () => {
  it('treats busFactor ≤ 1 as siloed', () => {
    expect(isSiloed(raw({ busFactor: 1 }))).toBe(true);
    expect(isSiloed(raw({ busFactor: 2 }))).toBe(false);
    expect(isSiloed(raw({ busFactor: 0 }))).toBe(true);
  });
});

describe('scoreAll (one-shot helper)', () => {
  it('returns scored files with consistent labels and bands', () => {
    const samples: RawRiskMetrics[] = [
      raw({ churnLines: 1000, bugDensity: 0.5, couplingFanOut: 20 }),
      raw({ churnLines: 100, bugDensity: 0.1, couplingFanOut: 2 }),
      raw({ churnLines: 0 }),
    ];
    const { scored, caps, bands } = scoreAll(samples);
    expect(scored).toHaveLength(3);
    expect(caps.churn).toBeGreaterThan(0);
    expect(bands.totalRanked).toBe(3);
    // The first file (most churn + bugs + coupling) should rank highest
    expect(scored[0].score).toBeGreaterThan(scored[1].score);
    expect(scored[1].score).toBeGreaterThan(scored[2].score);
    // Last file scores 0 → low
    expect(scored[2].label).toBe('low');
  });
});
