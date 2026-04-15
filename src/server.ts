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
import { PathValidator } from './security/PathValidator.js';
import { VectorStore } from './db/VectorStore.js';
import { generateEmbedding } from './indexer/embedder.js';
import { DependencyGraph } from './graph/DependencyGraph.js';
import { ASTParser } from './ast/ASTParser.js';
import { Skeletonizer } from './ast/Skeletonizer.js';
import { FileWatcher } from './watcher/FileWatcher.js';
import { RuleManager } from './tools/ruleManager.js';
import { logger } from './utils/logger.js';
import { createToolRegistry } from './tools/index.js';
import type { ServerContext } from './tools/context.js';

const PROJECT_ROOT = process.env.CTXLOOM_ROOT ?? process.cwd();
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
          await graph.buildFromDirectory(PROJECT_ROOT);
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
  };
  return ctx;
}

// ─── Server factory ─────────────────────────────────────────────────────────
export function createServer(): Server {
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

  return server;
}

// ─── Server startup ──────────────────────────────────────────────────────────
export async function startServer(): Promise<void> {
  const server = createServer();
  const ctx = buildContext();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('MCP Server started on Stdio transport');
  logger.info('Project root', { root: PROJECT_ROOT });

  Promise.all([ctx.getGraph(), generateEmbedding('warmup')]).then(([graph]) => {
    logger.info('Ready', { edges: graph.edgeCount() });
  }).catch(err => {
    logger.warn('Initialization warning', { detail: String(err) });
  });

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
  });

  watcher.start();
  logger.info('File watcher active');
  process.on('SIGINT', () => { watcher.stop(); process.exit(0); });
  process.on('SIGTERM', () => { watcher.stop(); process.exit(0); });
}
