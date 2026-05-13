import type { ChangedFile, ImpactReport } from '@ctxloom/core';
import type { RepoConfig } from '../config.js';

export interface ReviewPayload {
  pr: {
    owner: string;
    repo: string;
    number: number;
    headSha: string;
    baseSha: string;
  };
  riskScore: number;
  riskLabel: 'low' | 'medium' | 'high';
  changedFiles: ChangedFile[];
  impact: ImpactReport;
  suggestedReviewers: Array<{ login: string; rationale: string; share?: number }>;
  config: RepoConfig;
}

export function riskLabelFromScore(score: number): 'low' | 'medium' | 'high' {
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}
