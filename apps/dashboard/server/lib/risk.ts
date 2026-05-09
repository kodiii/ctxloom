import type { RiskBreakdown, RiskCaps } from '../types.js';

export interface RawRiskMetrics {
  churnLines: number;
  bugDensity: number;
  busFactor: number;
  couplingFanOut: number;
}

export const RISK_WEIGHTS = { churn: 0.2, bug: 0.2, bus: 0.4, coupling: 0.2 } as const;

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
    busFactor: Math.min(1, 1 / Math.max(1, m.busFactor)),
    coupling: Math.min(1, m.couplingFanOut / couplingDenom),
  };
}

export function scoreFromBreakdown(b: RiskBreakdown): number {
  return (
    b.churn * RISK_WEIGHTS.churn +
    b.bugDensity * RISK_WEIGHTS.bug +
    b.busFactor * RISK_WEIGHTS.bus +
    b.coupling * RISK_WEIGHTS.coupling
  );
}

export type RiskLabel = 'low' | 'medium' | 'high' | 'critical';

export function riskLabel(score: number): RiskLabel {
  if (score > 0.8) return 'critical';
  if (score > 0.6) return 'high';
  if (score > 0.3) return 'medium';
  return 'low';
}
