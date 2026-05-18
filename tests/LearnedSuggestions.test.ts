/**
 * Tests for packages/core/src/budget/learnedSuggestions.ts —
 * Phase 4b of the agent-harness plan. Pins:
 *
 *   - Transition counting (basic A→B frequency)
 *   - Session-gap boundaries (transitions across long inactivity
 *     gaps don't count)
 *   - minSamples filter (rarely-observed pairs are dropped)
 *   - Allowlist filter (unregistered tools dropped)
 *   - Token estimate aggregation (uses observed original_tokens)
 *   - 1-hour cache behavior
 *   - Empty / corrupted telemetry → fallthrough to empty
 *   - suggestNext integration: learned beats static; missing learned
 *     falls through to static
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  learnSuggestionsFromTelemetry,
  getLearnedRules,
  __resetLearnedSuggestionsCacheForTests,
  type LearnedRules,
} from '../packages/core/src/budget/learnedSuggestions.js';
import { suggestNext } from '../packages/core/src/budget/nextToolSuggestions.js';
import type { PersistedEvent } from '../packages/core/src/budget/eventCollector.js';

// Convenience builder for a budget event at offset ms from a base ts.
const baseTs = Date.parse('2026-05-01T10:00:00.000Z');
function evt(offsetMs: number, tool: string, originalTokens?: number): PersistedEvent {
  return {
    ts: new Date(baseTs + offsetMs).toISOString(),
    event: 'mcp.budget.exceeded',
    tool,
    ...(originalTokens != null ? { original_tokens: originalTokens } : {}),
  };
}

beforeEach(() => {
  __resetLearnedSuggestionsCacheForTests();
});
afterEach(() => {
  __resetLearnedSuggestionsCacheForTests();
});

// ─── core algorithm ──────────────────────────────────────────────────

describe('learnSuggestionsFromTelemetry — transition counting', () => {
  it('counts A→B transitions within a session', () => {
    const events: PersistedEvent[] = [
      evt(0, 'A'),
      evt(1000, 'B'),
      evt(2000, 'A'),
      evt(3000, 'B'),
      evt(4000, 'A'),
      evt(5000, 'B'),
    ];
    const rules = learnSuggestionsFromTelemetry({ events, minSamples: 3 });
    expect(rules.A).toBeDefined();
    expect(rules.A[0].tool).toBe('B');
    expect(rules.A[0].why).toMatch(/3 agents followed A with B/);
  });

  it('does NOT count transitions across a session gap', () => {
    // Two events 100s apart — default session gap is 90s, so no
    // transition counted.
    const events: PersistedEvent[] = [
      evt(0, 'A'),
      evt(100_000, 'B'),
      evt(101_000, 'A'),
      evt(201_000, 'B'),
    ];
    const rules = learnSuggestionsFromTelemetry({ events, minSamples: 1 });
    expect(rules.A).toBeUndefined();
  });

  it('skips same-tool repeats (A→A is not a useful follow-up)', () => {
    const events: PersistedEvent[] = [
      evt(0, 'A'),
      evt(1000, 'A'),
      evt(2000, 'A'),
      evt(3000, 'B'),
    ];
    const rules = learnSuggestionsFromTelemetry({ events, minSamples: 1 });
    // Only A→B; no A→A row.
    expect(rules.A?.[0].tool).toBe('B');
    expect(rules.A?.find((s) => s.tool === 'A')).toBeUndefined();
  });

  it('keeps top-3 follow-ups by frequency, descending', () => {
    const events: PersistedEvent[] = [];
    // A→B occurs 5 times
    for (let i = 0; i < 5; i++) events.push(evt(i * 1000, 'A'), evt(i * 1000 + 500, 'B'));
    // A→C occurs 3 times (after a small gap to start a new flow but stay within session window)
    const base2 = 50_000;
    for (let i = 0; i < 3; i++) events.push(evt(base2 + i * 1000, 'A'), evt(base2 + i * 1000 + 500, 'C'));
    // A→D occurs 1 time (below default minSamples=3)
    events.push(evt(80_000, 'A'), evt(80_500, 'D'));
    // Sort the input so the algorithm sees them in time order
    events.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

    const rules = learnSuggestionsFromTelemetry({ events, minSamples: 3 });
    // A→B count=5, A→C count=3, A→D count=1 (filtered out by minSamples)
    expect(rules.A).toBeDefined();
    expect(rules.A.length).toBe(2);
    expect(rules.A[0].tool).toBe('B'); // highest count first
    expect(rules.A[1].tool).toBe('C');
  });

  it('caps suggestions at 3 per source tool', () => {
    const events: PersistedEvent[] = [];
    // 5 different destinations from A, each with 4 occurrences
    for (const dest of ['B', 'C', 'D', 'E', 'F']) {
      const base = 10_000 * (dest.charCodeAt(0) - 65);
      for (let i = 0; i < 4; i++) events.push(evt(base + i * 1000, 'A'), evt(base + i * 1000 + 500, dest));
    }
    events.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

    const rules = learnSuggestionsFromTelemetry({ events, minSamples: 3 });
    expect(rules.A).toBeDefined();
    expect(rules.A.length).toBe(3);
  });
});

// ─── allowlist filter ────────────────────────────────────────────────

describe('learnSuggestionsFromTelemetry — allowlist', () => {
  it('drops transitions whose source tool is not in the allowlist', () => {
    const events: PersistedEvent[] = [
      evt(0, 'unregistered_tool'),
      evt(1000, 'B'),
      evt(2000, 'unregistered_tool'),
      evt(3000, 'B'),
      evt(4000, 'unregistered_tool'),
      evt(5000, 'B'),
    ];
    const allowlist = new Set(['B']);
    const rules = learnSuggestionsFromTelemetry({ events, minSamples: 3, registeredTools: allowlist });
    expect(rules.unregistered_tool).toBeUndefined();
  });

  it('drops transitions whose destination tool is not in the allowlist', () => {
    const events: PersistedEvent[] = [
      evt(0, 'A'),
      evt(1000, 'fake_tool'),
      evt(2000, 'A'),
      evt(3000, 'fake_tool'),
      evt(4000, 'A'),
      evt(5000, 'fake_tool'),
    ];
    const allowlist = new Set(['A']);
    const rules = learnSuggestionsFromTelemetry({ events, minSamples: 3, registeredTools: allowlist });
    // A only had transitions to fake_tool, which is filtered → empty row dropped
    expect(rules.A).toBeUndefined();
  });
});

// ─── token estimate aggregation ──────────────────────────────────────

describe('learnSuggestionsFromTelemetry — token estimates', () => {
  it('uses average observed original_tokens as estimated_tokens', () => {
    const events: PersistedEvent[] = [
      evt(0, 'A'),
      evt(1000, 'B', 1000),
      evt(2000, 'A'),
      evt(3000, 'B', 2000),
      evt(4000, 'A'),
      evt(5000, 'B', 3000),
    ];
    const rules = learnSuggestionsFromTelemetry({ events, minSamples: 3 });
    // avg(1000, 2000, 3000) = 2000
    expect(rules.A[0].estimated_tokens).toBe(2000);
  });

  it('clamps estimated_tokens to [0, 100000]', () => {
    const events: PersistedEvent[] = [];
    for (let i = 0; i < 3; i++) {
      events.push(evt(i * 1000, 'A'), evt(i * 1000 + 500, 'B', 1e9 /* absurd */));
    }
    const rules = learnSuggestionsFromTelemetry({ events, minSamples: 3 });
    expect(rules.A[0].estimated_tokens).toBeLessThanOrEqual(100_000);
  });
});

