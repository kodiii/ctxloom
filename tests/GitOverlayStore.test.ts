/**
 * Tests for GitOverlayStore — coordinator that drives GitHistoryMiner and
 * fans commit events into CoChangeIndex, ChurnIndex, and OwnershipIndex.
 *
 * Uses real temp git repos (same pattern as GitHistoryMiner tests).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { GitOverlayStore } from '../src/git/GitOverlayStore.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test Author',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test Author',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
    },
    stdio: 'pipe',
  }).toString().trim();
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function makeRepo(): Promise<string> {
  const dir = path.join(os.tmpdir(), `overlay-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  git(dir, 'init');
  git(dir, 'config user.email "test@example.com"');
  git(dir, 'config user.name "Test Author"');
  return dir;
}

// ---------------------------------------------------------------------------
// Test suite: rebuild() populates all three indices
// ---------------------------------------------------------------------------

describe('GitOverlayStore', () => {
  describe('rebuild() — populates all three indices', () => {
    let repoDir: string;

    beforeAll(async () => {
      repoDir = await makeRepo();

      // Commit 1: touch a.ts and b.ts
      await writeFile(path.join(repoDir, 'src', 'a.ts'), 'const x = 1;\nconst y = 2;\n');
      await writeFile(path.join(repoDir, 'src', 'b.ts'), 'const z = 3;\n');
      git(repoDir, 'add -A');
      git(repoDir, 'commit -m "feat: add a and b"');

      // Commit 2: touch a.ts and b.ts again (creates co-change pair)
      await writeFile(path.join(repoDir, 'src', 'a.ts'), 'const x = 10;\nconst y = 20;\n');
      await writeFile(path.join(repoDir, 'src', 'b.ts'), 'const z = 30;\nconst w = 40;\n');
      git(repoDir, 'add -A');
      git(repoDir, 'commit -m "feat: update a and b"');

      // Commit 3: touch a.ts and b.ts a third time (3 shared commits meets co-change threshold)
      await writeFile(path.join(repoDir, 'src', 'a.ts'), 'const x = 100;\nconst y = 200;\nconst extra = 300;\n');
      await writeFile(path.join(repoDir, 'src', 'b.ts'), 'const z = 300;\n');
      git(repoDir, 'add -A');
      git(repoDir, 'commit -m "fix: update a and b again"');
    }, 30_000);

    afterAll(async () => {
      if (repoDir) await fs.rm(repoDir, { recursive: true, force: true });
    });

    it('churn.statsFor returns non-null with correct commits count for a touched file', async () => {
      const store = new GitOverlayStore(repoDir);
      await store.rebuild();

      const stats = store.churn.statsFor('src/a.ts');
      expect(stats).not.toBeNull();
      expect(stats!.commits).toBe(3);
    });

    it('ownership.statsFor returns non-null with owners list for a touched file', async () => {
      const store = new GitOverlayStore(repoDir);
      await store.rebuild();

      const stats = store.ownership.statsFor('src/a.ts');
      expect(stats).not.toBeNull();
      expect(stats!.owners.length).toBeGreaterThan(0);
      expect(stats!.owners[0]!.email).toBe('test@example.com');
    });

    it('coChange.size().pairs > 0 after commits with overlapping files', async () => {
      const store = new GitOverlayStore(repoDir);
      await store.rebuild();

      const { pairs } = store.coChange.size();
      expect(pairs).toBeGreaterThan(0);
    });

    it('stats().commits matches total commit count scanned', async () => {
      const store = new GitOverlayStore(repoDir);
      await store.rebuild();

      const { commits } = store.stats();
      expect(commits).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Test suite: refresh() only ingests new commits
  // ---------------------------------------------------------------------------

  describe('refresh() — only ingests new commits', () => {
    let repoDir: string;

    beforeAll(async () => {
      repoDir = await makeRepo();

      // Commit 1
      await writeFile(path.join(repoDir, 'src', 'a.ts'), 'const a = 1;\n');
      git(repoDir, 'add -A');
      git(repoDir, 'commit -m "feat: commit 1"');

      // Commit 2
      await writeFile(path.join(repoDir, 'src', 'b.ts'), 'const b = 2;\n');
      git(repoDir, 'add -A');
      git(repoDir, 'commit -m "feat: commit 2"');
    }, 30_000);

    afterAll(async () => {
      if (repoDir) await fs.rm(repoDir, { recursive: true, force: true });
    });

    it('ingests exactly 1 new commit after rebuild on 2-commit repo', async () => {
      const store = new GitOverlayStore(repoDir);
      await store.rebuild();

      expect(store.stats().commits).toBe(2);

      // Add a new commit
      await writeFile(path.join(repoDir, 'src', 'c.ts'), 'const c = 3;\n');
      git(repoDir, 'add -A');
      git(repoDir, 'commit -m "feat: commit 3"');

      const result = await store.refresh();

      expect(result.commitsIngested).toBe(1);
      expect(store.stats().commits).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Test suite: saveSnapshot() + loadSnapshot()
  // ---------------------------------------------------------------------------

  describe('saveSnapshot() + loadSnapshot()', () => {
    let repoDir: string;

    beforeAll(async () => {
      repoDir = await makeRepo();

      await writeFile(path.join(repoDir, 'src', 'a.ts'), 'const a = 1;\nconst b = 2;\n');
      git(repoDir, 'add -A');
      git(repoDir, 'commit -m "feat: initial"');

      await writeFile(path.join(repoDir, 'src', 'a.ts'), 'const a = 10;\nconst b = 20;\n');
      git(repoDir, 'add -A');
      git(repoDir, 'commit -m "feat: update"');
    }, 30_000);

    afterAll(async () => {
      if (repoDir) await fs.rm(repoDir, { recursive: true, force: true });
    });

    it('loadSnapshot() restores churn data that matches original rebuild', async () => {
      const store = new GitOverlayStore(repoDir);
      await store.rebuild();
      const originalStats = store.churn.statsFor('src/a.ts');
      expect(originalStats).not.toBeNull();

      await store.saveSnapshot();

      const store2 = new GitOverlayStore(repoDir);
      const loaded = await store2.loadSnapshot();

      expect(loaded).toBe(true);

      const restoredStats = store2.churn.statsFor('src/a.ts');
      expect(restoredStats).not.toBeNull();
      expect(restoredStats!.commits).toBe(originalStats!.commits);
      expect(restoredStats!.churnLines).toBe(originalStats!.churnLines);
    });

    it('loadSnapshot() restores stats() metadata', async () => {
      const store = new GitOverlayStore(repoDir);
      await store.rebuild();
      const originalMeta = store.stats();

      await store.saveSnapshot();

      const store2 = new GitOverlayStore(repoDir);
      await store2.loadSnapshot();

      const restoredMeta = store2.stats();
      expect(restoredMeta.commits).toBe(originalMeta.commits);
      expect(restoredMeta.lastCommit).toBe(originalMeta.lastCommit);
    });
  });

  // ---------------------------------------------------------------------------
  // Test suite: loadSnapshot() returns false when no sidecar exists
  // ---------------------------------------------------------------------------

  describe('loadSnapshot() — no sidecar file', () => {
    let repoDir: string;

    beforeAll(async () => {
      repoDir = await makeRepo();
    });

    afterAll(async () => {
      if (repoDir) await fs.rm(repoDir, { recursive: true, force: true });
    });

    it('returns false when git-overlay.json does not exist', async () => {
      const store = new GitOverlayStore(repoDir);
      const result = await store.loadSnapshot();
      expect(result).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Test suite: empty repo
  // ---------------------------------------------------------------------------

  describe('empty repo — no commits', () => {
    let repoDir: string;

    beforeAll(async () => {
      repoDir = await makeRepo();
      // No commits added
    });

    afterAll(async () => {
      if (repoDir) await fs.rm(repoDir, { recursive: true, force: true });
    });

    it('rebuild() completes without error on a repo with no commits', async () => {
      const store = new GitOverlayStore(repoDir);
      await expect(store.rebuild()).resolves.not.toThrow();
    });

    it('stats().commits === 0 after rebuild on empty repo', async () => {
      const store = new GitOverlayStore(repoDir);
      await store.rebuild();
      expect(store.stats().commits).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Test suite: stats()
  // ---------------------------------------------------------------------------

  describe('stats()', () => {
    let repoDir: string;
    let headSha: string;

    beforeAll(async () => {
      repoDir = await makeRepo();

      await writeFile(path.join(repoDir, 'src', 'a.ts'), 'const a = 1;\n');
      git(repoDir, 'add -A');
      git(repoDir, 'commit -m "feat: add a"');

      await writeFile(path.join(repoDir, 'src', 'b.ts'), 'const b = 2;\n');
      git(repoDir, 'add -A');
      git(repoDir, 'commit -m "feat: add b"');

      headSha = git(repoDir, 'rev-parse HEAD');
    }, 30_000);

    afterAll(async () => {
      if (repoDir) await fs.rm(repoDir, { recursive: true, force: true });
    });

    it('returns { commits, lastCommit, windowDays } after rebuild', async () => {
      const store = new GitOverlayStore(repoDir, { windowDays: 180 });
      await store.rebuild();

      const s = store.stats();
      expect(s.commits).toBe(2);
      expect(s.lastCommit).toBe(headSha);
      expect(s.windowDays).toBe(180);
    });

    it('lastCommit is null before any rebuild or load', () => {
      const store = new GitOverlayStore(repoDir);
      expect(store.stats().lastCommit).toBeNull();
    });
  });
});
