import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { DEFAULT_REVIEW_CONFIG } from './types.js';
import type { ReviewConfig } from './types.js';

/**
 * Load review config from .ctxloom/review.yml, deep-merged over defaults.
 * Missing or malformed file silently returns defaults.
 */
export async function loadReviewConfig(root: string): Promise<ReviewConfig> {
  const file = path.join(root, '.ctxloom', 'review.yml');
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = yaml.load(raw) as Partial<ReviewConfig> | null;
    if (!parsed) return DEFAULT_REVIEW_CONFIG;
    return {
      weights: { ...DEFAULT_REVIEW_CONFIG.weights, ...(parsed.weights ?? {}) },
      thresholds: { ...DEFAULT_REVIEW_CONFIG.thresholds, ...(parsed.thresholds ?? {}) },
      defaults: { ...DEFAULT_REVIEW_CONFIG.defaults, ...(parsed.defaults ?? {}) },
      exclude: parsed.exclude ?? DEFAULT_REVIEW_CONFIG.exclude,
    };
  } catch {
    return DEFAULT_REVIEW_CONFIG;
  }
}
