/**
 * Analyze the workspace's working tree as if it were a PR head against
 * a base ref. Mirrors the analysis the ctxloom GitHub Action runs in
 * CI — same `@ctxloom/core` primitives, same risk-level logic — but
 * works against the local checkout without needing an open PR.
 *
 * Designed to be called from the VS Code command
 * `ctxloom: Preview PR review`, but the function itself is framework-free
 * so future status-bar / decoration features can reuse it.
 *
 * Notes on the lazy import: `@ctxloom/core` is shipped inside the
 * ctxloom CLI tarball, which the extension lazy-installs on first
 * activation. Before that install lands, `import('@ctxloom/core')`
 * throws. Callers must handle the rejection.
 */
import { spawn } from 'node:child_process';

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

export interface ChangedFilePreview {
  file: string;
  riskLevel: RiskLevel;
  importerCount: number;
  isHub: boolean;
  hasTestCoverage: boolean;
}

export interface PreviewResult {
  base: string;
  headSha: string;
  changedFiles: ChangedFilePreview[];
  summary: { critical: number; high: number; medium: number; low: number };
  blastRadius: number;
  /** Top-band risk (worst level in changedFiles) — null for empty set. */
  topLevel: RiskLevel | null;
  /** Per-changed-file historical-coupled siblings (empty when no git overlay). */
  coupledNodes: Array<{ for: string; node: string; confidence: number }>;
  /** True when the dependency graph could not be built (workspace empty / unreadable). */
  isStub: boolean;
}

export interface AnalyzeOptions {
  /** Absolute path to the workspace root. */
  workspace: string;
  /**
   * Base ref to diff against. Defaults to `origin/HEAD` if available,
   * else `origin/main`, else `main`. The fallback chain is applied
   * in `resolveBaseRef`.
   */
  baseRef?: string;
}

const RISK_RANK: Record<RiskLevel, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Resolve a usable base ref. Tries the explicit arg first, then the
 * standard fallback chain. Returns null if none of them exist on the
 * local repo (in which case the analysis can't run).
 */
async function resolveBaseRef(workspace: string, explicit?: string): Promise<string | null> {
  if (explicit) {
    if (await refExists(workspace, explicit)) return explicit;
    return null;
  }
  const candidates = ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master'];
  for (const c of candidates) {
    if (await refExists(workspace, c)) return c;
  }
  return null;
}

function runGit(workspace: string, args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn('git', args, { cwd: workspace });
    let stdout = '';
    proc.stdout.on('data', (b: Buffer) => (stdout += b.toString('utf8')));
    proc.on('close', (code) => resolve({ stdout, code: code ?? 1 }));
    proc.on('error', () => resolve({ stdout: '', code: 1 }));
  });
}

async function refExists(workspace: string, ref: string): Promise<boolean> {
  // `--abbrev-ref` resolves `origin/HEAD` to the underlying branch
  // (e.g. `origin/main`); we just want to confirm the ref exists.
  const { code } = await runGit(workspace, ['rev-parse', '--verify', '--quiet', ref]);
  return code === 0;
}

async function listChangedFiles(workspace: string, baseRef: string): Promise<string[]> {
  // `--name-only` against `base...HEAD` gives the same file list the
  // GitHub Action sees from `pulls.listFiles`. Trailing newline → empty
  // string from split is filtered out.
  const { stdout } = await runGit(workspace, ['diff', '--name-only', `${baseRef}...HEAD`]);
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

async function currentHeadSha(workspace: string): Promise<string> {
  const { stdout } = await runGit(workspace, ['rev-parse', 'HEAD']);
  return stdout.trim() || 'HEAD';
}

function worstRisk(files: ReadonlyArray<{ riskLevel: RiskLevel }>): RiskLevel | null {
  if (files.length === 0) return null;
  return files.reduce<RiskLevel>((acc, f) => {
    return RISK_RANK[f.riskLevel] < RISK_RANK[acc] ? f.riskLevel : acc;
  }, 'low');
}

/**
 * Runs the analysis. Returns null when there's no valid base ref to
 * compare against (e.g. fresh repo, no remote). The caller should
 * surface a "set a base ref" error in that case.
 *
 * All errors from the underlying graph/overlay builders are caught
 * and surfaced as `isStub: true` rather than thrown — the preview
 * should always show *something*, even if the graph is empty.
 */
export async function analyzeWorkingTree(opts: AnalyzeOptions): Promise<PreviewResult | null> {
  const baseRef = await resolveBaseRef(opts.workspace, opts.baseRef);
  if (baseRef === null) return null;

  const [headSha, files] = await Promise.all([
    currentHeadSha(opts.workspace),
    listChangedFiles(opts.workspace, baseRef),
  ]);

  // Lazy: see file header.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let core: any;
  try {
    core = await import('@ctxloom/core');
  } catch {
    return {
      base: baseRef,
      headSha,
      changedFiles: files.map((file) => ({
        file,
        riskLevel: 'low',
        importerCount: 0,
        isHub: false,
        hasTestCoverage: false,
      })),
      summary: { critical: 0, high: 0, medium: 0, low: files.length },
      blastRadius: 0,
      topLevel: files.length > 0 ? 'low' : null,
      coupledNodes: [],
      isStub: true,
    };
  }

  // Build graph + overlay against the workspace. Any failure (no
  // grammars, fresh checkout, etc.) collapses to the stub branch so
  // the preview still renders.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  let graph: any = null;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  let overlay: any = null;
  let isStub = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    graph = new core.DependencyGraph();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await graph.buildFromDirectory(opts.workspace);
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      overlay = new core.GitOverlayStore(opts.workspace);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      await overlay.refresh();
    } catch {
      overlay = null;
    }
  } catch {
    isStub = true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const detect = core.detectChanges({
    graph: graph ?? new core.DependencyGraph(),
    overlay: overlay ?? undefined,
    changedFiles: files,
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const impact = core.getImpactRadius({
    graph: graph ?? new core.DependencyGraph(),
    overlay: overlay ?? undefined,
    changedFiles: files,
  });

  const changedFiles: ChangedFilePreview[] = (detect.changedFiles as Array<{
    file: string;
    riskLevel: RiskLevel;
    importerCount: number;
    isHub: boolean;
    hasTestCoverage: boolean;
    risk: { coupledNodes?: Array<{ node: string; confidence: number }> } | null;
  }>).map((f) => ({
    file: f.file,
    riskLevel: f.riskLevel,
    importerCount: f.importerCount,
    isHub: f.isHub,
    hasTestCoverage: f.hasTestCoverage,
  }));

  const coupledNodes: PreviewResult['coupledNodes'] = [];
  for (const f of detect.changedFiles as Array<{
    file: string;
    risk: { coupledNodes?: Array<{ node: string; confidence: number }> } | null;
  }>) {
    for (const c of f.risk?.coupledNodes ?? []) {
      coupledNodes.push({ for: f.file, node: c.node, confidence: c.confidence });
    }
  }

  return {
    base: baseRef,
    headSha,
    changedFiles,
    summary: detect.summary as PreviewResult['summary'],
    blastRadius: impact.totalImpacted as number,
    topLevel: worstRisk(changedFiles),
    coupledNodes,
    isStub,
  };
}
