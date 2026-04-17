/**
 * GitHistoryMiner
 *
 * Streams typed commit events from `git log --numstat`, providing
 * co-change coupling, churn, and ownership data for the graph layer.
 *
 * Uses simple-git for subprocess management. The git log format uses
 * null-byte field separators and a leading ASCII Record Separator (\x1e)
 * on each commit header so the raw output can be split unambiguously even
 * when author names, emails, or messages contain newlines.
 *
 * Output layout per commit:
 *   \x1e<sha>\x00<author>\x00<email>\x00<timestamp>\x00<subject>\x00<parents>\n
 *   \n
 *   <added>\t<deleted>\t<path>\n
 *   ...
 *
 * Splitting on \x1e gives: ['', record0, record1, ...] where each record
 * starts with the header line followed by a blank line and numstat lines.
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { simpleGit } from 'simple-git';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GitCommitEvent {
  sha: string;
  author: string;
  authorEmail: string;
  /** Unix epoch seconds */
  timestamp: number;
  message: string;
  files: Array<{ path: string; added: number; deleted: number }>;
  isMerge: boolean;
  isBulk: boolean;
}

export interface MinerOptions {
  /** How far back to look. Defaults to 365 days. Ignored when sinceSha is set. */
  sinceDays?: number;
  /** Incremental mode: only yield commits reachable from HEAD but not from this SHA. */
  sinceSha?: string;
  /** Commits touching more files than this threshold are flagged isBulk. Default 50. */
  bulkThreshold?: number;
  /** File path prefixes to exclude from the files array. */
  excludePaths?: string[];
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const DEFAULT_SINCE_DAYS = 365;
const DEFAULT_BULK_THRESHOLD = 50;
const DEFAULT_EXCLUDE_PATHS = ['node_modules/', 'dist/', '.ctxloom/'];

/**
 * The format prepends \x1e (ASCII Record Separator) before each commit header.
 * With --numstat, git emits:
 *   \x1e<sha>\x00<an>\x00<ae>\x00<at>\x00<s>\x00<P>\n\n<numstat lines>
 *
 * Splitting the full output on \x1e gives one segment per commit.
 * (The first element of the split will be an empty string.)
 */
const LOG_FORMAT = '%x1e%H%x00%an%x00%ae%x00%at%x00%s%x00%P';

/** The byte value used as a start-of-record sentinel. */
const RECORD_SEPARATOR = '\x1e';

// ---------------------------------------------------------------------------
// GitHistoryMiner
// ---------------------------------------------------------------------------

export class GitHistoryMiner {
  constructor(private readonly repoRoot: string) {}

  /**
   * Stream commit events from newest to oldest.
   *
   * The generator yields one GitCommitEvent per non-empty commit. Binary
   * files (numstat shows `-\t-\t<path>`) are skipped. Files matching any
   * excludePaths prefix are omitted from the files array.
   */
  async *stream(opts?: MinerOptions): AsyncIterable<GitCommitEvent> {
    if (opts?.sinceSha !== undefined && !/^[0-9a-f]{40}$/i.test(opts.sinceSha)) {
      throw new Error(
        `GitHistoryMiner: invalid sinceSha — expected 40-char hex SHA, got: ${opts.sinceSha}`,
      );
    }

    const bulkThreshold = opts?.bulkThreshold ?? DEFAULT_BULK_THRESHOLD;
    const excludePaths = opts?.excludePaths ?? DEFAULT_EXCLUDE_PATHS;

    const logArgs = this.buildLogArgs(opts);

    logger.debug('GitHistoryMiner: running git log', {
      repoRoot: this.repoRoot,
      sinceSha: opts?.sinceSha,
      sinceDays: opts?.sinceDays,
    });

    let buffer: string[] = [];

    for await (const line of this.fetchRawLogStream(logArgs)) {
      if (line.startsWith(RECORD_SEPARATOR)) {
        if (buffer.length > 0) {
          const event = this.parseRecord(
            buffer.join('\n'),
            bulkThreshold,
            excludePaths,
          );
          if (event !== null) yield event;
        }
        // Start fresh buffer — strip the sentinel from the first line.
        buffer = [line.slice(RECORD_SEPARATOR.length)];
      } else {
        buffer.push(line);
      }
    }

    // Flush final record.
    if (buffer.length > 0) {
      const event = this.parseRecord(buffer.join('\n'), bulkThreshold, excludePaths);
      if (event !== null) yield event;
    }
  }

