import fs from 'node:fs/promises';
import path from 'node:path';
import type { Context } from 'probot';
import { captureError } from '@ctxloom/core';

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

  try {
    await fs.rm(installDir, { recursive: true, force: true });
    context.log.info({ installationId }, 'Cache directory removed for deleted installation');
  } catch (err) {
    // fs.rm with `force: true` swallows ENOENT, so anything that lands
    // here is a real problem (permissions, EBUSY, etc.). Surface it.
    captureError(err, {
      component: 'pr-bot',
      handler: 'installation_deleted',
      installation_id: installationId,
      install_dir: installDir,
    });
    throw err;
  }
}
