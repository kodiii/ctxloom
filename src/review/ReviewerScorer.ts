import type { OwnershipIndex } from '../git/OwnershipIndex.js';
import type { CoChangeIndex } from '../git/CoChangeIndex.js';
import type {
  ReviewConfig,
  CandidateActivity,
  ScoreBreakdown,
  ReviewSuggestion,
  BusFactorWarning,
  ReviewSuggestResult,
} from './types.js';

const SECS_PER_DAY = 86_400;

export function scoreReviewers(
  files: string[],
  ownership: OwnershipIndex,
  coChange: CoChangeIndex,
  activity: CandidateActivity[],
  prAuthorEmail: string,
  config: ReviewConfig,
  now: number = Math.floor(Date.now() / 1000),
): ReviewSuggestResult {
  const { weights, thresholds, defaults } = config;

  // Build activity lookup: email → last commit timestamp
  const activityMap = new Map<string, number>(
    activity.map(a => [a.email, a.lastCommitTimestamp]),
  );

  // Collect all candidate emails across the files (excluding PR author and excluded list)
  const candidateEmails = new Set<string>();
  for (const file of files) {
    const stats = ownership.statsFor(file, now);
    if (!stats) continue;
    for (const owner of stats.owners) {
      if (owner.email === prAuthorEmail) continue;
      if (config.exclude.some(ex => matchGlob(ex, owner.email))) continue;
      candidateEmails.add(owner.email);
    }
  }

  // Hard-filter: candidates with no activity in stalenessDaysFilter
  const activeEmails = new Set(
    Array.from(candidateEmails).filter(email => {
      const lastTs = activityMap.get(email);
      if (lastTs === undefined) return false;
      const daysAgo = (now - lastTs) / SECS_PER_DAY;
      return daysAgo <= thresholds.stalenessDaysFilter;
    }),
  );

  // Score each active candidate across all files, then take mean
  const breakdowns: ScoreBreakdown[] = [];
  for (const email of activeEmails) {
    const perFile = files.map(file => scoreCandidate(
      email, file, ownership, coChange, activityMap, config, now,
    ));
    // Mean across files
    const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const first = perFile[0]!;
    const merged: ScoreBreakdown = {
      email,
      ownership: mean(perFile.map(b => b.ownership)),
      coChange: mean(perFile.map(b => b.coChange)),
      activity: first.activity, // activity is per-person, not per-file
      busFactorBoost: mean(perFile.map(b => b.busFactorBoost)),
      stalenessMultiplier: first.stalenessMultiplier,
      total: 0,
    };
    merged.total =
      (weights.ownership * merged.ownership +
       weights.coChange * merged.coChange +
       weights.activity * merged.activity +
       weights.busFactorBoost * merged.busFactorBoost) *
      merged.stalenessMultiplier;
    breakdowns.push(merged);
  }

  // Sort descending; tie-break by stalenessMultiplier then activity
  breakdowns.sort((a, b) => {
    const diff = b.total - a.total;
    if (Math.abs(diff) >= 0.02) return diff;
    if (b.stalenessMultiplier !== a.stalenessMultiplier)
      return b.stalenessMultiplier - a.stalenessMultiplier;
    const lastA = activityMap.get(a.email) ?? 0;
    const lastB = activityMap.get(b.email) ?? 0;
    return lastB - lastA;
  });

  const suggestions: ReviewSuggestion[] = breakdowns
    .slice(0, defaults.max)
    .map(bd => ({ breakdown: bd, reason: buildReason(bd, files, ownership, now) }));

  // Bus-factor warnings
  const warnings: BusFactorWarning[] = collectWarnings(files, ownership, now, thresholds.activityMidDays);

  return { suggestions, warnings };
}

// ---------------------------------------------------------------------------
// Per-file per-candidate score (no I/O)
// ---------------------------------------------------------------------------

