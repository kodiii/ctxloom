import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FULL_CORPUS, SPIKE_CORPUS } from '../scripts/bench/corpus.js';
import {
  corpusPrKey,
  getPreflightGroundTruth,
  preflightCorpus,
} from '../scripts/bench/preflight.js';
import type { CorpusEntry, GroundTruth } from '../scripts/bench/types.js';

const fakeGroundTruth = (prNumber: number): GroundTruth => ({
  prNumber,
  groundTruthFiles: ['src/feature.ts', 'tests/feature.test.ts'],
  entryPoint: 'src/feature.ts',
  evalSha: `merge-${prNumber}`,
});

describe('benchmark corpus invariants', () => {
  it('contains the documented five repositories and fifteen unique PRs', () => {
    const keys = FULL_CORPUS.flatMap((entry) =>
      entry.prs.map((prNumber) => corpusPrKey(entry.repo, prNumber)),
    );

    expect(FULL_CORPUS).toHaveLength(5);
    expect(FULL_CORPUS.every((entry) => entry.prs.length === 3)).toBe(true);
    expect(keys).toHaveLength(15);
    expect(new Set(keys).size).toBe(15);
  });

  it('keeps the spike pins inside the full corpus', () => {
    const fullKeys = new Set(
      FULL_CORPUS.flatMap((entry) =>
        entry.prs.map((prNumber) => corpusPrKey(entry.repo, prNumber)),
      ),
    );
    const spikeKeys = SPIKE_CORPUS.flatMap((entry) =>
      entry.prs.map((prNumber) => corpusPrKey(entry.repo, prNumber)),
    );

    expect(spikeKeys.every((key) => fullKeys.has(key))).toBe(true);
    expect(fullKeys.has('expressjs/express#7366')).toBe(true);
    expect(fullKeys.has('expressjs/express#6196')).toBe(true);
    expect(fullKeys.has('encode/httpx#3377')).toBe(true);
    expect(fullKeys.has('expressjs/express#6903')).toBe(false);
    expect(fullKeys.has('expressjs/express#5885')).toBe(false);
    expect(fullKeys.has('encode/httpx#3673')).toBe(false);
  });
});

describe('preflightCorpus', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => {
    consoleError.mockRestore();
  });

  it('validates every pin before returning reusable ground truth', () => {
    const corpus: CorpusEntry[] = [
      { name: 'alpha', repo: 'owner/alpha', prs: [1, 2] },
      { name: 'beta', repo: 'owner/beta', prs: [3] },
    ];
    const fetched: string[] = [];
    const branches: string[] = [];

    const result = preflightCorpus(
      corpus,
      (repo, prNumber, expectedBaseRef) => {
        fetched.push(`${repo}#${prNumber}@${expectedBaseRef}`);
        return fakeGroundTruth(prNumber);
      },
      (repo) => {
        branches.push(repo);
        return 'main';
      },
    );

    expect(branches).toEqual(['owner/alpha', 'owner/beta']);
    expect(fetched).toEqual([
      'owner/alpha#1@main',
      'owner/alpha#2@main',
      'owner/beta#3@main',
    ]);
    expect(result.size).toBe(3);
    expect(getPreflightGroundTruth(result, 'owner/alpha', 2).evalSha).toBe('merge-2');
  });

  it('accumulates failures while still checking every unique pin', () => {
    const corpus: CorpusEntry[] = [
      { name: 'alpha', repo: 'owner/alpha', prs: [1, 2] },
      { name: 'beta', repo: 'owner/beta', prs: [3] },
    ];
    const fetched: number[] = [];

    expect(() => preflightCorpus(
      corpus,
      (_repo, prNumber) => {
        fetched.push(prNumber);
        if (prNumber === 1 || prNumber === 3) {
          throw new Error(`missing ${prNumber}`);
        }
        return fakeGroundTruth(prNumber);
      },
      () => 'main',
    )).toThrow(/2 problem\(s\)[\s\S]*missing 1[\s\S]*missing 3/);

    expect(fetched).toEqual([1, 2, 3]);
  });

  it('rejects duplicate repo and PR pins', () => {
    const corpus: CorpusEntry[] = [
      { name: 'alpha', repo: 'owner/alpha', prs: [1, 1] },
    ];

    expect(() => preflightCorpus(
      corpus,
      (_repo, prNumber) => fakeGroundTruth(prNumber),
      () => 'main',
    )).toThrow(/duplicate corpus entry/);
  });

  it('fails clearly when preflight data is missing', () => {
    expect(() => getPreflightGroundTruth(new Map(), 'owner/alpha', 42))
      .toThrow('Missing preflight ground truth for owner/alpha#42.');
  });
});
