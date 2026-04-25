/**
 * ctxloom MCP Server — Thin wiring layer.
 *
 * All tool logic lives in src/tools/*. This file:
 *   1. Owns the lazy singletons
 *   2. Builds the ServerContext
 *   3. Wires MCP transport to ToolRegistry
 *   4. Starts the FileWatcher
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
  logger.warn(
    'CTXLOOM_ROOT not set — defaulting to cwd. ' +
    'Set CTXLOOM_ROOT in your MCP server config to point at the project you want to index.',
    { cwd }
  );
  return cwd;
})();
const DB_PATH = path.join(PROJECT_ROOT, '.ctxloom', 'vectors.lancedb');

// ─── Lazy singletons ────────────────────────────────────────────────────────
let _pathValidator: PathValidator | null = null;
let _storePromise: Promise<VectorStore> | null = null;
let _parserPromise: Promise<ASTParser> | null = null;
let _graphPromise: Promise<DependencyGraph> | null = null;
let _skeletonizerPromise: Promise<Skeletonizer> | null = null;
let _ruleManager: RuleManager | null = null;

function buildContext(): ServerContext {
  const ctx: ServerContext = {
    projectRoot: PROJECT_ROOT,
    dbPath: DB_PATH,
    getPathValidator() {
      if (!_pathValidator) _pathValidator = new PathValidator(PROJECT_ROOT);
      return _pathValidator;
    },
    getStore() {
      if (!_storePromise) {
        _storePromise = (async () => { const s = new VectorStore(DB_PATH); await s.init(); return s; })();
      }
      return _storePromise;
    },
    getParser() {
      if (!_parserPromise) {
        _parserPromise = (async () => { const p = new ASTParser(); await p.init(); return p; })();
      }
      return _parserPromise;
    },
    getGraph() {
      if (!_graphPromise) {
        _graphPromise = (async () => {
          const parser = await ctx.getParser();
          const graph = new DependencyGraph();
          graph.setParser(parser);
          await graph.buildFromDirectory(PROJECT_ROOT, {
            afterReady: async () => {
              const overlay = ctx.overlay;
              if (overlay) {
                await recordTrendSnapshot({
                  graph,
                  overlay,
                  gitEnabled: true,
                  rootDir: PROJECT_ROOT,
                  source: 'mcp',
                });
              }
            },
          });
          return graph;
        })();
      }
      return _graphPromise;
    },
    getSkeletonizer() {
      if (!_skeletonizerPromise) {
        _skeletonizerPromise = (async () => { const sk = new Skeletonizer(); await sk.init(); return sk; })();
      }
      return _skeletonizerPromise;
    },
    getRuleManager() {
      if (!_ruleManager) _ruleManager = new RuleManager(PROJECT_ROOT, ctx.getPathValidator());
      return _ruleManager;
    },
    isStoreInitialized: () => _storePromise !== null,
    isGraphInitialized: () => _graphPromise !== null,
    isParserInitialized: () => _parserPromise !== null,
  };
  return ctx;
}

// ─── Server factory ─────────────────────────────────────────────────────────
export function createServer(): { server: Server; ctx: ServerContext } {
  const server = new Server({ name: 'ctxloom', version: '1.0.0' }, { capabilities: { tools: {} } });
  const ctx = buildContext();
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
        logger.info('Git overlay ready', { commits: overlay.stats().commits });
      } catch (err) {
        logger.warn('Git overlay bootstrap failed — overlay disabled', { detail: String(err) });
      }
    }
  }).catch(err => {
    logger.warn('Initialization warning', { detail: String(err) });
  });

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
}
