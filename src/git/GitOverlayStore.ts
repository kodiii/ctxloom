/**
 * GitOverlayStore
 *
 * Coordinator class that drives GitHistoryMiner and fans each GitCommitEvent
 * into CoChangeIndex, ChurnIndex, and OwnershipIndex. Handles full rebuilds,
 * incremental refresh (only commits since lastCommitScanned), and persistence
 * via a `.ctxloom/git-overlay.json` sidecar file.
 *
 * Sidecar format:
 * {
 *   "version": 1,
 *   "lastCommitScanned": "<sha or null>",
 *   "commits": 42,
 *   "windowDays": 365,
 *   "coChange": { CoChangeSnapshot },
 *   "churn": { ChurnSnapshot },
 *   "ownership": { OwnershipSnapshot }
 * }
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { GitHistoryMiner } from './GitHistoryMiner.js';
import { CoChangeIndex, type CoChangeSnapshot } from './CoChangeIndex.js';
import { ChurnIndex, type ChurnSnapshot } from './ChurnIndex.js';
import { OwnershipIndex, type OwnershipSnapshot } from './OwnershipIndex.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OverlayBootstrapOptions {
  /** How far back to mine git history. Defaults to 365 days. */
  windowDays?: number;
  /** Commits touching more files than this threshold are flagged isBulk. Defaults to 50. */
  bulkThreshold?: number;
  /** Extra path prefixes to exclude (merged with miner defaults). */
  excludePaths?: string[];
}

export interface RefreshResult {
  commitsIngested: number;
  newHead: string;
}

// ---------------------------------------------------------------------------
// Internal sidecar shape
// ---------------------------------------------------------------------------

interface SidecarData {
  version: 1;
  lastCommitScanned: string | null;
  commits: number;
  windowDays: number;
  coChange: CoChangeSnapshot;
  churn: ChurnSnapshot;
  ownership: OwnershipSnapshot;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW_DAYS = 365;
const DEFAULT_BULK_THRESHOLD = 50;
const SIDECAR_SUBPATH = path.join('.ctxloom', 'git-overlay.json');

// ---------------------------------------------------------------------------
// GitOverlayStore
// ---------------------------------------------------------------------------

export class GitOverlayStore {
  #coChange: CoChangeIndex = new CoChangeIndex();
  #churn: ChurnIndex = new ChurnIndex();
  #ownership: OwnershipIndex = new OwnershipIndex();

  get coChange(): CoChangeIndex { return this.#coChange; }
  get churn(): ChurnIndex { return this.#churn; }
  get ownership(): OwnershipIndex { return this.#ownership; }

  private lastCommitScanned: string | null = null;
  private totalCommits = 0;

  private readonly windowDays: number;
  private readonly bulkThreshold: number;
  private readonly excludePaths: string[] | undefined;

  constructor(
    private readonly repoRoot: string,
    opts: OverlayBootstrapOptions = {},
  ) {
    this.windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
    this.bulkThreshold = opts.bulkThreshold ?? DEFAULT_BULK_THRESHOLD;
    this.excludePaths = opts.excludePaths;
  }

  /**
   * Full rebuild: reset all indices then mine the full window and fan every
   * event into all three indices.
   */
  async rebuild(): Promise<void> {
    this.#coChange = new CoChangeIndex();
    this.#churn = new ChurnIndex();
    this.#ownership = new OwnershipIndex();
    this.totalCommits = 0;
    this.lastCommitScanned = null;

    const miner = this.createMiner();

    const count = await this.ingestStream(
      miner.stream({
        sinceDays: this.windowDays,
        bulkThreshold: this.bulkThreshold,
        excludePaths: this.excludePaths,
      }),
    );

    this.totalCommits = count;
    this.lastCommitScanned = await this.safeHeadSha(miner);
  }

  /**
   * Incremental update: mine only commits since lastCommitScanned, fan into
   * all three indices, update the head pointer.
   *
   * Falls back to a full rebuild when lastCommitScanned is null.
   */
  async refresh(): Promise<RefreshResult> {
    if (this.lastCommitScanned === null) {
      await this.rebuild();
      return {
        commitsIngested: this.totalCommits,
        newHead: this.lastCommitScanned ?? '',
      };
    }

    const miner = this.createMiner();

    const count = await this.ingestStream(
      miner.stream({
        sinceSha: this.lastCommitScanned,
        bulkThreshold: this.bulkThreshold,
        excludePaths: this.excludePaths,
      }),
    );

    const newHead = await this.safeHeadSha(miner);
    this.totalCommits += count;
    this.lastCommitScanned = newHead;

    return { commitsIngested: count, newHead };
  }

  /**
   * Persist all indices and metadata to `.ctxloom/git-overlay.json`.
   */
  async saveSnapshot(): Promise<void> {
    const sidecarPath = this.sidecarPath();
    await fs.mkdir(path.dirname(sidecarPath), { recursive: true });

    const data: SidecarData = {
      version: 1,
      lastCommitScanned: this.lastCommitScanned,
      commits: this.totalCommits,
      windowDays: this.windowDays,
      coChange: this.#coChange.snapshot(),
      churn: this.#churn.snapshot(),
      ownership: this.#ownership.snapshot(),
    };

    await fs.writeFile(sidecarPath, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * Load state from `.ctxloom/git-overlay.json`.
   * Returns `false` if the file does not exist; `true` on success.
   */
  async loadSnapshot(): Promise<boolean> {
    const sidecarPath = this.sidecarPath();

    let raw: string;
    try {
      raw = await fs.readFile(sidecarPath, 'utf8');
    } catch (err: unknown) {
      if (isEnoent(err)) return false;
      throw err;
    }

    const data = JSON.parse(raw) as SidecarData;

    if (data.version !== 1) {
      throw new Error(`GitOverlayStore: unsupported sidecar version ${data.version}`);
    }

    this.#coChange = CoChangeIndex.load(data.coChange);
    this.#churn = ChurnIndex.load(data.churn);
    this.#ownership = OwnershipIndex.load(data.ownership);
    this.lastCommitScanned = data.lastCommitScanned;
    this.totalCommits = data.commits;

    return true;
  }

  /**
   * Return diagnostic stats for the current store state.
   */
  stats(): { commits: number; lastCommit: string | null; windowDays: number } {
    return {
      commits: this.totalCommits,
      lastCommit: this.lastCommitScanned,
      windowDays: this.windowDays,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private createMiner(): GitHistoryMiner {
    return new GitHistoryMiner(this.repoRoot);
  }

  private sidecarPath(): string {
    return path.join(this.repoRoot, SIDECAR_SUBPATH);
  }

  private async ingestStream(
    stream: AsyncIterable<import('./GitHistoryMiner.js').GitCommitEvent>,
  ): Promise<number> {
    let count = 0;
    for await (const event of stream) {
      this.#coChange.ingest(event);
      this.#churn.ingest(event);
      this.#ownership.ingest(event);
      count++;
    }
    return count;
  }

  private async safeHeadSha(miner: GitHistoryMiner): Promise<string | null> {
    try {
      return await miner.headSha();
    } catch {
      // Empty repo has no HEAD — return null gracefully
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function isEnoent(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
