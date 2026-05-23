/**
 * FileWatcher — Watches the project root for file changes and triggers
 * re-indexing of modified files.
 *
 * Uses chokidar with 200ms debounce per Design Doc.
 * Ignores common non-source directories.
 */
import chokidar, { FSWatcher } from 'chokidar';
import { INDEXER_IGNORED_DIRS, isIgnoredDir } from '../indexer/embedder.js';
import { logger } from '../utils/logger.js';

export type ChangeCallback = (absolutePath: string, event: 'add' | 'change' | 'unlink') => void | Promise<void>;

/**
 * Chokidar ignore predicate derived from the SAME ignore set the indexer
 * uses (see embedder.ts:INDEXER_IGNORED_DIRS). Pre-fix this list was
 * maintained separately AS GLOB PATTERNS and silently drifted — entries
 * like `target` (Rust), `out` (Next.js export), `.turbo`, `.nuxt`,
 * `.vscode-test`, `.code-review-graph`, and `.claude` were ignored by
 * the indexer but NOT by the watcher. On any repo that contained them
 * (a single `.vscode-test/Visual Studio Code.app/...` tree, or another
 * tool's working state at `.code-review-graph/` with worktree copies
 * of the user's source), chokidar opened thousands of FDs to watch
 * directories the indexer never touched — pushing the MCP server past
 * the macOS 256-FD default at boot and causing the "secondary
 * node_modules-walk leak" tracked under task #13.
 *
 * Using a function (not glob patterns) over the shared set:
 *   1. Eliminates glob-escape / path-normalization edge cases where
 *      `**\/node_modules/**` failed to match paths chokidar normalized
 *      without the leading separator (observed in regression tests).
 *   2. Stays in lockstep with the indexer's set — adding a dir to
 *      INDEXER_IGNORED_DIRS automatically updates the watcher.
 *
 * The path segment check is exact (no substring match) so a dir
 * literally named `node_modules` is ignored at any depth, but a file
 * named `node_modules.json` is NOT.
 */
function isIgnoredPath(absPath: string): boolean {
  const segments = absPath.split(/[\\/]/);
  for (const seg of segments) {
    // isIgnoredDir handles exact-match (INDEXER_IGNORED_DIRS) AND
    // suffix patterns like `*.egg-info` / `*.dist-info` — using it
    // here keeps watcher behavior in lockstep with the indexer walker
    // so a Python project's `easymoney.egg-info/` isn't watched but
    // silently re-indexed (or vice versa).
    if (isIgnoredDir(seg)) return true;
  }
  return false;
}
// Re-export to satisfy the existing INDEXER_IGNORED_DIRS-only import
// path; the doc-only reference is preserved for IDE jump-to-definition.
void INDEXER_IGNORED_DIRS;
const IGNORED = isIgnoredPath;

export class FileWatcher {
  private root: string;
  private onChange: ChangeCallback;
  private watcher: FSWatcher | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private debounceMs: number;
  private readyPromise: Promise<void> | null = null;

  constructor(root: string, onChange: ChangeCallback, debounceMs: number = 200) {
    this.root = root;
    this.onChange = onChange;
    this.debounceMs = debounceMs;
  }

  start(): void {
    this.watcher = chokidar.watch(this.root, {
      ignored: IGNORED,
      persistent: true,
      ignoreInitial: true,
    });

    this.readyPromise = new Promise<void>(resolve => {
      this.watcher!.on('ready', resolve);
    });

    const handler = (event: 'add' | 'change' | 'unlink') => (filePath: string) => {
      // Only watch source files
      if (!this.isSourceFile(filePath)) return;

      const existing = this.debounceTimers.get(filePath);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        this.debounceTimers.delete(filePath);
        const result = this.onChange(filePath, event);
        if (result instanceof Promise) {
          result.catch(err => {
            // L-2: Use structured logger instead of console.error
            logger.error('FileWatcher callback error', {
              file: filePath,
              detail: err instanceof Error ? err.message : String(err),
            });
          });
        }
      }, this.debounceMs);

      this.debounceTimers.set(filePath, timer);
    };

    this.watcher
      .on('add', handler('add'))
      .on('change', handler('change'))
      .on('unlink', handler('unlink'))
      .on('error', (err: unknown) => {
        // Non-fatal: log and continue. Common on macOS when watching paths like
        // /dev/apfs-raw-device.* where CTXLOOM_ROOT defaults to a system directory.
        const e = err instanceof Error ? err : new Error(String(err));
        logger.warn('FileWatcher: skipping inaccessible path', {
          detail: e.message,
          code: (e as NodeJS.ErrnoException).code ?? 'UNKNOWN',
        });
      });
  }

  /** Resolves once chokidar has finished its initial scan and is ready to receive events. */
  ready(): Promise<void> {
    return this.readyPromise ?? Promise.resolve();
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    this.debounceTimers.forEach(clearTimeout);
    this.debounceTimers.clear();
  }

  isRunning(): boolean {
    return this.watcher !== null;
  }

  private isSourceFile(filePath: string): boolean {
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    return ['ts', 'tsx', 'js', 'jsx', 'mjs', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h'].includes(ext);
  }
}