// ─── cache ───────────────────────────────────────────────────────────

describe('getLearnedRules cache', () => {
  it('caches the result and returns the same map on second call', () => {
    const events: PersistedEvent[] = [
      evt(0, 'A'),
      evt(1000, 'B'),
      evt(2000, 'A'),
      evt(3000, 'B'),
      evt(4000, 'A'),
      evt(5000, 'B'),
    ];
    const first = getLearnedRules({ events, minSamples: 3 });
    // Second call with *different* events but cache should hit and return first.
    const second = getLearnedRules({ events: [], minSamples: 3 });
    expect(second).toBe(first); // same reference → cache hit
  });

  it('reset clears the cache', () => {
    const events: PersistedEvent[] = [
      evt(0, 'A'),
      evt(1000, 'B'),
      evt(2000, 'A'),
      evt(3000, 'B'),
      evt(4000, 'A'),
      evt(5000, 'B'),
    ];
    const first = getLearnedRules({ events, minSamples: 3 });
    __resetLearnedSuggestionsCacheForTests();
    const second = getLearnedRules({ events: [], minSamples: 3 });
    expect(second).not.toBe(first); // cache cleared → fresh result
  });
});

// ─── empty / corrupted input ─────────────────────────────────────────

describe('learnSuggestionsFromTelemetry — robustness', () => {
  it('returns empty object on empty input', () => {
    expect(learnSuggestionsFromTelemetry({ events: [] })).toEqual({});
  });

  it('drops events with malformed timestamps', () => {
    const events: PersistedEvent[] = [
      { ts: 'not-a-date', event: 'mcp.budget.exceeded', tool: 'A' },
      evt(1000, 'A'),
      evt(2000, 'B'),
      evt(3000, 'A'),
      evt(4000, 'B'),
      evt(5000, 'A'),
      evt(6000, 'B'),
    ];
    const rules = learnSuggestionsFromTelemetry({ events, minSamples: 3 });
    // The malformed entry was dropped; the 3 valid A→B transitions counted.
    expect(rules.A?.[0].tool).toBe('B');
  });
});

