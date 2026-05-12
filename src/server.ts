/**
 * ctxloom MCP Server — Thin wiring layer.
 *
 * All tool logic lives in src/tools/*. This file:
 *   1. Owns the ProjectStateManager (replaces module-level lazy singletons)
 *   2. Builds the ServerContext
 *   3. Wires MCP transport to ToolRegistry
 *   4. Starts the FileWatcher (skipped in no-default mode)
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import path from 'node:path';
import fs from 'node:fs';
import {
  PathValidator,
  VectorStore,
  generateEmbedding,
  DependencyGraph,
  ASTParser,
  Skeletonizer,
  FileWatcher,
  RuleManager,
  GitOverlayStore,
  logger,
  createToolRegistry,
  recordTrendSnapshot,
} from '@ctxloom/core';
import type { ServerContext } from '@ctxloom/core';
import {
  ProjectStateManager,
  ProjectState,
  resolveProjectRoot as resolveRoot,
  validateDefaultRoot,
  RepoRegistry,
} from '@ctxloom/core';

// ─── Server startup options ──────────────────────────────────────────────────

export interface ServerOptions {
  /** Enable git overlay (default: true). */
  withGit?: boolean;
  /** How far back to mine git history in days (default: 365). */
  gitWindowDays?: number;
}

const PROJECT_ROOT = (() => {
  if (process.env.CTXLOOM_ROOT) return process.env.CTXLOOM_ROOT;
  const cwd = process.cwd();
  // The "Set CTXLOOM_ROOT in your MCP server config" guidance only makes
  // sense when running as the MCP server. During CLI commands (index,
  // status, dashboard, etc.) the warning is misleading noise — the user
  // explicitly ran the command in the directory they want indexed.
  //
  // Detect CLI mode from process.argv (not an env var) because ESM
  // import hoisting runs this IIFE before the entry point can set any
  // env var. Bare `ctxloom` (argv.length === 2) is the MCP server.
  const isCli = process.argv.length > 2;
  if (!isCli) {
    logger.warn(
      'CTXLOOM_ROOT not set — defaulting to cwd. ' +
      'Set CTXLOOM_ROOT in your MCP server config to point at the project you want to index.',
      { cwd },
    );
  }
  return cwd;
})();
// ─── State manager (replaces module-level lazy singletons) ───────────────

const DISABLE_MULTIPROJECT = process.env.CTXLOOM_DISABLE_MULTIPROJECT === '1';
const MAX_PROJECTS = (() => {
  const v = Number(process.env.CTXLOOM_MAX_PROJECTS ?? '');
  return Number.isFinite(v) && v >= 1 ? v : 5;
})();

const repoRegistryPath = path.join(
  process.env.HOME ?? process.env.USERPROFILE ?? '',
  '.ctxloom',
  'repos.json',
);

const stateManager = new ProjectStateManager({
  maxProjects: DISABLE_MULTIPROJECT ? 1 : MAX_PROJECTS,
});

// Lazy helpers — each one inits the corresponding field on the project state.
async function initStore(state: ProjectState): Promise<VectorStore> {
  if (!state.storePromise) {
    state.storePromise = (async () => {
      const s = new VectorStore(state.dbPath);
      await s.init();
      return s;
    })();
  }
  return state.storePromise;
}

async function initParser(state: ProjectState): Promise<ASTParser> {
  if (!state.parserPromise) {
    state.parserPromise = (async () => {
      const p = new ASTParser();
      await p.init();
      return p;
    })();
  }
  return state.parserPromise;
}

async function initGraph(state: ProjectState): Promise<DependencyGraph> {
  if (!state.graphPromise) {
    state.graphPromise = (async () => {
      const parser = await initParser(state);
      const graph = new DependencyGraph();
      graph.setParser(parser);
      await graph.buildFromDirectory(state.projectRoot);
      state.graphInitialized = true;
      return graph;
    })();
  }
  return state.graphPromise;
}

async function initSkeletonizer(state: ProjectState): Promise<Skeletonizer> {
  if (!state.skeletonizerPromise) {
    state.skeletonizerPromise = (async () => {
      const sk = new Skeletonizer();
      await sk.init();
      return sk;
    })();
  }
  return state.skeletonizerPromise;
}

