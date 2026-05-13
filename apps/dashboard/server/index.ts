import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadContext, reloadContext } from './loader.js';
import { buildOverviewRouter } from './routes/overview.js';
import { buildGraphRouter } from './routes/graph.js';
import { buildRiskRouter } from './routes/risk.js';
import { buildCommunitiesRouter } from './routes/communities.js';
import { buildChurnRouter } from './routes/churn.js';
import { buildOwnershipRouter } from './routes/ownership.js';
import { buildFileRouter } from './routes/file.js';
import { buildOpenRouter } from './routes/open.js';
import { buildTokensRouter } from './routes/tokens.js';
import { buildTrendsRouter } from './routes/trends.js';
import { buildFileTrendsRouter } from './routes/file-trends.js';
import { buildProjectsRouter } from './routes/projects.js';
import { buildTelemetryRouter } from './routes/telemetry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function startDashboard(options: {
  root: string;
  port: number;
  open: boolean;
}): Promise<void> {
  const { root, port, open } = options;

  console.log(`ctxloom dashboard — loading context from ${root}...`);
  const ctx = await loadContext(root);
  console.log(`  ${ctx.graph.allFiles().length} files, ${ctx.graph.edgeCount()} edges, git=${ctx.gitEnabled}`);

  const app = express();
  // SECURITY: bind CORS to this dashboard's own localhost origin only.
  // The previous `cors()` (no config) allowed any origin, which combined
  // with /api/open (now hardened) and /api/file would let any random
  // browser tab read the user's source or open arbitrary editors.
  // The dashboard SPA is served from the same origin so CORS is largely
  // belt-and-suspenders; but explicit lockdown beats default-permissive.
  const allowedOrigins = new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]);
  app.use(cors({
    origin: (origin, cb) => {
      // Same-origin requests don't carry an Origin header; allow them.
      if (!origin) return cb(null, true);
      cb(null, allowedOrigins.has(origin));
    },
    credentials: false,
  }));
  app.use(express.json());

  app.use('/api/overview', buildOverviewRouter(ctx));
  app.use('/api/graph', buildGraphRouter(ctx));
  app.use('/api/risk', buildRiskRouter(ctx));
  app.use('/api/communities', buildCommunitiesRouter(ctx));
  app.use('/api/churn', buildChurnRouter(ctx));
  app.use('/api/ownership', buildOwnershipRouter(ctx));
  app.use('/api/file', buildFileRouter(ctx));
  app.use('/api/open', buildOpenRouter(ctx));
  app.use('/api/tokens', buildTokensRouter(ctx));
  app.use('/api/trends', buildTrendsRouter(ctx));
  app.use('/api/trends', buildFileTrendsRouter(ctx));
  // /api/projects is wired further down — it needs the watcher
  // re-attach hook (`attachWatcher`), which is defined later in this
  // function. We attach the route after the watcher helper exists.

  // SECURITY: do NOT expose the absolute project root in /api/health.
  // Cross-origin pages on the same host could probe this endpoint to
  // learn the user's filesystem layout. Keep the response minimal.
  app.get('/api/health', (_req, res) => res.json({ ok: true, gitEnabled: ctx.gitEnabled }));

  app.get('/api/status', (_req, res) => res.json({
    lastIndexed: ctx.lastIndexed.toISOString(),
    fileCount: ctx.graph.allFiles().length,
    gitEnabled: ctx.gitEnabled,
  }));

  let reloading = false;
  app.post('/api/refresh', async (_req, res) => {
    if (reloading) return res.status(409).json({ error: 'reload already in progress' });
    reloading = true;
    try {
      console.log('[dashboard] manual refresh triggered');
      await reloadContext(ctx);
      console.log(`[dashboard] reloaded — ${ctx.graph.allFiles().length} files`);
      res.json({ ok: true, lastIndexed: ctx.lastIndexed.toISOString(), fileCount: ctx.graph.allFiles().length });
    } finally {
      reloading = false;
    }
  });

  // Watch .ctxloom/ for snapshot changes and auto-reload. Refactored
  // into a re-attachable helper so the multi-project switcher can
  // tear down the old watcher and arm a new one when the active
  // project changes — without leaking watchers across switches.
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let activeWatcher: fs.FSWatcher | null = null;

  function attachSnapshotWatcher(targetRoot: string): void {
    if (activeWatcher) {
      try { activeWatcher.close(); } catch { /* ignore */ }
      activeWatcher = null;
    }
    const snapshotDir = path.join(targetRoot, '.ctxloom');
    try {
      activeWatcher = fs.watch(snapshotDir, (_event, filename) => {
        if (!filename || !filename.includes('snapshot')) return;
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(async () => {
          if (reloading) return;
          reloading = true;
          try {
            console.log(`[dashboard] ${filename} changed, reloading…`);
            await reloadContext(ctx);
            console.log(`[dashboard] auto-reload done — ${ctx.graph.allFiles().length} files`);
          } finally {
            reloading = false;
          }
        }, 500);
      });
    } catch {
      // .ctxloom may not exist yet — watcher skipped. The user can still
      // hit /api/refresh to force a reindex.
    }
  }

  attachSnapshotWatcher(ctx.root);

  app.use('/api/telemetry', buildTelemetryRouter());
  app.use('/api/projects', buildProjectsRouter({
    ctx,
    defaultRoot: root,
    onActiveChanged: async (newRoot) => {
      console.log(`[dashboard] switched active project → ${newRoot}`);
      console.log(`  ${ctx.graph.allFiles().length} files, ${ctx.graph.edgeCount()} edges, git=${ctx.gitEnabled}`);
      attachSnapshotWatcher(newRoot);
    },
  }));

  // Compiled server lives at apps/dashboard/dist/server/index.js, so
  // __dirname is …/dist/server. Vite outputs the client bundle to
  // …/dist/dashboard/client (vite root='client', outDir='../dist/dashboard/client').
  // Resolving from __dirname therefore needs '../dashboard/client', NOT
  // '../dist/dashboard/client' — the leading dist/ would double the segment
  // and produce dist/dist/dashboard/client (the v1.0.10–1.0.12 ENOENT bug).
  const clientDist = path.join(__dirname, '../dashboard/client');
  const clientDistExists = fs.existsSync(path.join(clientDist, 'index.html'));
  if (clientDistExists) {
    // `dotfiles: 'allow'` is REQUIRED. Express's underlying `send` library
    // walks every segment of the file's absolute path and rejects any
    // request whose path includes a "dotfile" — a segment starting with
    // `.` and longer than 1 char (so `..` is skipped but `.nvm`, `.config`,
    // `.local`, `.pnpm`, `.yarn` etc. all match). Globally-installed
    // ctxloom commonly lives under one of those (Node Version Manager
    // installs to `~/.nvm/...`), in which case index.html and every
    // bundled asset 404 with a confusing `NotFoundError`. Allowing
    // dotfile paths here is safe: the served root is the bundled client
    // dist directory, not the user's home dir.
    app.use(express.static(clientDist, { dotfiles: 'allow' }));
    // SPA fallback. We declare express as `external` in tsup, so the
    // version comes from the consumer's resolved tree — currently
    // express@5.x via @modelcontextprotocol/sdk's transitive dep.
    // Express 5's path-to-regexp v8 rejects the bare '*' wildcard
    // ("Missing parameter name at index 1"). A RegExp route matches
    // identically under both v4 and v5 and avoids the named-splat
    // syntax (`/{*splat}`) that v4 doesn't understand.
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'), { dotfiles: 'allow' });
    });
  } else {
    // Dev mode (tsx server/index.ts) or missing build: the client bundle
    // hasn't been produced. The Vite dev server on :5173 serves the UI
    // and proxies /api here, so this server stays API-only.
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.status(404).type('text/plain').send(
        'Dashboard client bundle not found. In dev: open http://localhost:5173. ' +
        'For a production preview from this port, run `npm run build:client -w @ctxloom/dashboard`.'
      );
    });
  }

  app.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`\nctxloom dashboard running at ${url}\n`);
    if (open) {
      import('open').then(m => m.default(url)).catch(() => {});
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.env.CTXLOOM_ROOT ?? process.cwd();
  const port = Number(process.env.PORT ?? 7842);
  startDashboard({ root, port, open: false });
}