// ─── suggestNext integration ─────────────────────────────────────────

describe('suggestNext — learned beats static (opt-in via CTXLOOM_LEARNED_SUGGESTIONS=1)', () => {
  const ORIG = process.env.CTXLOOM_LEARNED_SUGGESTIONS;
  beforeEach(() => {
    process.env.CTXLOOM_LEARNED_SUGGESTIONS = '1';
  });
  afterEach(() => {
    if (ORIG === undefined) delete process.env.CTXLOOM_LEARNED_SUGGESTIONS;
    else process.env.CTXLOOM_LEARNED_SUGGESTIONS = ORIG;
  });

  it('prefers learned rules over static when both exist for the same source', () => {
    // Seed the cache with learned ctx_get_file → ctx_blast_radius
    // (overriding the static rule, which would suggest ctx_get_call_graph first).
    const events: PersistedEvent[] = [];
    for (let i = 0; i < 5; i++) {
      events.push(evt(i * 1000, 'ctx_get_file'), evt(i * 1000 + 500, 'ctx_blast_radius'));
    }
    // Prime the cache.
    getLearnedRules({ events, minSamples: 3 });

    const result = suggestNext('ctx_get_file');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].tool).toBe('ctx_blast_radius');
    expect(result[0].why).toMatch(/Learned from telemetry/);
  });

  it('falls through to static rules when learner has no entry for the source', () => {
    // Cache primed with empty events → learner has nothing for any tool.
    __resetLearnedSuggestionsCacheForTests();
    getLearnedRules({ events: [], minSamples: 3 });

    const result = suggestNext('ctx_get_file');
    // Static rule kicks in.
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].tool).toBe('ctx_get_call_graph');
    expect(result[0].why).not.toMatch(/Learned from telemetry/);
  });
});

// ─── v1.5.0 dogfood H1 fix: cache-key correctness ────────────────────

