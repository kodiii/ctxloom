import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { WikiGenerator } from '../src/graph/WikiGenerator.js';
import { Skeletonizer } from '../src/ast/Skeletonizer.js';

function makeClusteredGraph(): DependencyGraph {
  const g = new DependencyGraph();
  g.addEdge('src/auth/user.ts', 'src/auth/session.ts');
  g.addEdge('src/auth/user.ts', 'src/auth/token.ts');
  g.addEdge('src/auth/session.ts', 'src/auth/token.ts');
  g.addEdge('src/api/handler.ts', 'src/api/router.ts');
  g.addEdge('src/api/router.ts', 'src/api/middleware.ts');
  g.addEdge('src/api/handler.ts', 'src/api/middleware.ts');
  g.addEdge('src/api/handler.ts', 'src/auth/user.ts');
  return g;
}

describe('WikiGenerator', () => {
  let tmpDir: string;
  let skeletonizer: Skeletonizer;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-wiki-test-'));
    skeletonizer = new Skeletonizer();
    await skeletonizer.init();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates wiki directory and returns a result', async () => {
    const gen = new WikiGenerator(makeClusteredGraph(), tmpDir, skeletonizer);
    const result = await gen.generate();
    expect(result.wikiDir).toBe(path.join(tmpDir, '.ctxloom', 'wiki'));
    expect(fs.existsSync(result.wikiDir)).toBe(true);
    expect(result.written.length + result.skipped.length).toBeGreaterThan(0);
  });

  it('writes index.md with wiki header', async () => {
    const gen = new WikiGenerator(makeClusteredGraph(), tmpDir, skeletonizer);
    const result = await gen.generate();
    const indexPath = path.join(result.wikiDir, 'index.md');
    expect(fs.existsSync(indexPath)).toBe(true);
    const content = fs.readFileSync(indexPath, 'utf-8');
    expect(content).toContain('# ctxloom Wiki');
    expect(content).toContain('communities');
  });

  it('writes at least one community page', async () => {
    const gen = new WikiGenerator(makeClusteredGraph(), tmpDir, skeletonizer);
    const result = await gen.generate();
    const communityPages = result.written.filter(p => p.slug !== 'index');
    expect(communityPages.length).toBeGreaterThan(0);
  });

  it('community page contains Files section and community name', async () => {
    const gen = new WikiGenerator(makeClusteredGraph(), tmpDir, skeletonizer);
    const result = await gen.generate();
    const page = result.written.find(p => p.slug !== 'index');
    expect(page).toBeDefined();
    const content = fs.readFileSync(page!.filePath, 'utf-8');
    expect(content).toContain('## Files');
    expect(content).toContain(page!.communityName);
  });

  it('skips pages on second call when content unchanged', async () => {
    const graph = makeClusteredGraph();
    const gen = new WikiGenerator(graph, tmpDir, skeletonizer);
    const first = await gen.generate();
    const second = await gen.generate();
    expect(second.written.length).toBe(0);
    expect(second.skipped.length).toBe(first.written.length);
  });

  it('force=true rewrites all pages', async () => {
    const graph = makeClusteredGraph();
    const gen = new WikiGenerator(graph, tmpDir, skeletonizer);
    const first = await gen.generate();
    const second = await gen.generate(true);
    expect(second.written.length).toBe(first.written.length);
    expect(second.skipped.length).toBe(0);
  });

  it('handles empty graph without writing any files', async () => {
    const gen = new WikiGenerator(new DependencyGraph(), tmpDir, skeletonizer);
    const result = await gen.generate();
    expect(result.written.length).toBe(0);
    expect(result.skipped.length).toBe(0);
  });

  it('stores hash comment on line 1 of every written page', async () => {
    const gen = new WikiGenerator(makeClusteredGraph(), tmpDir, skeletonizer);
    const result = await gen.generate();
    for (const page of result.written) {
      const firstLine = fs.readFileSync(page.filePath, 'utf-8').split('\n')[0];
      expect(firstLine).toMatch(/^<!-- hash: [a-f0-9]+ -->$/);
    }
  });

  it('cross-community Dependencies section appears when communities are coupled', async () => {
    const gen = new WikiGenerator(makeClusteredGraph(), tmpDir, skeletonizer);
    const result = await gen.generate();
    const hasDeps = result.written.some(p => {
      if (p.slug === 'index') return false;
      const content = fs.readFileSync(p.filePath, 'utf-8');
      return content.includes('## Dependencies');
    });
    expect(hasDeps).toBe(true);
  });
});
