/**
 * FileWatcher — Watches the project root for file changes and triggers
 * re-indexing of modified files.
 *
 * Uses chokidar with 200ms debounce per Design Doc.
 * Ignores common non-source directories.
 */
import chokidar, { FSWatcher } from 'chokidar';
import { logger } from '../utils/logger.js';

export type ChangeCallback = (absolutePath: string, event: 'add' | 'change' | 'unlink') => void | Promise<void>;

const IGNORED = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.ctxloom/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.cache/**',
];

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
      .on('error', (err: Error) => {
        // Non-fatal: log and continue. Common on macOS when watching paths like
        // /dev/apfs-raw-device.* where CTXLOOM_ROOT defaults to a system directory.
        logger.warn('FileWatcher: skipping inaccessible path', {
          detail: err.message,
          code: (err as NodeJS.ErrnoException).code ?? 'UNKNOWN',
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
