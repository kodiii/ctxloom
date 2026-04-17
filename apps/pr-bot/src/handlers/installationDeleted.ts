import fs from 'node:fs/promises';
import path from 'node:path';
import type { Context } from 'probot';

const DEFAULT_BASE_DIR = '/var/lib/ctxloom-bot';

/**
 * Handles the `installation.deleted` webhook event.
 *
 * Wipes the on-disk cache directory for the uninstalled installation so stale
 * graph data does not accumulate.  The directory layout mirrors RepoCache:
 *   <baseDir>/<installationId>/
 */
export async function onInstallationDeleted(
  context: Context<'installation.deleted'>,
): Promise<void> {
  const installationId: number = context.payload.installation.id;
  const baseDir = path.resolve(process.env['CTXLOOM_CACHE_DIR'] ?? DEFAULT_BASE_DIR);
  const installDir = path.join(baseDir, String(installationId));

  context.log.info({ installationId, installDir }, 'Removing cache for deleted installation');

  await fs.rm(installDir, { recursive: true, force: true });

  context.log.info({ installationId }, 'Cache directory removed for deleted installation');
}
