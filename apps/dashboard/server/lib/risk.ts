/**
 * Thin re-export so dashboard routes don't need to know that risk
 * scoring lives in @ctxloom/core. The single source of truth is
 * packages/core/src/risk/scoring.ts — see docs/RISK.md.
 */
export {
  RISK_WEIGHTS,
  BAND_PCT,
  SCORE_FLOOR,
  SILO_BUS_FACTOR,
  computeRiskCaps,
  computeRiskBreakdown,
  scoreFromBreakdown,
  isSiloed,
  assignLabelsByPercentile,
  scoreAll,
  type RiskLabel,
  type RawRiskMetrics,
  type RiskBreakdown,
  type RiskCaps,
  type RiskBands,
  type ScoredFile,
} from '@ctxloom/core';
