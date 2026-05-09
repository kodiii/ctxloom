import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/**
 * Regression test for the dashboard SPA fallback when ctxloom is
 * installed under a directory whose absolute path contains a
 * "dotfile" segment (`.nvm`, `.config`, `.local`, `.pnpm`, `.yarn`,
 * etc.).
 *
 * Express's underlying `send` library walks every path segment and
 * rejects any segment longer than 1 char that starts with `.` —
 * unless `dotfiles: 'allow'` is passed. Without that option,
 * `res.sendFile(...)` and `express.static(...)` throw a confusing
 * `NotFoundError: Not Found` for every asset and SPA route, which
 * is exactly what affects users who installed ctxloom via nvm.
 *
 * This test reproduces the failure mode by giving express.static
 * a root whose absolute path contains `.test-dotfile`, then asserts
 * both the static asset and the SPA fallback route succeed.
 */
describe('SPA fallback under dotfile-path install', () => {
  let dotfileRoot: string;
  let clientDist: string;

  beforeAll(() => {
    // Create a dist directory with a `.test-dotfile` segment in its
    // absolute path, mimicking a `~/.nvm/...` global install.
    dotfileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-'));
    clientDist = path.join(dotfileRoot, '.test-dotfile', 'client');
    fs.mkdirSync(clientDist, { recursive: true });
    fs.writeFileSync(
      path.join(clientDist, 'index.html'),
      '<!doctype html><title>ok</title>',
    );
    fs.writeFileSync(path.join(clientDist, 'app.js'), 'export {};');
  });

  afterAll(() => {
    fs.rmSync(dotfileRoot, { recursive: true, force: true });
  });

  function buildApp() {
    const app = express();
    // Mirror the production wiring in apps/dashboard/server/index.ts.
    app.use(express.static(clientDist, { dotfiles: 'allow' }));
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'), { dotfiles: 'allow' });
    });
    return app;
  }

  it('serves a static asset whose absolute path contains a dotfile segment', async () => {
    const res = await request(buildApp()).get('/app.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('export');
  });

  it('serves the SPA fallback (index.html) for unknown routes', async () => {
    const res = await request(buildApp()).get('/some/unknown/route');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<title>ok</title>');
  });

  it('serves the SPA fallback for /api/* paths that no router claims', async () => {
    // Regression for the "/api/snapshot → NotFoundError" report:
    // unmatched /api/* paths fall through to the SPA fallback. With
    // the dotfile guard tripped, this 404'd and crashed the response.
    const res = await request(buildApp()).get('/api/snapshot');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<title>ok</title>');
  });
});
