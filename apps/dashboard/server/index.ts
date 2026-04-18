import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContext } from './loader.js';
import { buildOverviewRouter } from './routes/overview.js';
import { buildGraphRouter } from './routes/graph.js';
import { buildRiskRouter } from './routes/risk.js';
import { buildCommunitiesRouter } from './routes/communities.js';
import { buildChurnRouter } from './routes/churn.js';
import { buildOwnershipRouter } from './routes/ownership.js';

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
  app.use(cors());
  app.use(express.json());

  app.use('/api/overview', buildOverviewRouter(ctx));
  app.use('/api/graph', buildGraphRouter(ctx));
  app.use('/api/risk', buildRiskRouter(ctx));
  app.use('/api/communities', buildCommunitiesRouter(ctx));
  app.use('/api/churn', buildChurnRouter(ctx));
  app.use('/api/ownership', buildOwnershipRouter(ctx));

  app.get('/api/health', (_req, res) => res.json({ ok: true, root, gitEnabled: ctx.gitEnabled }));

  const clientDist = path.join(__dirname, '../dist/dashboard/client');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

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
