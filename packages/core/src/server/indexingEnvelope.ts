/**
 * First-touch indexing envelope — wraps tool results with a <ctxloom_indexing>
 * marker on the first index pass for a (root, tier) pair.
 */

export type IndexingTier = 'graph' | 'vectors';

export interface EnvelopeInput {
  firstTouch: boolean;
  projectRoot: string;
  tier: IndexingTier;
  durationMs: number;
  filesIndexed?: number;
  records?: number;
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export function wrapWithIndexingEnvelope(input: EnvelopeInput, body: string): string {
  if (!input.firstTouch) return body;
  const extras: string[] = [];
  if (input.tier === 'graph' && typeof input.filesIndexed === 'number') {
    extras.push(`files_indexed="${input.filesIndexed}"`);
  }
  if (input.tier === 'vectors' && typeof input.records === 'number') {
    extras.push(`records="${input.records}"`);
  }
  const envelope =
    `<ctxloom_indexing first_touch="true" project_root="${escapeAttr(input.projectRoot)}" ` +
    `tier="${input.tier}" duration_ms="${input.durationMs}"` +
    (extras.length ? ` ${extras.join(' ')}` : '') +
    ` />`;
  return `${envelope}\n${body}`;
}

/**
 * Per-server tracker of whether a (root, tier) pair has been seen.
 * Lives on the server alongside the ProjectStateManager.
 */
export class FirstTouchTracker {
  private readonly seen = new Set<string>();

  markAndCheck(root: string, tier: IndexingTier): boolean {
    const key = `${root}::${tier}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }

  reset(root: string): void {
    this.seen.delete(`${root}::graph`);
    this.seen.delete(`${root}::vectors`);
  }
}
