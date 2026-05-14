/**
 * Periodic background eviction of stale repo cache entries.
 *
 * Why this exists: RepoCache.evict() has been implemented for months but
 * was never scheduled — the 10 GB Fly volume would eventually fill with
 * stale graph snapshots from PRs whose base SHAs are long-gone. This
 * module wires the eviction to a setInterval timer so the bot
 * self-cleans without any external cron.
 *
 * Tunables (env vars):
 *   CTXLOOM_CACHE_MAX_AGE_DAYS   — how stale before eviction (default 7)
 *   CTXLOOM_CACHE_EVICT_HOURS    — interval between sweeps (default 6)
 *
 * The first sweep runs 60s after startup so we don't compete with cold-
 * start work; subsequent sweeps run on the configured interval.
 */
import { captureError } from '@ctxloom/core';
import type { Logger } from 'pino';
import { RepoCache } from './repoCache.js';

const DEFAULT_MAX_AGE_DAYS = 7;
const DEFAULT_INTERVAL_HOURS = 6;
const FIRST_SWEEP_DELAY_MS = 60_000;

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Start the background eviction loop. Returns a `stop()` function that
 * cancels both the warm-up timeout and the recurring interval — handy
 * for tests and graceful shutdown.
 */
export function startEvictionSchedule(log: Logger): () => void {
  const cache = new RepoCache();
  const maxAgeDays = readNumberEnv('CTXLOOM_CACHE_MAX_AGE_DAYS', DEFAULT_MAX_AGE_DAYS);
  const intervalHours = readNumberEnv('CTXLOOM_CACHE_EVICT_HOURS', DEFAULT_INTERVAL_HOURS);
  const intervalMs = intervalHours * 60 * 60 * 1000;

  let intervalHandle: NodeJS.Timeout | null = null;

  const sweep = async (): Promise<void> => {
    try {
      const evicted = await cache.evict(maxAgeDays);
      if (evicted > 0) {
        log.info({ evicted, maxAgeDays }, 'repo cache eviction complete');
      }
    } catch (err) {
      log.error({ err }, 'repo cache eviction failed');
      captureError(err, {
        component: 'pr-bot',
        handler: 'cache_eviction',
        max_age_days: maxAgeDays,
      });
    }
  };

  const warmup = setTimeout(() => {
    void sweep();
    intervalHandle = setInterval(() => void sweep(), intervalMs);
    // Don't keep the process alive solely for the eviction timer —
    // matches Probot's other timers and lets the worker exit cleanly.
    intervalHandle.unref();
  }, FIRST_SWEEP_DELAY_MS);
  warmup.unref();

  return () => {
    clearTimeout(warmup);
    if (intervalHandle !== null) clearInterval(intervalHandle);
  };
}
