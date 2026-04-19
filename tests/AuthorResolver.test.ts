import { describe, it, expect, beforeEach } from 'vitest';
import { AuthorResolver } from '../src/review/AuthorResolver.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

describe('AuthorResolver', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctxloom-test-'));
  });

  it('resolves from yml mapping first', async () => {
    const authorsYml = `mappings:\n  alice@x.com: alice-gh\nignore: []`;
    await fs.writeFile(path.join(tmpDir, 'authors.yml'), authorsYml);
    const resolver = new AuthorResolver(tmpDir);
    await resolver.load();
    expect(resolver.resolve('alice@x.com')).toBe('alice-gh');
  });

  it('returns undefined for unmapped email', async () => {
    const resolver = new AuthorResolver(tmpDir);
    await resolver.load();
    expect(resolver.resolve('unknown@x.com')).toBeUndefined();
  });

  it('returns null for ignored email', async () => {
    const authorsYml = `mappings: {}\nignore:\n  - bot@dependabot.com`;
    await fs.writeFile(path.join(tmpDir, 'authors.yml'), authorsYml);
    const resolver = new AuthorResolver(tmpDir);
    await resolver.load();
    expect(resolver.resolve('bot@dependabot.com')).toBeNull();
  });

  it('resolves from cache when yml has no mapping', async () => {
    const cache = { 'bob@x.com': 'bobsmith' };
    await fs.writeFile(
      path.join(tmpDir, 'authors-cache.json'),
      JSON.stringify(cache),
    );
    const resolver = new AuthorResolver(tmpDir);
    await resolver.load();
    expect(resolver.resolve('bob@x.com')).toBe('bobsmith');
  });

  it('yml mapping wins over cache', async () => {
    const authorsYml = `mappings:\n  bob@x.com: bob-override\nignore: []`;
    const cache = { 'bob@x.com': 'bob-cache' };
    await fs.writeFile(path.join(tmpDir, 'authors.yml'), authorsYml);
    await fs.writeFile(
      path.join(tmpDir, 'authors-cache.json'),
      JSON.stringify(cache),
    );
    const resolver = new AuthorResolver(tmpDir);
    await resolver.load();
    expect(resolver.resolve('bob@x.com')).toBe('bob-override');
  });

  it('unmapped returns emails with no resolution', async () => {
    const authorsYml = `mappings:\n  alice@x.com: alice-gh\nignore: []`;
    await fs.writeFile(path.join(tmpDir, 'authors.yml'), authorsYml);
    const resolver = new AuthorResolver(tmpDir);
    await resolver.load();
    const result = resolver.unmapped(['alice@x.com', 'bob@x.com', 'carol@x.com']);
    expect(result).toEqual(['bob@x.com', 'carol@x.com']);
  });
});