  /** Return the full 40-character SHA of HEAD. */
  async headSha(): Promise<string> {
    const sg = simpleGit(this.repoRoot);
    const result = await sg.revparse(['HEAD']);
    return result.trim();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildLogArgs(opts?: MinerOptions): string[] {
    const logArgs: string[] = [
      `--format=${LOG_FORMAT}`,
      '--numstat',
    ];

    if (opts?.sinceSha) {
      // Incremental: commits reachable from HEAD but not from sinceSha.
      logArgs.push(`${opts.sinceSha}..HEAD`);
    } else {
      const days = opts?.sinceDays ?? DEFAULT_SINCE_DAYS;
      logArgs.push(`--since=${days} days ago`);
    }

    return logArgs;
  }

  private async *fetchRawLogStream(logArgs: string[]): AsyncIterable<string> {
    const child = spawn('git', ['log', ...logArgs], {
      cwd: this.repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });

    const stderrChunks: Buffer[] = [];
    child.stderr!.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    for await (const line of rl) {
      yield line;
    }

    await new Promise<void>((resolve, reject) => {
      child.on('close', (code) => {
        if (code === 0 || code === null) {
          resolve();
        } else {
          const stderr = Buffer.concat(stderrChunks).toString('utf8');
          // Treat known "no commits" errors as an empty stream.
          const knownEmpty =
            /does not have any commits|bad default revision|unknown revision|your current branch/i.test(
              stderr,
            );
          if (knownEmpty) {
            logger.debug('GitHistoryMiner: repo has no commits, returning empty stream');
            resolve();
          } else {
            reject(new Error(`git log exited with code ${code}: ${stderr}`));
          }
        }
      });
      child.on('error', reject);
    });
  }

  private parseRecord(
    record: string,
    bulkThreshold: number,
    excludePaths: string[],
  ): GitCommitEvent | null {
    // Each record has the shape:
    //   <sha>\x00<author>\x00<email>\x00<timestamp>\x00<subject>\x00<parents>\n
    //   \n
    //   <added>\t<deleted>\t<path>\n
    //   ...
    //
    // We find the first \n to extract the null-delimited header, then parse
    // the rest as numstat lines.
    const firstNewline = record.indexOf('\n');
    if (firstNewline === -1) {
      // Header only, no numstat — valid for commits touching 0 files.
      return this.buildEvent(record.trim(), '', bulkThreshold, excludePaths);
    }

    const headerLine = record.slice(0, firstNewline).trimEnd();
    const numstatBlock = record.slice(firstNewline + 1);

    return this.buildEvent(headerLine, numstatBlock, bulkThreshold, excludePaths);
  }

  private buildEvent(
    headerLine: string,
    numstatBlock: string,
    bulkThreshold: number,
    excludePaths: string[],
  ): GitCommitEvent | null {
    // Header: "<sha>\x00<author>\x00<email>\x00<timestamp>\x00<subject>\x00<parents>"
    const fields = headerLine.split('\x00');

    // Require at least 5 fields (parents may be absent for root commits).
    if (fields.length < 5) return null;

    const [sha, author, authorEmail, timestampRaw, message, parentsRaw] = fields;

    if (!sha || sha.length !== 40) return null;

    const timestamp = parseInt(timestampRaw ?? '0', 10);
    if (isNaN(timestamp)) return null;

    const parents = (parentsRaw ?? '').trim().split(/\s+/).filter(Boolean);
    const isMerge = parents.length >= 2;

    const files = this.parseNumstat(numstatBlock, excludePaths);
    const isBulk = files.length > bulkThreshold;

    return {
      sha,
      author: author ?? '',
      authorEmail: authorEmail ?? '',
      timestamp,
      message: message ?? '',
      files,
      isMerge,
      isBulk,
    };
  }

  private parseNumstat(
    block: string,
    excludePaths: string[],
  ): Array<{ path: string; added: number; deleted: number }> {
    const files: Array<{ path: string; added: number; deleted: number }> = [];

    for (const line of block.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // numstat format: "<added>\t<deleted>\t<path>"
      // Binary files use "-" for added/deleted counts — skip them.
      const tabIdx1 = trimmed.indexOf('\t');
      if (tabIdx1 === -1) continue;
      const tabIdx2 = trimmed.indexOf('\t', tabIdx1 + 1);
      if (tabIdx2 === -1) continue;

      const addedRaw = trimmed.slice(0, tabIdx1);
      const deletedRaw = trimmed.slice(tabIdx1 + 1, tabIdx2);
      const filePath = trimmed.slice(tabIdx2 + 1);

      // Skip binary files
      if (addedRaw === '-' || deletedRaw === '-') continue;

      const added = parseInt(addedRaw, 10);
      const deleted = parseInt(deletedRaw, 10);

      if (isNaN(added) || isNaN(deleted)) continue;
      if (!filePath) continue;

      // Skip excluded path prefixes
      if (excludePaths.some((prefix) => filePath.startsWith(prefix))) continue;

      files.push({ path: filePath, added, deleted });
    }

    return files;
  }
}
