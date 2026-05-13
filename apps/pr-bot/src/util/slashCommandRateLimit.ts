/**
 * Per-installation token-bucket rate limit for /ctxloom slash commands.
 *
 * Why this exists: even with the collaborator-permission gate, an
 * approved contributor can spam `/ctxloom refresh` on a hot PR — each
 * refresh triggers a fresh dependency-graph build, which is expensive.
 * Without a brake, the bot is one shell loop away from a self-DoS.
 *
 * Why a token bucket (vs. fixed window): refresh is bursty by nature
 * — the user reviews, edits the PR, refreshes; that's three legitimate
 * calls in a minute. A fixed N/minute window would reject the third. A
 * bucket with `capacity = 3, refill = 1/min` lets the burst through and
 * blocks the abuse pattern (10/min sustained).
 *
 * Storage is in-memory: per-pod, lost on restart. Acceptable for a
 * single-machine Fly deploy; if we ever scale horizontally, this needs
 * Redis-backed state. The kill-switch on resource exhaustion is the
 * 1-replica Fly config, not this limiter.
 */
type SlashCommand = 'explain' | 'ignore' | 'refresh';

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

interface BucketConfig {
  capacity: number;
  refillPerMinute: number;
}

const CONFIGS: Record<SlashCommand, BucketConfig> = {
  // Cheap reply-only commands — generous limit.
  explain: { capacity: 10, refillPerMinute: 5 },
  ignore: { capacity: 5, refillPerMinute: 2 },
  // Expensive: each call rebuilds the dependency graph.
  refresh: { capacity: 3, refillPerMinute: 1 },
};

const buckets = new Map<string, Bucket>();

function key(installationId: number, command: SlashCommand): string {
  return `${installationId}:${command}`;
}

/**
 * Returns true if the command is allowed and consumes a token; false if
 * the bucket is empty. Exported separately from the consumption so tests
 * can reset state via `_resetRateLimitForTests`.
 */
export function allowSlashCommand(
  installationId: number,
  command: SlashCommand,
  nowMs: number = Date.now(),
): boolean {
  const cfg = CONFIGS[command];
  const k = key(installationId, command);
  let bucket = buckets.get(k);
  if (!bucket) {
    bucket = { tokens: cfg.capacity, lastRefillMs: nowMs };
    buckets.set(k, bucket);
  }

  // Refill: tokens accrue continuously at `refillPerMinute`, capped at
  // capacity.
  const minutesElapsed = (nowMs - bucket.lastRefillMs) / 60_000;
  if (minutesElapsed > 0) {
    bucket.tokens = Math.min(
      cfg.capacity,
      bucket.tokens + minutesElapsed * cfg.refillPerMinute,
    );
    bucket.lastRefillMs = nowMs;
  }

  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/** Test-only — clears all buckets so suites don't leak state. */
export function _resetRateLimitForTests(): void {
  buckets.clear();
}