function scoreCandidate(
  email: string,
  file: string,
  ownership: OwnershipIndex,
  coChange: CoChangeIndex,
  activityMap: Map<string, number>,
  config: ReviewConfig,
  now: number,
): ScoreBreakdown {
  const { thresholds } = config;
  const stats = ownership.statsFor(file, now);
  const ownerEntry = stats?.owners.find(o => o.email === email);

  // Ownership score
  const ownershipScore = ownerEntry?.share ?? 0;

  // Co-change score: fraction of top co-changed files owned by this candidate
  const coChangePeers = coChange.topFor({
    node: file, limit: 10,
    minConfidence: 0.05,
    halfLifeDays: thresholds.coChangeWindowDays,
    now,
  });
  let coChangeScore = 0;
  if (coChangePeers.length > 0) {
    const hits = coChangePeers.filter(peer => {
      const peerFile = peer.nodeA === file ? peer.nodeB : peer.nodeA;
      const peerStats = ownership.statsFor(peerFile, now);
      return peerStats?.owners.some(o => o.email === email) ?? false;
    });
    coChangeScore = hits.length / coChangePeers.length;
  }

  // Activity score (per person)
  const lastTs = activityMap.get(email) ?? 0;
  const daysAgo = (now - lastTs) / SECS_PER_DAY;
  const activityScore =
    daysAgo <= thresholds.activityRecentDays ? 1.0 :
    daysAgo <= thresholds.activityMidDays ? 0.5 : 0;

  // Bus-factor boost: non-top-owner with >=10% share on low-bus-factor file
  let busBoost = 0;
  if (stats && stats.busFactor <= 2 && ownerEntry && ownerEntry.share >= 0.10) {
    const isTopOwner = stats.owners[0]?.email === email;
    if (!isTopOwner) busBoost = 1;
  }

  // Staleness multiplier (applied to total, not per-factor)
  // Penalty applies for anything beyond activityMidDays (90d+), not just > stalenessDaysPenalty
  const stalenessMultiplier = daysAgo > thresholds.activityMidDays ? 0.3 : 1.0;

  return {
    email,
    ownership: ownershipScore,
    coChange: coChangeScore,
    activity: activityScore,
    busFactorBoost: busBoost,
    stalenessMultiplier,
    total: 0, // set by caller after mean
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildReason(
  bd: ScoreBreakdown,
  files: string[],
  ownership: OwnershipIndex,
  now: number,
): string {
  const parts: string[] = [];
  if (bd.ownership > 0.3) {
    const pct = Math.round(bd.ownership * 100);
    const topFile = files.find(f => {
      const s = ownership.statsFor(f, now);
      return s?.owners.some(o => o.email === bd.email) ?? false;
    });
    parts.push(`owns ~${pct}% of ${topFile ?? 'changed files'}`);
  }
  if (bd.coChange > 0.3) parts.push('active in co-changed files');
  if (bd.busFactorBoost > 0) parts.push('bus-factor boost');
  if (bd.stalenessMultiplier < 1) parts.push('stale (>180d)');
  return parts.join('; ') || 'historical contributor';
}

function collectWarnings(
  files: string[],
  ownership: OwnershipIndex,
  now: number,
  midDays: number,
): BusFactorWarning[] {
  const warnings: BusFactorWarning[] = [];
  for (const file of files) {
    const stats = ownership.statsFor(file, now);
    if (!stats) continue;
    const topOwnerStalenessDays = stats.stalenessDays;
    if (stats.busFactor <= 2 || topOwnerStalenessDays > midDays) {
      warnings.push({
        pattern: file,
        busFactor: stats.busFactor,
        topOwnerStalenessDays,
      });
    }
  }
  // Deduplicate by pattern
  return warnings.filter((w, i, arr) => arr.findIndex(x => x.pattern === w.pattern) === i);
}

/** Very small glob: only supports leading/trailing * and *.domain patterns */
function matchGlob(pattern: string, value: string): boolean {
  if (pattern.startsWith('*@')) {
    const domain = pattern.slice(2);
    return value.endsWith(`@${domain}`);
  }
  return pattern === value;
}
