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
import os from 'node:os';
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
  ensureVectorsInitialized,
  resolveProjectRoot as resolveRoot,
  validateDefaultRoot,
  RepoRegistry,
  noDefaultProjectError,
  projectRootNotFoundError,
  aliasNotFoundError,
  FirstTouchTracker,
  wrapWithIndexingEnvelope,
  track,
  captureError,
  hashProjectRoot,
  EmittedOnceTracker,
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

const firstTouchTracker = new FirstTouchTracker();
const emittedOnceTracker = new EmittedOnceTracker();

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

type ResolutionSource = 'alias' | 'arg-path' | 'env' | 'cwd';

function classifyResolutionSource(arg: string | undefined, env: string | undefined): ResolutionSource {
  if (arg !== undefined) {
    return /[/\\~]|^[A-Za-z]:/.test(arg) ? 'arg-path' : 'alias';
  }
  return env ? 'env' : 'cwd';
}

function buildContext(
  defaultRoot: string | null,
  noDefaultMode: boolean,
): { ctx: ServerContext; resolveOrDefault: (arg: string | undefined) => ProjectState } {
  const repoRegistry = new RepoRegistry(repoRegistryPath);

  function resolveOrDefault(arg: string | undefined): ProjectState {
    let state: ProjectState;
    let source: ResolutionSource;

    if (DISABLE_MULTIPROJECT) {
      if (!defaultRoot) {
        throw new Error('CTXLOOM_DISABLE_MULTIPROJECT=1 but server has no default root.');
      }
      state = stateManager.get(defaultRoot);
      source = 'env';
    } else if (arg === undefined) {
      if (!defaultRoot) {
        throw new Error('no_default_project');
      }
      state = stateManager.get(defaultRoot);
      source = classifyResolutionSource(undefined, process.env.CTXLOOM_ROOT);
    } else {
      const outcome = resolveRoot({
        arg,
        env: process.env.CTXLOOM_ROOT,
        cwd: process.cwd(),
        registry: repoRegistry,
      });
      if (outcome.kind !== 'ok') {
        throw new Error(JSON.stringify(outcome));
      }
      state = stateManager.get(outcome.root);
      source = classifyResolutionSource(arg, process.env.CTXLOOM_ROOT);
    }

    try {
      const projectId = hashProjectRoot(state.projectRoot);
      if (emittedOnceTracker.markAndCheck(`project_resolved:${projectId}`)) {
        track('project_resolved', os.hostname(), {
          project_id: projectId,
          source,
          via_alias: source === 'alias',
        });
      }
      if (
        stateManager.size() >= 2 &&
        emittedOnceTracker.markAndCheck('multi_project_active')
      ) {
        track('multi_project_active', os.hostname(), {
          active_count: stateManager.size(),
          cap: stateManager.max,
        });
      }
    } catch {
      // Telemetry must never break the resolver.
    }

    return state;
  }

  const ctx: ServerContext = {
    projectRoot: defaultRoot ?? '',
    dbPath: defaultRoot ? path.join(defaultRoot, '.ctxloom', 'vectors.lancedb') : '',
    noDefaultMode,
    registry: repoRegistry,
    stateManager,
    getStore: async (root) => {
      const state = resolveOrDefault(root);
      const store = await initStore(state);
      await ensureVectorsInitialized(state);
      return store;
    },
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
  return { ctx, resolveOrDefault };
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
  const { ctx, resolveOrDefault } = buildContext(defaultRoot, !isValidDefault);
  const registry = createToolRegistry(ctx);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: registry.list() }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params: { name, arguments: args } }) => {
    try {
      const started = Date.now();
      const text = await registry.dispatch(name, args);
      const durationMs = Date.now() - started;

      // First-touch envelope: prepend <ctxloom_indexing /> on the first call
      // for a given (project_root, tier) pair so the caller knows indexing was
      // triggered. Graph tier takes priority; vectors tier fires on the first
      // call that touched getStore() for this root. Skip if noDefaultMode and
      // no project_root given.
      const projectRootArg = (args as Record<string, unknown> | undefined)?.project_root as string | undefined;
      if (!ctx.noDefaultMode || projectRootArg !== undefined) {
        try {
          const state = resolveOrDefault(projectRootArg);
          const root = state.projectRoot;
          const graphFirstTouch = firstTouchTracker.markAndCheck(root, 'graph');
          if (graphFirstTouch) {
            try {
              const graphInst = state.graphPromise ? await state.graphPromise : null;
              track('project_first_touch', os.hostname(), {
                project_id: hashProjectRoot(root),
                tier: 'graph',
                duration_ms: durationMs,
                nodes: graphInst?.nodeCount?.() ?? null,
                edges: graphInst?.edgeCount?.() ?? null,
              });
            } catch {
              // Telemetry must never break the response.
            }
            const wrapped = wrapWithIndexingEnvelope(
              { firstTouch: true, projectRoot: root, tier: 'graph', durationMs },
              text,
            );
            return { content: [{ type: 'text' as const, text: wrapped }] };
          }
          // Check vectors tier: only fires if getStore() was called during this
          // dispatch (vectorsInitialized flipped to true) and this is the first
          // such call for the root.
          if (state.vectorsInitialized) {
            const vectorsFirstTouch = firstTouchTracker.markAndCheck(root, 'vectors');
            if (vectorsFirstTouch) {
              track('project_first_touch', os.hostname(), {
                project_id: hashProjectRoot(root),
                tier: 'vectors',
                duration_ms: durationMs,
              });
              const wrapped = wrapWithIndexingEnvelope(
                { firstTouch: true, projectRoot: root, tier: 'vectors', durationMs },
                text,
              );
              return { content: [{ type: 'text' as const, text: wrapped }] };
            }
          }
        } catch {
          // resolveOrDefault threw (e.g. alias not found) — error path below
          // handles structured errors; fall through to normal response here
          // since dispatch already succeeded.
        }
      }

      if (Math.random() < 0.25) {
        try {
          const projectRootArg2 = (args as Record<string, unknown> | undefined)?.project_root as string | undefined;
          if (!ctx.noDefaultMode || projectRootArg2 !== undefined) {
            const sampleState = resolveOrDefault(projectRootArg2);
            track('tool_dispatched', os.hostname(), {
              project_id: hashProjectRoot(sampleState.projectRoot),
              tool: name,
              duration_ms: durationMs,
            });
          }
        } catch {
          /* skip sample on resolution error */
        }
      }

      return { content: [{ type: 'text' as const, text }] };
    } catch (err) {
      if (err instanceof Error && err.message === 'no_default_project') {
        const xml = noDefaultProjectError({
          attemptedRoot: PROJECT_ROOT,
          resolutionChain: 'CTXLOOM_ROOT env var→unset, fallback_cwd→' + PROJECT_ROOT,
          registeredAliases: ctx.registry.list().map((r) => r.alias ?? r.name),
        });
        return { content: [{ type: 'text' as const, text: xml }], isError: true };
      }
      if (err instanceof Error && err.message.startsWith('{')) {
        try {
          const parsed = JSON.parse(err.message) as Record<string, unknown>;
          if (parsed.kind === 'alias_not_found') {
            const xml = aliasNotFoundError({
              alias: String(parsed.alias ?? ''),
              didYouMean: Array.isArray(parsed.didYouMean) ? (parsed.didYouMean as string[]) : [],
            });
            return { content: [{ type: 'text' as const, text: xml }], isError: true };
          }
          if (parsed.kind === 'project_root_not_found') {
            const xml = projectRootNotFoundError({
              path: String(parsed.attemptedPath ?? ''),
              resolutionChain: String(parsed.resolutionChain ?? ''),
            });
            return { content: [{ type: 'text' as const, text: xml }], isError: true };
          }
        } catch {
          // JSON.parse failed — fall through to generic error
        }
      }
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

  if (DISABLE_MULTIPROJECT) {
    logger.warn(
      '[DEPRECATED] CTXLOOM_DISABLE_MULTIPROJECT=1 is set — multi-project support is disabled. ' +
      'maxProjects is capped at 1 and project_root arguments are ignored. ' +
      'This kill switch will be removed in a future release.',
    );
    track('kill_switch_active', os.hostname(), { cap: 1 });
  }

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
