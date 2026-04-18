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
  const serverPath = path.resolve(__dirname, '../apps/dashboard/server/index.js');
  const mod = await import(serverPath);
  await mod.startDashboard(options);
}
