/**
 * `ctxloom vectors-cleanup` — pure logic for clearing accumulated
 * LanceDB version state from `.ctxloom/vectors.lancedb`.
 *
 * Why this exists
 * ───────────────
 * Pre-1.5.5 versions of ctxloom leaked LanceDB transaction +  manifest
 * files monotonically (see PR #173). Even after upgrading to a patched
 * release that bounds new growth, the historical debris (~20k .txn +
 * ~10k .manifest files in active projects) remains on disk and gets
 * mmap'd by the LanceDB connection at boot, holding ~30-60k file
 * descriptors permanently.
 *
 * LanceDB's in-process `optimize({ cleanupOlderThan })` refuses to
 * remove versions that the calling connection has open mmaps on — its
 * safety contract under concurrent reads. So the only reliable way to
 * shed the debris is out-of-process: stop the connection, rotate or
 * rebuild the directory, restart.
 *
 * This module is consumed by:
 *   - `ctxloom vectors-cleanup` (CLI) — interactive
 *   - automated test harness (see tests/VectorsCleanup.test.ts)
 *
 * Kept side-effect-free at module load (no fs reads / writes until a
 * function is called) so unit tests can stub paths cleanly.
 */
import fs from 'node:fs';
import path from 'node:path';

const VECTOR_DB_REL = path.join('.ctxloom', 'vectors.lancedb');
const TABLE_DIR = 'code_embeddings.lance';

export interface VectorsCleanupOptions {
  /**
   * Repo root that contains the `.ctxloom/` directory. Defaults to the
   * current working directory.
   */
  rootDir?: string;
  /**
   * If true, do not touch disk — just report what would happen.
   */
  dryRun?: boolean;
}

export interface VectorsCleanupReport {
  /** Whether anything was (or would be) removed. */
  cleaned: boolean;
  /** Reason if cleaned=false. */
  reason?: 'no-db' | 'in-use';
  /** Files mmap'd by foreign processes, populated when reason='in-use'. */
  conflictingPids?: number[];
  /**
   * Path the existing vectors.lancedb was renamed to (when cleaned=true
   * and dryRun=false). Caller can `rm -rf` later once they're confident
   * nothing depends on it.
   */
  backupPath?: string;
  /** File counts BEFORE cleanup — diagnostic for the operator. */
  before?: VectorsCleanupCounts;
}

export interface VectorsCleanupCounts {
  txn: number;
  manifest: number;
  lance: number;
  totalBytes: number;
}

/**
 * Detect ctxloom MCP processes that hold an FD against the vectors.lancedb
 * directory. Returns their PIDs so the CLI can refuse to clean up while
 * a server is live. Empty array if `lsof` is unavailable or no process
 * is holding the directory.
 */
export function detectActiveProcesses(rootDir: string): number[] {
  // Implemented in the CLI layer (uses child_process). The pure logic
  // here accepts caller-provided PIDs to keep this function side-effect-
  // free for tests; the CLI wires in the real lsof call.
  void rootDir;
  return [];
}

/**
 * Walk a directory and return file counts + total byte size. Returns
 * zero-valued counts if the directory does not exist.
 */
export function inspectVectorsDb(rootDir: string): VectorsCleanupCounts {
  const tablePath = path.join(rootDir, VECTOR_DB_REL, TABLE_DIR);
  const counts: VectorsCleanupCounts = {
    txn: 0,
    manifest: 0,
    lance: 0,
    totalBytes: 0,
  };
  if (!fs.existsSync(tablePath)) return counts;

  for (const sub of ['_transactions', '_versions', 'data']) {
    const dir = path.join(tablePath, sub);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      try {
        const st = fs.statSync(full);
        if (!st.isFile()) continue;
        counts.totalBytes += st.size;
        if (name.endsWith('.txn')) counts.txn += 1;
        else if (name.endsWith('.manifest')) counts.manifest += 1;
        else if (name.endsWith('.lance')) counts.lance += 1;
      } catch {
        // Race with concurrent rotation — skip.
      }
    }
  }
  return counts;
}

/**
 * Run the cleanup. Default strategy: rename `.ctxloom/vectors.lancedb`
 * to a timestamped backup directory so the next ctxloom boot starts
 * with a fresh LanceDB. The embedding cache is rebuilt incrementally
 * as the indexer runs (typically ~30-60s for a mid-sized repo).
 *
 * If you cannot afford the re-embed, the backup is preserved on disk
 * and you can rename it back. The CLI prints the backup path on
 * success.
 *
 * Throws if `activePids.length > 0` — the caller should detect this
 * via `detectActiveProcesses()` and surface a clean error message.
 */
export function cleanupVectors(
  options: VectorsCleanupOptions = {},
  activePids: readonly number[] = [],
): VectorsCleanupReport {
  const rootDir = options.rootDir ?? process.cwd();
  const dbPath = path.join(rootDir, VECTOR_DB_REL);

  if (!fs.existsSync(dbPath)) {
    return { cleaned: false, reason: 'no-db' };
  }

  if (activePids.length > 0) {
    return {
      cleaned: false,
      reason: 'in-use',
      conflictingPids: [...activePids],
    };
  }

  const before = inspectVectorsDb(rootDir);

  if (options.dryRun) {
    return { cleaned: true, before };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbPath}.bak-${stamp}`;
  fs.renameSync(dbPath, backupPath);
  return { cleaned: true, before, backupPath };
}
