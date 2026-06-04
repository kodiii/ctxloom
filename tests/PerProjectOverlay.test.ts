/**
 * v1.7.10 — git overlay is resolved per-project.
 *
 * Bug: ctx_risk_overlay / ctx_git_coupling read the singleton ctx.overlay,
 * which was only ever populated for the DEFAULT project at server boot. In
 * no-default / multi-project mode (CTXLOOM_ROOT unset — one global MCP
 * across many registered repos) ctx.overlay was null for every project, so
 * both tools returned "no data" with a misleading "re-index with --with-git"
 * note EVEN WHEN git-overlay.json existed on disk (verified on
 * salon-portal-supa-02: 429 commits present, risk overlay still empty).
 *
 * Fix: tools call ctx.getOverlay(project_root), which resolves the overlay
 * lazily PER PROJECT (mirrors getGraph/getStore). These tests assert a tool
 * gets real data for a project whose overlay is provided via getOverlay,
 * independent of any default-project / ctx.overlay singleton.
 */
import { describe, it, expect } from 'vitest';
import { GitOverlayStore } from '../src/git/GitOverlayStore.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerRiskOverlayTool } from '../src/tools/risk-overlay.js';
import { registerGitCouplingTool } from '../src/tools/git-coupling.js';
import type { ServerContext } from '../src/tools/context.js';
import type { GitCommitEvent } from '../src/git/GitHistoryMiner.js';

const NOW_S = Math.floor(Date.now() / 1000);

function ev(sha: string, file: string, msg: string, author: string): GitCommitEvent {
  return {
    sha, author, authorEmail: `${author}@x.com`, timestamp: NOW_S,
    message: msg, files: [{ path: file, added: 90, deleted: 10 }],
    isBulk: false, isMerge: false,
  };
}

/** A populated overlay for "project B" (NOT the default project). */
function overlayForProjectB(): GitOverlayStore {
  const store = new GitOverlayStore('/projects/b');
  for (let i = 0; i < 8; i++) {
    const e = ev(`b${i}`, 'src/feature.ts', i % 2 ? 'fix: bug' : 'feat: x', 'alice');
    store.churn.ingest(e);
    store.ownership.ingest(e);
    store.coChange.ingest(e);
  }
  // co-change pair so git-coupling has something to return
  for (let i = 0; i < 5; i++) {
    const e: GitCommitEvent = {
      sha: `pair${i}`, author: 'alice', authorEmail: 'alice@x.com', timestamp: NOW_S,
      message: 'feat', isBulk: false, isMerge: false,
      files: [
        { path: 'src/feature.ts', added: 10, deleted: 1 },
        { path: 'src/sibling.ts', added: 10, deleted: 1 },
      ],
    };
    store.coChange.ingest(e);
  }
  return store;
}

/**
 * ctx whose DEFAULT overlay is null (no-default mode) but getOverlay
 * returns project B's overlay when asked for project_root "b". This is
 * exactly the multi-project shape that used to fail.
 */
function makeMultiProjectCtx(projectBOverlay: GitOverlayStore): ServerContext {
  return {
    projectRoot: '',                 // no default (no-default mode)
    dbPath: '',
    noDefaultMode: true,
    overlay: undefined,              // default-project singleton is null
    getStore: () => Promise.reject(new Error('not needed')),
    getGraph: () => Promise.reject(new Error('not needed')),
    getOverlay: (root?: string) =>
      Promise.resolve(root === 'b' ? projectBOverlay : null),
    getParser: () => Promise.reject(new Error('not needed')),
    getSkeletonizer: () => Promise.reject(new Error('not needed')),
    getRuleManager: () => { throw new Error('not needed'); },
    getPathValidator: () => { throw new Error('not needed'); },
    isStoreInitialized: () => false,
    isGraphInitialized: () => false,
    isParserInitialized: () => false,
  } as unknown as ServerContext;
}

describe('per-project git overlay (v1.7.10)', () => {
  it('ctx_risk_overlay scores a non-default project via project_root', async () => {
    const reg = new ToolRegistry();
    reg && registerRiskOverlayTool(reg, makeMultiProjectCtx(overlayForProjectB()));

    const raw = await reg.dispatch('ctx_risk_overlay', {
      nodes: ['src/feature.ts'],
      project_root: 'b',
    });
    const result = JSON.parse(raw) as {
      nodes: Array<{ file: string; riskScore: number; churnLines: number }>;
      note: string | null;
    };

    // Real data — NOT the "no git data" empty shape.
    const node = result.nodes.find((n) => n.file === 'src/feature.ts')!;
    expect(node.churnLines).toBeGreaterThan(0);
    expect(node.riskScore).toBeGreaterThan(0);
  });

  it('ctx_risk_overlay still returns the unavailable note for a project with no overlay', async () => {
    const reg = new ToolRegistry();
    registerRiskOverlayTool(reg, makeMultiProjectCtx(overlayForProjectB()));

    const raw = await reg.dispatch('ctx_risk_overlay', {
      nodes: ['src/x.ts'],
      project_root: 'other', // getOverlay returns null for this
    });
    const result = JSON.parse(raw) as { note: string | null };
    expect(result.note).toBeTruthy();
  });

  it('ctx_git_coupling returns coupled files for a non-default project via project_root', async () => {
    const reg = new ToolRegistry();
    registerGitCouplingTool(reg, makeMultiProjectCtx(overlayForProjectB()));

    const raw = await reg.dispatch('ctx_git_coupling', {
      file: 'src/feature.ts',
      project_root: 'b',
    });
    const result = JSON.parse(raw) as {
      file: string;
      coupledFiles: Array<{ file: string }>;
      note?: string;
    };

    expect(result.coupledFiles.map((c) => c.file)).toContain('src/sibling.ts');
  });
});