describe('getLearnedRules cache + allowlist composition (H1)', () => {
  it('cached rules stay unfiltered; allowlist is applied at READ time', () => {
    const events: PersistedEvent[] = [];
    for (let i = 0; i < 5; i++) {
      events.push(evt(i * 1000, 'A'), evt(i * 1000 + 500, 'B'));
    }
    // First call: NO allowlist → caches the unfiltered { A: [{ tool: 'B' }] }.
    const first = getLearnedRules({ events, minSamples: 3 });
    expect(first.A?.[0]?.tool).toBe('B');
    // Second call: allowlist that EXCLUDES B → must return empty, not
    // the cached unfiltered result. Pre-fix this returned B (cache poisoning).
    const second = getLearnedRules({ events: [], minSamples: 3, registeredTools: new Set(['A']) });
    expect(second.A).toBeUndefined();
    // Third call: allowlist that INCLUDES B → must surface B again.
    // Proves the cache survived both prior calls + the read-time
    // filter doesn't mutate the stored payload.
    const third = getLearnedRules({ events: [], minSamples: 3, registeredTools: new Set(['A', 'B']) });
    expect(third.A?.[0]?.tool).toBe('B');
  });

  it('caching first WITH allowlist still serves subsequent NO-allowlist correctly', () => {
    // Inverse direction: cache primed with a restrictive allowlist.
    // The cache stores the unfiltered superset regardless of caller
    // opts, so a subsequent no-allowlist call must see ALL transitions.
    const events: PersistedEvent[] = [];
    for (let i = 0; i < 5; i++) {
      events.push(evt(i * 1000, 'A'), evt(i * 1000 + 500, 'B'));
      events.push(evt(i * 1000 + 10_000, 'C'), evt(i * 1000 + 10_500, 'D'));
    }
    const first = getLearnedRules({
      events,
      minSamples: 3,
      registeredTools: new Set(['A', 'B']), // C→D filtered for THIS caller
    });
    expect(first.A?.[0]?.tool).toBe('B');
    expect(first.C).toBeUndefined();
    // Second NO-allowlist call: should see C→D from the cache.
    const second = getLearnedRules({ events: [], minSamples: 3 });
    expect(second.C?.[0]?.tool).toBe('D');
  });
});

describe('suggestNext — learner disabled by default', () => {
  it('with CTXLOOM_LEARNED_SUGGESTIONS unset, learned rules are ignored', () => {
    const orig = process.env.CTXLOOM_LEARNED_SUGGESTIONS;
    delete process.env.CTXLOOM_LEARNED_SUGGESTIONS;
    try {
      // Even if the learner has data, it's not consulted.
      const events: PersistedEvent[] = [];
      for (let i = 0; i < 5; i++) {
        events.push(evt(i * 1000, 'ctx_get_file'), evt(i * 1000 + 500, 'ctx_blast_radius'));
      }
      getLearnedRules({ events, minSamples: 3 });
      const result = suggestNext('ctx_get_file');
      // Static rule (ctx_get_call_graph first), NOT the learned ctx_blast_radius.
      expect(result[0].tool).toBe('ctx_get_call_graph');
    } finally {
      if (orig !== undefined) process.env.CTXLOOM_LEARNED_SUGGESTIONS = orig;
    }
  });
});

// ─── shape sanity ────────────────────────────────────────────────────

describe('LearnedRules return shape', () => {
  it('matches NextToolSuggestion[] structure per entry', () => {
    const events: PersistedEvent[] = [];
    for (let i = 0; i < 5; i++) {
      events.push(evt(i * 1000, 'A', 500), evt(i * 1000 + 500, 'B', 1500));
    }
    const rules: LearnedRules = learnSuggestionsFromTelemetry({ events, minSamples: 3 });
    expect(rules.A).toBeDefined();
    expect(rules.A[0]).toMatchObject({
      tool: expect.any(String),
      why: expect.any(String),
      estimated_tokens: expect.any(Number),
    });
  });
});
