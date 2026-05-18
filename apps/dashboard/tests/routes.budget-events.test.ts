/**
 * Tests for /api/budget-events.
 *
 * Strategy: scope CTXLOOM_TELEMETRY_DIR to a tmp dir, seed JSONL files
 * with deterministic events, hit the route, assert the aggregation
 * matches `summarizeBudgetEvents()` from @ctxloom/core. The route's
 * own logic is thin (window parse + sparkline derivation); the
 * aggregator is already covered by `tests/BudgetStats.test.ts` in the
 * root suite.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildBudgetEventsRouter } from '../server/routes/budget-events.js';

let tmpDir: string;
const originalEnv = process.env.CTXLOOM_TELEMETRY_DIR;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-events-test-'));
  process.env.CTXLOOM_TELEMETRY_DIR = tmpDir;
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (originalEnv === undefined) delete process.env.CTXLOOM_TELEMETRY_DIR;
  else process.env.CTXLOOM_TELEMETRY_DIR = originalEnv;
});

/** Seed today's UTC file with one event per line. */
function seed(events: Array<Record<string, unknown>>): void {
  const today = new Date();
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, '0');
  const d = String(today.getUTCDate()).padStart(2, '0');
  const file = path.join(tmpDir, `budget-events-${y}-${m}-${d}.jsonl`);
  const lines = events
    .map((e) => JSON.stringify({ ts: today.toISOString(), ...e }))
    .join('\n') + '\n';
  fs.writeFileSync(file, lines, 'utf-8');
}

function makeApp() {
  const app = express();
  app.use('/api/budget-events', buildBudgetEventsRouter());
  return app;
}

describe('GET /api/budget-events', () => {
  it('returns the empty-state envelope when no events exist in the window', async () => {
    const res = await request(makeApp()).get('/api/budget-events');
    expect(res.status).toBe(200);
    expect(res.body.totalEvents).toBe(0);
    expect(res.body.fallbackTable).toEqual([]);
    expect(res.body.distributionTable).toEqual([]);
    expect(res.body.breachesPerDay).toEqual([]);
    expect(res.body.window.days).toBe(14); // default window
  });

  it('aggregates fallback distribution + token percentiles', async () => {
    seed([
      { event: 'mcp.budget.exceeded', tool: 'ctx_get_file', original_tokens: 9000 },
      { event: 'mcp.fallback.used', tool: 'ctx_get_file', mode: 'skeleton' },
      { event: 'mcp.budget.exceeded', tool: 'ctx_get_file', original_tokens: 12_000 },
      { event: 'mcp.fallback.used', tool: 'ctx_get_file', mode: 'skeleton' },
      { event: 'mcp.budget.exceeded', tool: 'ctx_get_file', original_tokens: 15_000 },
      { event: 'mcp.fallback.used', tool: 'ctx_get_file', mode: 'truncate' },
    ]);
    const res = await request(makeApp()).get('/api/budget-events');
    expect(res.status).toBe(200);
    expect(res.body.totalEvents).toBe(6);

    const fb = res.body.fallbackTable.find((r: { tool: string }) => r.tool === 'ctx_get_file');
    expect(fb).toBeDefined();
    expect(fb.breaches).toBe(3);
    expect(Math.round(fb.skeletonPct)).toBe(67); // 2 of 3
    expect(Math.round(fb.truncatePct)).toBe(33); // 1 of 3

    const dist = res.body.distributionTable.find((r: { tool: string }) => r.tool === 'ctx_get_file');
    expect(dist).toBeDefined();
    expect(dist.n).toBe(3);
    expect(dist.min).toBe(9000);
    expect(dist.max).toBe(15_000);
    expect(dist.p50).toBe(12_000);
  });

  it('honors --window=7d', async () => {
    seed([{ event: 'mcp.budget.exceeded', tool: 'ctx_search', original_tokens: 5000 }]);
    const res = await request(makeApp()).get('/api/budget-events?window=7d');
    expect(res.status).toBe(200);
    expect(res.body.window.days).toBe(7);
    // Window span ≈ 7 days (allow ±1 day for the inclusive boundary).
    const span = Math.round(
      (Date.parse(res.body.window.until) - Date.parse(res.body.window.since)) /
        (24 * 60 * 60 * 1000),
    );
    expect(span).toBeGreaterThanOrEqual(6);
    expect(span).toBeLessThanOrEqual(8);
  });

  it('honors --tool=<name> filter', async () => {
    seed([
      { event: 'mcp.budget.exceeded', tool: 'ctx_get_file', original_tokens: 9000 },
      { event: 'mcp.budget.exceeded', tool: 'ctx_search', original_tokens: 5000 },
    ]);
    const res = await request(makeApp()).get('/api/budget-events?tool=ctx_search');
    expect(res.status).toBe(200);
    // Only events for ctx_search should appear in the aggregation tables.
    const tools = (res.body.distributionTable as Array<{ tool: string }>).map((r) => r.tool);
    expect(tools).toContain('ctx_search');
    expect(tools).not.toContain('ctx_get_file');
  });

  it.each(['foo', '0d', '-3d', ''])(
    'returns 400 on invalid --window=%j',
    async (badWindow) => {
      const res = await request(makeApp()).get(`/api/budget-events?window=${encodeURIComponent(badWindow)}`);
      // Empty string falls through to default (14d), so 200 is expected there.
      if (badWindow === '') {
        expect(res.status).toBe(200);
        expect(res.body.window.days).toBe(14);
      } else {
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/window/i);
      }
    },
  );

  it('computes per-day breach buckets for the sparkline', async () => {
    seed([
      { event: 'mcp.budget.exceeded', tool: 'ctx_get_file', original_tokens: 9000 },
      { event: 'mcp.budget.exceeded', tool: 'ctx_get_file', original_tokens: 12_000 },
      { event: 'mcp.fallback.used', tool: 'ctx_get_file', mode: 'skeleton' },
    ]);
    const res = await request(makeApp()).get('/api/budget-events');
    expect(res.status).toBe(200);
    expect(res.body.breachesPerDay).toHaveLength(1);
    // 2 mcp.budget.exceeded events on this day; the mcp.fallback.used
    // is NOT counted (avoids double-counting one breach as 2).
    expect(res.body.breachesPerDay[0].count).toBe(2);
    expect(res.body.breachesPerDay[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
