import type { GitOverlayStore } from '../../../../src/git/GitOverlayStore.js';

export interface ReviewerSuggestion {
  login: string;
  rationale: string;
  share?: number;
}

interface OwnerEntry {
  login: string;
  share: number;
}

function collectOwners(
  filesTouched: string[],
  overlay: GitOverlayStore,
): OwnerEntry[] {
  const shareMap = new Map<string, number[]>();

  for (const file of filesTouched) {
    const stats = overlay.ownership.statsFor(file);
    if (!stats) continue;
    for (const owner of stats.owners) {
      const existing = shareMap.get(owner.author) ?? [];
      shareMap.set(owner.author, [...existing, owner.share]);
    }
  }

  if (shareMap.size === 0) return [];

  const merged: OwnerEntry[] = [];
  for (const [login, shares] of shareMap) {
    const avg = shares.reduce((sum, s) => sum + s, 0) / shares.length;
    merged.push({ login, share: avg });
  }

  return merged.sort((a, b) => b.share - a.share);
}

function buildRationale(login: string, share: number, isApprover: boolean): string {
  const pct = `${Math.round(share * 100)}%`;
  if (isApprover) {
    return `Recent approver + owner (${pct} of commits)`;
  }
  return `Top owner (${pct} of commits)`;
}

export function suggestReviewers(params: {
  filesTouched: string[];
  overlay: GitOverlayStore | undefined;
  recentApprovers: string[];
  maxSuggestions?: number;
}): ReviewerSuggestion[] {
  const { filesTouched, overlay, recentApprovers, maxSuggestions = 2 } = params;

  if (!overlay) return [];

  const owners = collectOwners(filesTouched, overlay);
  if (owners.length === 0) return [];

  const approverSet = new Set(recentApprovers);

  // Intersection: owners who are also recent approvers (sorted by share desc)
  const intersection = owners.filter(o => approverSet.has(o.login));
  // Remaining owners not in intersection
  const remaining = owners.filter(o => !approverSet.has(o.login));

  const ranked = [...intersection, ...remaining].slice(0, maxSuggestions);

  return ranked.map(o => ({
    login: o.login,
    rationale: buildRationale(o.login, o.share, approverSet.has(o.login)),
    share: o.share,
  }));
}
