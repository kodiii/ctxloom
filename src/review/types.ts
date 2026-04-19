// ---------------------------------------------------------------------------
// Review config (loaded from .ctxloom/review.yml)
// ---------------------------------------------------------------------------

export interface ReviewWeights {
  ownership: number;
  coChange: number;
  activity: number;
  busFactorBoost: number;
}

export interface ReviewThresholds {
  stalenessDaysPenalty: number;
  stalenessDaysFilter: number;
  activityRecentDays: number;
  activityMidDays: number;
  coChangeWindowDays: number;
}

export interface ReviewDefaults {
  max: number;
  minShare: number;
  maxPerPath: number;
}

export interface ReviewConfig {
  weights: ReviewWeights;
  thresholds: ReviewThresholds;
  defaults: ReviewDefaults;
  exclude: string[];
}

export const DEFAULT_REVIEW_CONFIG: ReviewConfig = {
  weights: {
    ownership: 0.50,
    coChange: 0.25,
    activity: 0.15,
    busFactorBoost: 0.10,
  },
  thresholds: {
    stalenessDaysPenalty: 180,
    stalenessDaysFilter: 180,
    activityRecentDays: 30,
    activityMidDays: 90,
    coChangeWindowDays: 90,
  },
  defaults: {
    max: 3,
    minShare: 0.30,
    maxPerPath: 2,
  },
  exclude: [],
};

// ---------------------------------------------------------------------------
// Scorer types
// ---------------------------------------------------------------------------

export interface CandidateActivity {
  email: string;
  lastCommitTimestamp: number; // unix seconds
}

export interface ScoreBreakdown {
  email: string;
  handle?: string;           // resolved GitHub handle (undefined until resolved)
  ownership: number;         // 0..1
  coChange: number;          // 0..1
  activity: number;          // 0..1
  busFactorBoost: number;    // 0..1
  stalenessMultiplier: number; // 0.3 or 1.0
  total: number;             // weighted sum × multiplier
}

export interface ReviewSuggestion {
  breakdown: ScoreBreakdown;
  reason: string;            // human-readable summary for CLI/comment output
}

export interface BusFactorWarning {
  pattern: string;           // e.g. "src/auth/**"
  busFactor: number;
  topOwnerStalenessDays: number;
}

export interface ReviewSuggestResult {
  suggestions: ReviewSuggestion[];
  warnings: BusFactorWarning[];
}

// ---------------------------------------------------------------------------
// Author resolution
// ---------------------------------------------------------------------------

export interface AuthorMapping {
  mappings: Record<string, string>;  // email → handle
  ignore: string[];
}
