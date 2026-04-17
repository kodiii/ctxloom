import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_BASE_DIR = '/var/lib/ctxloom-bot';

export interface CacheKey {
  installationId: number;
  repoId: number;
  baseSha: string;
}

export class RepoCache {
  constructor(private readonly baseDir: string = process.env['CTXLOOM_CACHE_DIR'] ?? DEFAULT_BASE_DIR) {}

  pathFor(key: CacheKey): string {
    return path.join(this.baseDir, String(key.installationId), String(key.repoId), key.baseSha);
  }

  async evict(maxAgeDays: number = 7): Promise<number> {
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let evicted = 0;

    const installationDirs = await readdirSafe(this.baseDir);
    for (const installId of installationDirs) {
      const installPath = path.join(this.baseDir, installId);
      const repoDirs = await readdirSafe(installPath);
      for (const repoId of repoDirs) {
        const repoPath = path.join(installPath, repoId);
        const shaDirs = await readdirSafe(repoPath);
        for (const sha of shaDirs) {
          const shaPath = path.join(repoPath, sha);
          const stat = await statSafe(shaPath);
          if (stat !== null && now - stat.mtimeMs > maxAgeMs) {
            await fs.rm(shaPath, { recursive: true, force: true });
            evicted++;
          }
        }
      }
    }

    return evicted;
  }
}

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

async function statSafe(filePath: string): Promise<{ mtimeMs: number } | null> {
  try {
    const s = await fs.stat(filePath);
    return { mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
}