function buildContext(defaultRoot: string | null, noDefaultMode: boolean): ServerContext {
  const repoRegistry = new RepoRegistry(repoRegistryPath);

  function resolveOrDefault(arg: string | undefined): ProjectState {
    if (DISABLE_MULTIPROJECT) {
      if (!defaultRoot) {
        throw new Error('CTXLOOM_DISABLE_MULTIPROJECT=1 but server has no default root.');
      }
      return stateManager.get(defaultRoot);
    }
    if (arg === undefined) {
      if (!defaultRoot) {
        throw new Error('no_default_project'); // converted to structured error at tool layer (Phase 6)
      }
      return stateManager.get(defaultRoot);
    }
    const outcome = resolveRoot({
      arg,
      env: process.env.CTXLOOM_ROOT,
      cwd: process.cwd(),
      registry: repoRegistry,
    });
    if (outcome.kind !== 'ok') {
      throw new Error(JSON.stringify(outcome));
    }
    return stateManager.get(outcome.root);
  }

  const ctx: ServerContext = {
    projectRoot: defaultRoot ?? '',
    dbPath: defaultRoot ? path.join(defaultRoot, '.ctxloom', 'vectors.lancedb') : '',
    noDefaultMode,
    registry: repoRegistry,
    stateManager,
    getStore: (root) => initStore(resolveOrDefault(root)),
    getGraph: (root) => initGraph(resolveOrDefault(root)),
    getParser: (root) => initParser(resolveOrDefault(root)),
    getSkeletonizer: (root) => initSkeletonizer(resolveOrDefault(root)),
    getRuleManager: (root) => {
      const state = resolveOrDefault(root);
      if (!state.ruleManager) {
        state.ruleManager = new RuleManager(state.projectRoot, ctx.getPathValidator(state.projectRoot));
      }
      return state.ruleManager;
    },
    getPathValidator: (root) => {
      const state = resolveOrDefault(root);
      if (!state.pathValidator) {
        state.pathValidator = new PathValidator(state.projectRoot);
      }
      return state.pathValidator;
    },
    isStoreInitialized: () => {
      if (!defaultRoot) return false;
      const state = stateManager.has(defaultRoot) ? stateManager.get(defaultRoot) : null;
      if (state?.storePromise) return true;
      return fs.existsSync(path.join(defaultRoot, '.ctxloom', 'vectors.lancedb', 'code_embeddings.lance'));
    },
    isGraphInitialized: () => {
      if (!defaultRoot) return false;
      const state = stateManager.has(defaultRoot) ? stateManager.get(defaultRoot) : null;
      return state?.graphInitialized ?? false;
    },
    isParserInitialized: () => {
      if (!defaultRoot) return false;
      const state = stateManager.has(defaultRoot) ? stateManager.get(defaultRoot) : null;
      return !!state?.parserPromise;
    },
  };
  return ctx;
}

