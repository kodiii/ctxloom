/**
 * Shared "git overlay unavailable" message for ctx_risk_overlay and
 * ctx_git_coupling.
 *
 * Defect-2 fix (v1.7.10): the old message always said "Re-index with
 * --with-git", which is a dead end when the overlay file already exists
 * on disk (the real cause was the server never loading it per-project).
 * This branches on whether <root>/.ctxloom/git-overlay.json exists so the
 * user gets an actionable next step instead of a misleading one.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ServerContext } from './context.js';

/**
 * Resolve the on-disk root for the queried project (via the already-loaded
 * graph's recorded root — same accessor #257 added), then craft the right
 * message. Best-effort: any resolution failure falls back to the generic
 * re-index hint.
 */
export async function overlayUnavailableNote(
  ctx: ServerContext,
  projectRoot: string | undefined,
): Promise<string> {
  let rootDir = '';
  try {
    const graph = await ctx.getGraph(projectRoot);
    rootDir = graph.getRootDir();
  } catch {
    // graph not resolvable — fall through to the generic message
  }

  if (rootDir) {
    const overlayFile = path.join(rootDir, '.ctxloom', 'git-overlay.json');
    if (fs.existsSync(overlayFile)) {
      // The data exists — the server couldn't load it. NOT a re-index case.
      return (
        `Git overlay exists at ${overlayFile} but could not be loaded into the ` +
        `server. Restart the MCP server (or check its logs for a git/overlay ` +
        `error); a re-index is not required.`
      );
    }
    return (
      `No git overlay for ${rootDir}. Build it by running \`ctxloom index\` in ` +
      `that repo (the git overlay is created automatically when git is enabled). ` +
      `If the server was started with --no-git, restart it without that flag.`
    );
  }

  // Generic fallback (couldn't resolve the project root).
  return 'Git overlay not available. Run `ctxloom index` with git enabled to build it.';
}
