/**
 * Tests for ctx_risk_overlay MCP tool.
 *
 * Builds a fake ServerContext with a pre-populated GitOverlayStore
 * and verifies risk scoring per node.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { GitOverlayStore } from '../src/git/GitOverlayStore.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerRiskOverlayTool } from '../src/tools/risk-overlay.js';
import type { ServerContext } from '../src/tools/context.js';
import type { GitCommitEvent } from '../src/git/GitHistoryMiner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW_S = Math.floor(Date.now() / 1000);

function makeEvent(
  sha: string,
  paths: Array<{ path: string; added: number; deleted: number }>,
  timestamp: number,
  message: string,
  author: string,
  authorEmail: string,
): GitCommitEvent {
  return {
    sha,
    author,
    authorEmail,
    timestamp,
    message,
    files: paths,
    isBulk: false,
    isMerge: false,
  };
}

function makeCtxWithOverlay(overlay: GitOverlayStore): ServerContext {
  return {
    projectRoot: '/fake',
    dbPath: '/fake/.ctxloom/vectors.lancedb',
    getStore: () => Promise.reject(new Error('not needed')),
    getGraph: () => Promise.reject(new Error('not needed')),
    getParser: () => Promise.reject(new Error('not needed')),
    getSkeletonizer: () => Promise.reject(new Error('not needed')),
    getRuleManager: () => { throw new Error('not needed'); },
    getPathValidator: () => { throw new Error('not needed'); },
    isStoreInitialized: () => false,
    isGraphInitialized: () => false,
    isParserInitialized: () => false,
    overlay,
  };
}

function makeCtxNoOverlay(): ServerContext {
  return {
    projectRoot: '/fake',
    dbPath: '/fake/.ctxloom/vectors.lancedb',
    getStore: () => Promise.reject(new Error('not needed')),
    getGraph: () => Promise.reject(new Error('not needed')),
    getParser: () => Promise.reject(new Error('not needed')),
    getSkeletonizer: () => Promise.reject(new Error('not needed')),
    getRuleManager: () => { throw new Error('not needed'); },
    getPathValidator: () => { throw new Error('not needed'); },
    isStoreInitialized: () => false,
    isGraphInitialized: () => false,
    isParserInitialized: () => false,
  };
}

// ---------------------------------------------------------------------------
// Build synthetic overlay store with high-risk and low-risk nodes
// ---------------------------------------------------------------------------

function buildOverlay(): GitOverlayStore {
  const store = new GitOverlayStore('/fake');

  // High-risk node: src/high-risk.ts
  // - churnLines > 500 (many large commits)
  // - bugDensity > 0.25 (several bug-fix commits)
  // - busFactor === 1 (single author)
  // Target score >= 0.7 (high): need churnLines >= 1000 for full churnPart=1.0
  // 12 commits * (added=80+deleted=10=90 lines) = 1080 churnLines
  // 6 bug-fix / 12 total = 0.5 bugDensity
  // busFactor=1 → ownerPart=0.6
  // score = 0.35*1 + 0.30*1 + 0.20*0.6 + 0.15*0 = 0.77
  const highRiskPath = 'src/high-risk.ts';

  for (let i = 0; i < 6; i++) {
    const event = makeEvent(
      `hr-bug${i}`,
      [{ path: highRiskPath, added: 80, deleted: 10 }],
      NOW_S - i * 1000,
      'fix: critical bug fix',
      'alice',
      'alice@example.com',
    );
    store.churn.ingest(event);
    store.ownership.ingest(event);
    store.coChange.ingest(event);
  }
  for (let i = 0; i < 6; i++) {
    const event = makeEvent(
      `hr-feat${i}`,
      [{ path: highRiskPath, added: 80, deleted: 10 }],
      NOW_S - (i + 6) * 1000,
      'feat: add new feature',
      'alice',
      'alice@example.com',
    );
    store.churn.ingest(event);
    store.ownership.ingest(event);
    store.coChange.ingest(event);
  }

  // Low-risk node: src/low-risk.ts
  // - 2 small non-bug commits
  // - 2 distinct authors → busFactor > 1
  const lowRiskPath = 'src/low-risk.ts';

  const lrEvent1 = makeEvent(
    'lr1',
    [{ path: lowRiskPath, added: 5, deleted: 2 }],
    NOW_S - 100,
    'feat: minor tweak',
    'bob',
    'bob@example.com',
  );
  const lrEvent2 = makeEvent(
    'lr2',
    [{ path: lowRiskPath, added: 5, deleted: 2 }],
    NOW_S - 200,
    'chore: cleanup',
    'carol',
    'carol@example.com',
  );
  store.churn.ingest(lrEvent1);
  store.ownership.ingest(lrEvent1);
  store.churn.ingest(lrEvent2);
  store.ownership.ingest(lrEvent2);

  return store;
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

interface NodeRiskEntry {
  file: string;
  riskScore: number;
  riskLabel: string;
  churnLines: number;
  bugDensity: number;
  busFactor: number;
  topOwner: string | null;
  couplingFanOut: number;
  note?: string;
}

interface RiskResponse {
  nodes: NodeRiskEntry[];
  overallRiskScore: number;
  note: string | null;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ctx_risk_overlay', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    const overlay = buildOverlay();
    registry = new ToolRegistry();
    registerRiskOverlayTool(registry, makeCtxWithOverlay(overlay));
  });

  it('returns per-node risk data for both nodes', async () => {
    const raw = await registry.dispatch('ctx_risk_overlay', {
      nodes: ['src/high-risk.ts', 'src/low-risk.ts'],
    });

    const result = JSON.parse(raw) as RiskResponse;

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.map((n) => n.file)).toContain('src/high-risk.ts');
    expect(result.nodes.map((n) => n.file)).toContain('src/low-risk.ts');
  });

  it('src/high-risk.ts has riskLabel "high" and riskScore >= 0.5', async () => {
    const raw = await registry.dispatch('ctx_risk_overlay', {
      nodes: ['src/high-risk.ts'],
    });

    const result = JSON.parse(raw) as RiskResponse;
    const high = result.nodes.find((n) => n.file === 'src/high-risk.ts');

    expect(high).toBeDefined();
    expect(high!.riskLabel).toBe('high');
    expect(high!.riskScore).toBeGreaterThanOrEqual(0.5);
  });

  it('src/low-risk.ts has riskLabel "low"', async () => {
    const raw = await registry.dispatch('ctx_risk_overlay', {
      nodes: ['src/low-risk.ts'],
    });

    const result = JSON.parse(raw) as RiskResponse;
    const low = result.nodes.find((n) => n.file === 'src/low-risk.ts');

    expect(low).toBeDefined();
    expect(low!.riskLabel).toBe('low');
  });

  it('overallRiskScore equals the max of individual node scores', async () => {
    const raw = await registry.dispatch('ctx_risk_overlay', {
      nodes: ['src/high-risk.ts', 'src/low-risk.ts'],
    });

    const result = JSON.parse(raw) as RiskResponse;
    const maxScore = Math.max(...result.nodes.map((n) => n.riskScore));
    expect(result.overallRiskScore).toBeCloseTo(maxScore, 5);
  });

  it('returns a note when overlay is unavailable', async () => {
    const reg2 = new ToolRegistry();
    registerRiskOverlayTool(reg2, makeCtxNoOverlay());

    const raw = await reg2.dispatch('ctx_risk_overlay', {
      nodes: ['src/any.ts'],
    });

    const result = JSON.parse(raw) as RiskResponse;
    expect(result.note).toBeTruthy();
    expect(typeof result.note).toBe('string');
  });
});
