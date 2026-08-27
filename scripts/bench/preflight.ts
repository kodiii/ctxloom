/**
 * Fast corpus validation performed before any clone, checkout, or index work.
 *
 * The benchmark corpus is external state: a pinned PR can become unavailable,
 * move off the default branch, or otherwise stop satisfying the methodology.
 * Validate every entry up front so a two-hour run never fails halfway through
 * because the final repository contains a broken pin.
 */
import { fetchDefaultBranch, fetchGroundTruth } from './groundTruth.js';
import type { CorpusEntry, GroundTruth } from './types.js';

export type GroundTruthFetcher = (
  repo: string,
  prNumber: number,
  expectedBaseRef?: string,
) => GroundTruth;

export type DefaultBranchFetcher = (repo: string) => string;

export function corpusPrKey(repo: string, prNumber: number): string {
  return `${repo}#${prNumber}`;
}

/**
 * Validate the complete selected corpus and return the fetched ground truth.
 * Failures are accumulated so one invocation reports every broken pin.
 */
export function preflightCorpus(
  corpus: readonly CorpusEntry[],
  groundTruthFetcher: GroundTruthFetcher = fetchGroundTruth,
  defaultBranchFetcher: DefaultBranchFetcher = fetchDefaultBranch,
): Map<string, GroundTruth> {
  const totalPrs = corpus.reduce((sum, entry) => sum + entry.prs.length, 0);
  const groundTruthByPr = new Map<string, GroundTruth>();
  const failures: string[] = [];
  const seen = new Set<string>();

  // eslint-disable-next-line no-console -- benchmark progress goes to stderr
  console.error(`Preflight: validating ${totalPrs} pinned PRs across ${corpus.length} repos...`);

  for (const entry of corpus) {
    let defaultBranch: string | undefined;
    try {
      defaultBranch = defaultBranchFetcher(entry.repo);
    } catch (error) {
      failures.push(
        `${entry.repo}: could not resolve default branch: ` +
        `${error instanceof Error ? error.message : String(error)}`,
      );
    }

    for (const prNumber of entry.prs) {
      const key = corpusPrKey(entry.repo, prNumber);
      if (seen.has(key)) {
        failures.push(`${key}: duplicate corpus entry`);
        continue;
      }
      seen.add(key);

      try {
        const groundTruth = groundTruthFetcher(entry.repo, prNumber, defaultBranch);
        groundTruthByPr.set(key, groundTruth);
        // eslint-disable-next-line no-console -- benchmark progress goes to stderr
        console.error(
          `  ✓ ${key} (${groundTruth.groundTruthFiles.length} files, ` +
          `entry ${groundTruth.entryPoint})`,
        );
      } catch (error) {
        failures.push(
          `${key}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Benchmark corpus preflight failed with ${failures.length} problem(s):\n` +
      failures.map((failure) => `  - ${failure}`).join('\n'),
    );
  }

  // eslint-disable-next-line no-console -- benchmark progress goes to stderr
  console.error(`Preflight passed: all ${totalPrs} pinned PRs are valid.`);
  return groundTruthByPr;
}

export function getPreflightGroundTruth(
  groundTruthByPr: ReadonlyMap<string, GroundTruth>,
  repo: string,
  prNumber: number,
): GroundTruth {
  const key = corpusPrKey(repo, prNumber);
  const groundTruth = groundTruthByPr.get(key);
  if (!groundTruth) {
    throw new Error(`Missing preflight ground truth for ${key}.`);
  }
  return groundTruth;
}
