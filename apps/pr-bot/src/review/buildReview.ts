import {
  detectChanges,
  getImpactRadius,
  type DependencyGraph,
  type GitOverlayStore,
  type RiskLevel,
} from '@ctxloom/core';
import type { ReviewPayload } from './types.js';
import type { RepoConfig } from '../config.js';
import { riskLabelFromScore } from './types.js';

export interface BuildReviewInput {
  graph: DependencyGraph;
  overlay: GitOverlayStore | undefined;
  changedFiles: string[];
  pr: ReviewPayload['pr'];
  config: RepoConfig;
}

const RISK_LEVEL_SCORES: Record<RiskLevel, number> = {
  critical: 1.0,
  high: 0.8,
  medium: 0.5,
  low: 0.2,
};

export async function buildReview(input: BuildReviewInput): Promise<ReviewPayload> {
  const { graph, overlay, changedFiles, pr, config } = input;

  const detectResult = detectChanges({ graph, overlay, changedFiles });
  const impact = getImpactRadius({ graph, overlay, changedFiles });

  const riskScore = detectResult.changedFiles.reduce((max, f) => {
    const score = RISK_LEVEL_SCORES[f.riskLevel];
    return score > max ? score : max;
  }, 0);

  const riskLabel = riskLabelFromScore(riskScore);

  return {
    pr,
    riskScore,
    riskLabel,
    changedFiles: detectResult.changedFiles,
    impact,
    suggestedReviewers: [],
    config,
  };
}