// ─── Server factory ─────────────────────────────────────────────────────────
export function createServer(): { server: Server; ctx: ServerContext } {
  const server = new Server({ name: 'ctxloom', version: '1.0.0' }, { capabilities: { tools: {} } });
  // Validate the default-root candidate. If validation fails, server runs
  // in no-default mode: tool calls without project_root return the
  // no_default_project structured error.
  const candidateDefault = PROJECT_ROOT;
  const isValidDefault = validateDefaultRoot(candidateDefault);
  if (!isValidDefault) {
    logger.warn(
      'No valid default project detected — server entering no-default mode. ' +
      'All tool calls require explicit project_root.',
      { attempted: candidateDefault },
    );
  }
  const defaultRoot = isValidDefault ? candidateDefault : null;
  if (defaultRoot) stateManager.pin(defaultRoot);
  const ctx = buildContext(defaultRoot, !isValidDefault);
  const registry = createToolRegistry(ctx);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: registry.list() }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params: { name, arguments: args } }) => {
    try {
      const text = await registry.dispatch(name, args);
      return { content: [{ type: 'text' as const, text }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  });

  return { server, ctx };
}

// ─── Server startup ──────────────────────────────────────────────────────────
export async function startServer(opts: ServerOptions = {}): Promise<void> {
  const withGit = opts.withGit ?? true;
  const gitWindowDays = opts.gitWindowDays ?? 365;

  const { server, ctx } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('MCP Server started on Stdio transport');
  logger.info('Project root', { root: PROJECT_ROOT });

  // Report the effective FD soft limit so users can correlate EMFILE
  // errors with their environment. Node lacks getrlimit, so we shell out
  // once to `ulimit -n`. Best-effort — never throws.
  //
  // The bin/ctxloom.cjs wrapper bumps the soft limit to 65536 before
  // Node starts (macOS launchctl default is 256, which exhausts within
  // ~20 MCP tool calls). Seeing `nofileSoft < 4096` here means either
  // the wrapper was bypassed (CTXLOOM_SKIP_FD_BUMP=1, direct `node
  // dist/index.js`, or a shell that ignored the ulimit) — emit a clear
  // warning instead of letting the user discover it via EMFILE later.
  try {
    const { execSync } = await import('node:child_process');
    const nofileSoft = Number(execSync('ulimit -n', { shell: '/bin/sh' }).toString().trim());
    if (Number.isFinite(nofileSoft)) {
      const FD_WARN_THRESHOLD = 4096;
      if (nofileSoft < FD_WARN_THRESHOLD) {
        logger.warn(
          'Low file-descriptor soft limit — EMFILE likely after ~20 tool calls. ' +
            'Run via `bin/ctxloom.cjs` (default bin) which bumps to 65536, ' +
            'or set `ulimit -n 65536` in your shell before launching.',
          { nofileSoft, threshold: FD_WARN_THRESHOLD },
        );
      } else {
        logger.info('FD soft limit', { nofileSoft });
      }
    }
  } catch {
    /* best-effort; ulimit not available on this platform */
  }

  if (!ctx.noDefaultMode) {
    Promise.all([ctx.getGraph(), generateEmbedding('warmup')]).then(async ([graph]) => {
      logger.info('Ready', { edges: graph.edgeCount() });

      if (withGit) {
        try {
          const overlay = new GitOverlayStore(PROJECT_ROOT, { windowDays: gitWindowDays });
          const loaded = await overlay.loadSnapshot();
          if (!loaded) {
            await overlay.rebuild();
          } else {
            await overlay.refresh();
          }
          await overlay.saveSnapshot();
          ctx.overlay = overlay;
          try {
            await recordTrendSnapshot({
              graph,
              overlay,
              gitEnabled: true,
              rootDir: PROJECT_ROOT,
              source: 'mcp',
            });
          } catch (err) {
            logger.warn('initial mcp trend record failed', { detail: String(err) });
          }
          logger.info('Git overlay ready', { commits: overlay.stats().commits });
        } catch (err) {
          logger.warn('Git overlay bootstrap failed — overlay disabled', { detail: String(err) });
        }
      }
    }).catch(err => {
      logger.warn('Initialization warning', { detail: String(err) });
    });
  } else {
    logger.info('Server started in no-default mode — skipping warmup.');
  }

  if (!ctx.noDefaultMode) {
    // Debounce timer for incremental overlay refresh triggered by file changes
    let overlayRefreshTimer: ReturnType<typeof setTimeout> | null = null;

    const watcher = new FileWatcher(PROJECT_ROOT, async (absPath, event) => {
      const pathValidator = ctx.getPathValidator();
      if (!pathValidator.isWithinRoot(absPath)) return;
      const relPath = path.relative(PROJECT_ROOT, absPath);

      if (event === 'unlink') {
        const store = await ctx.getStore();
        await store.remove(relPath);
        try { (await ctx.getGraph()).removeFile(relPath); } catch { /* graph not ready */ }
        return;
      }

      let content: string;
      try { content = fs.readFileSync(absPath, 'utf-8'); if (!content.trim()) return; } catch { return; }

      const basename = path.basename(absPath);
      if (['.cursorrules', 'CLAUDE.md', 'CONTEXT.md', '.ctxloomrc'].includes(basename)) {
        ctx.getRuleManager().invalidateCache();
      }

      try {
        const store = await ctx.getStore();
        const embedding = await generateEmbedding(content.slice(0, 4096));
        await store.upsert(relPath, embedding, content.slice(0, 512));
      } catch (err) {
        logger.error('Failed to re-index', { file: absPath, detail: String(err) });
      }

      try { await (await ctx.getGraph()).updateFile(absPath, PROJECT_ROOT); } catch { /* ok */ }

      // Debounced incremental git overlay refresh (30 s after last file change)
      if (ctx.overlay) {
        if (overlayRefreshTimer) clearTimeout(overlayRefreshTimer);
        overlayRefreshTimer = setTimeout(async () => {
          try {
            await ctx.overlay!.refresh();
            await ctx.overlay!.saveSnapshot();
            logger.debug('Git overlay refreshed incrementally');
          } catch (err) {
            logger.warn('Git overlay refresh failed', { detail: String(err) });
          }
        }, 30_000);
      }

      // Record a trend snapshot after every watcher-driven reindex.
      // The recorder's own throttle collapses rapid successive saves.
      if (ctx.overlay && ctx.isGraphInitialized()) {
        try {
          const graph = await ctx.getGraph();
          await recordTrendSnapshot({
            graph,
            overlay: ctx.overlay,
            gitEnabled: true,
            rootDir: PROJECT_ROOT,
            source: 'watcher',
          });
        } catch (err) {
          logger.warn('watcher trend record failed', { detail: String(err) });
        }
      }
    });

    watcher.start();
    logger.info('File watcher active');
    process.on('SIGINT', () => { if (overlayRefreshTimer) clearTimeout(overlayRefreshTimer); watcher.stop(); process.exit(0); });
    process.on('SIGTERM', () => { if (overlayRefreshTimer) clearTimeout(overlayRefreshTimer); watcher.stop(); process.exit(0); });
  } else {
    process.on('SIGINT', () => process.exit(0));
    process.on('SIGTERM', () => process.exit(0));
  }
}
