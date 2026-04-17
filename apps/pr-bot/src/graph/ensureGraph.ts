import type { RepoCache } from './repoCache.js';

export interface EnsureGraphParams {
  installationId: number;
  repoId: number;
  baseSha: string;
  headSha: string;
  localRepoPath?: string; // for testing / self-hosted use
}

export interface GraphHandle {
  rootDir: string;
  baseSha: string;
  headSha: string;
}

export async function ensureGraph(
  params: EnsureGraphParams,
  cache: RepoCache,
): Promise<GraphHandle> {
  const { installationId, repoId, baseSha, headSha, localRepoPath } = params;

  const cacheDir = cache.pathFor({ installationId, repoId, baseSha });

  if (localRepoPath !== undefined) {
    return { rootDir: localRepoPath, baseSha, headSha };
  }

  // Stub: no GitHub access in this implementation.
  // Full clone logic will be added in Task 9 when GitHub App credentials are available.
  return { rootDir: cacheDir, baseSha, headSha };
}
