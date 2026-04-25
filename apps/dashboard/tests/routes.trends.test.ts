import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { buildTrendsRouter } from '../server/routes/trends.js';
import type { DashboardContext } from '../server/loader.js';

function makeCtx(root: string): DashboardContext {
  return {
    root,
    graph: {} as any,
    overlay: {} as any,
    gitEnabled: false,
    lastIndexed: new Date(),
  };
}

function row(unixSeconds: number, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    timestamp: new Date(unixSeconds * 1000).toISOString(),
    unixSeconds,
    totalFiles: 100,
    totalEdges: 200,
    deadFiles: 5,
    avgBusFactor: 2,
    highRiskFiles: 3,
    churnLinesLast7d: 1000,
    source: 'cli',
    gitSha: 'abc',
    ...overrides,
  });
}

describe('GET /api/trends', () => {
  let rootDir: string;
  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trends-route-'));
    const dir = path.join(rootDir, '.ctxloom', 'trends');
    fs.mkdirSync(dir, { recursive: true });
  });
  afterEach(() => { fs.rmSync(rootDir, { recursive: true, force: true }); });

  function writeRows(rows: string[]): void {
    fs.writeFileSync(path.join(rootDir, '.ctxloom', 'trends', 'snapshots.jsonl'), rows.join('\n') + '\n');
  }

  it('returns 200 with default 30d range', async () => {
    const now = Math.floor(Date.now() / 1000);
    writeRows([row(now - 100), row(now)]);
    const app = express();
    app.use('/api/trends', buildTrendsRouter(makeCtx(rootDir)));
    const res = await request(app).get('/api/trends');
    expect(res.status).toBe(200);
    expect(res.body.range).toBe('30d');
    expect(res.body.snapshots).toHaveLength(2);
  });

  it('range=7d filters out older rows', async () => {
    const now = Math.floor(Date.now() / 1000);
    const eightDaysAgo = now - 8 * 24 * 3600;
    writeRows([row(eightDaysAgo), row(now)]);
    const app = express();
    app.use('/api/trends', buildTrendsRouter(makeCtx(rootDir)));
    const res = await request(app).get('/api/trends?range=7d');
    expect(res.status).toBe(200);
    expect(res.body.snapshots).toHaveLength(1);
    expect(res.body.snapshots[0].unixSeconds).toBe(now);
  });

  it('range=all includes all rows', async () => {
    writeRows([row(1000), row(2000), row(Math.floor(Date.now() / 1000))]);
    const app = express();
    app.use('/api/trends', buildTrendsRouter(makeCtx(rootDir)));
    const res = await request(app).get('/api/trends?range=all');
    expect(res.status).toBe(200);
    expect(res.body.snapshots).toHaveLength(3);
  });

  it('returns empty snapshots when file is missing', async () => {
    const app = express();
    app.use('/api/trends', buildTrendsRouter(makeCtx(rootDir)));
    const res = await request(app).get('/api/trends');
    expect(res.status).toBe(200);
    expect(res.body.snapshots).toEqual([]);
    expect(res.body.totalCount).toBe(0);
  });
});
