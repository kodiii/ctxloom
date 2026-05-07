import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface DashboardOptions {
  root: string;
  port: number;
  open: boolean;
}

export async function startDashboard(options: DashboardOptions): Promise<void> {
  // Resolve to the dashboard's COMPILED server entry.
  // The dashboard package emits to apps/dashboard/dist/server/ via
  // `tsc -p tsconfig.server.json`. Previously this path was missing the
  // `/dist/` segment, which crashed on every fresh install with
  // ERR_MODULE_NOT_FOUND. The package.json `files` whitelist + root
  // `build` script now ensure the dashboard is built and shipped.
  const serverPath = path.resolve(__dirname, '../apps/dashboard/dist/server/index.js');
  const mod = await import(serverPath);
  await mod.startDashboard(options);
}
