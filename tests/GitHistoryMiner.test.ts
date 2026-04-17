/**
 * Tests for GitHistoryMiner — streaming git log as typed commit events.
 *
 * Creates an isolated temp git repo per test suite, populates it with
 * known commits, and verifies the miner yields correctly-shaped events.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { GitHistoryMiner, type GitCommitEvent } from '../src/git/GitHistoryMiner.js';

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

async function writeLines(filePath: string, count: number): Promise<void> {
  const lines = Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, lines, 'utf8');
}

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

let repoRoot: string;
let sha1: string;
let sha2: string;
let sha3bulk: string;

beforeAll(async () => {
  repoRoot = path.join(os.tmpdir(), `miner-test-${Date.now()}`);
  await fs.mkdir(repoRoot, { recursive: true });

  git(repoRoot, 'init');
  git(repoRoot, 'config user.email "test@example.com"');
  git(repoRoot, 'config user.name "Test Author"');

  // ---------------------------------------------------------------- Commit 1
  await writeLines(path.join(repoRoot, 'src', 'a.ts'), 5);
  await writeLines(path.join(repoRoot, 'src', 'b.ts'), 3);
  git(repoRoot, 'add -A');
  git(repoRoot, 'commit -m "feat: add a and b"');
  sha1 = git(repoRoot, 'rev-parse HEAD');

  // ---------------------------------------------------------------- Commit 2 — modify a.ts (+2 lines appended, -1 via overwrite)
  // Overwrite a.ts with 6 lines (was 5) — net: +2/-1 per numstat
  const aPath = path.join(repoRoot, 'src', 'a.ts');
  const existing = await fs.readFile(aPath, 'utf8');
  const lines = existing.trimEnd().split('\n');
  lines.splice(2, 1); // remove one line
  lines.push('new line A', 'new line B', 'new line C'); // add three lines (+2 net)
  await fs.writeFile(aPath, lines.join('\n') + '\n', 'utf8');

  await writeLines(path.join(repoRoot, 'src', 'c.ts'), 4);
  git(repoRoot, 'add -A');
  git(repoRoot, 'commit -m "feat: add c and update a"');
  sha2 = git(repoRoot, 'rev-parse HEAD');

  // ---------------------------------------------------------------- Commit 3 — bulk: touch >50 files
  for (let i = 0; i < 55; i++) {
    await fs.writeFile(path.join(repoRoot, `bulk-${i}.txt`), `bulk file ${i}\n`, 'utf8');
  }
  git(repoRoot, 'add -A');
  git(repoRoot, 'commit -m "chore: bulk add 55 files"');
  sha3bulk = git(repoRoot, 'rev-parse HEAD');
}, 30_000);

afterAll(async () => {
  if (repoRoot) {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitHistoryMiner', () => {
  describe('stream({ sinceDays })', () => {
    it('yields events in reverse-chronological order (newest first)', async () => {
      const miner = new GitHistoryMiner(repoRoot);
      const events: GitCommitEvent[] = [];
      for await (const ev of miner.stream({ sinceDays: 365 })) {
        events.push(ev);
      }
      expect(events.length).toBe(3);
      // Timestamps should be non-increasing (newest first)
      for (let i = 1; i < events.length; i++) {
        expect(events[i - 1].timestamp).toBeGreaterThanOrEqual(events[i].timestamp);
      }
    });

    it('each event has the correct shape', async () => {
      const miner = new GitHistoryMiner(repoRoot);
      const events: GitCommitEvent[] = [];
      for await (const ev of miner.stream({ sinceDays: 365 })) {
        events.push(ev);
      }
      for (const ev of events) {
        expect(ev).toMatchObject({
          sha: expect.stringMatching(/^[0-9a-f]{40}$/),
          author: expect.any(String),
          authorEmail: expect.any(String),
          timestamp: expect.any(Number),
          message: expect.any(String),
          files: expect.any(Array),
          isMerge: expect.any(Boolean),
          isBulk: expect.any(Boolean),
        });
        // All file entries have required fields
        for (const f of ev.files) {
          expect(f).toMatchObject({
            path: expect.any(String),
            added: expect.any(Number),
            deleted: expect.any(Number),
          });
        }
      }
    });

    it('populates author name and email from git config', async () => {
      const miner = new GitHistoryMiner(repoRoot);
      const events: GitCommitEvent[] = [];
      for await (const ev of miner.stream({ sinceDays: 365 })) {
        events.push(ev);
      }
      for (const ev of events) {
        expect(ev.author).toBe('Test Author');
        expect(ev.authorEmail).toBe('test@example.com');
      }
    });

    it('commit 1 has src/a.ts (+5 lines) and src/b.ts (+3 lines)', async () => {
      const miner = new GitHistoryMiner(repoRoot);
      const events: GitCommitEvent[] = [];
      for await (const ev of miner.stream({ sinceDays: 365 })) {
        events.push(ev);
      }
      // Commit 1 is the oldest — last in reverse-chrono order
      const commit1 = events.find((e) => e.sha === sha1);
      expect(commit1).toBeDefined();
      const fileA = commit1!.files.find((f) => f.path === 'src/a.ts');
      const fileB = commit1!.files.find((f) => f.path === 'src/b.ts');
      expect(fileA).toBeDefined();
      expect(fileA!.added).toBe(5);
      expect(fileB).toBeDefined();
      expect(fileB!.added).toBe(3);
    });

    it('commit 2 touches src/a.ts and src/c.ts', async () => {
      const miner = new GitHistoryMiner(repoRoot);
      const events: GitCommitEvent[] = [];
      for await (const ev of miner.stream({ sinceDays: 365 })) {
        events.push(ev);
      }
      const commit2 = events.find((e) => e.sha === sha2);
      expect(commit2).toBeDefined();
      const paths = commit2!.files.map((f) => f.path);
      expect(paths).toContain('src/a.ts');
      expect(paths).toContain('src/c.ts');
    });

    it('non-bulk, non-merge commits have isMerge=false and isBulk=false', async () => {
      const miner = new GitHistoryMiner(repoRoot);
      for await (const ev of miner.stream({ sinceDays: 365 })) {
        if (ev.sha === sha1 || ev.sha === sha2) {
          expect(ev.isMerge).toBe(false);
          expect(ev.isBulk).toBe(false);
        }
      }
    });

    it('bulk commit (>50 files) has isBulk=true', async () => {
      const miner = new GitHistoryMiner(repoRoot);
      let foundBulk = false;
      for await (const ev of miner.stream({ sinceDays: 365 })) {
        if (ev.sha === sha3bulk) {
          expect(ev.isBulk).toBe(true);
          foundBulk = true;
        }
      }
      expect(foundBulk).toBe(true);
    });
  });

  describe('headSha()', () => {
    it('returns a 40-character hex SHA matching the bulk commit HEAD', async () => {
      const miner = new GitHistoryMiner(repoRoot);
      const head = await miner.headSha();
      expect(head).toMatch(/^[0-9a-f]{40}$/);
      expect(head).toBe(sha3bulk);
    });
  });

  describe('stream({ sinceSha })', () => {
    it('returns only commits AFTER the given SHA (incremental mode)', async () => {
      const miner = new GitHistoryMiner(repoRoot);
      const events: GitCommitEvent[] = [];
      // Ask for commits after sha1 → should yield commit2 and sha3bulk
      for await (const ev of miner.stream({ sinceSha: sha1 })) {
        events.push(ev);
      }
      expect(events.length).toBe(2);
      const shas = events.map((e) => e.sha);
      expect(shas).toContain(sha2);
      expect(shas).toContain(sha3bulk);
      expect(shas).not.toContain(sha1);
    });

    it('returns empty stream when sinceSha is HEAD', async () => {
      const miner = new GitHistoryMiner(repoRoot);
      const events: GitCommitEvent[] = [];
      for await (const ev of miner.stream({ sinceSha: sha3bulk })) {
        events.push(ev);
      }
      expect(events.length).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('returns empty stream for a repo with no commits', async () => {
      const emptyRepo = path.join(os.tmpdir(), `miner-empty-${Date.now()}`);
      await fs.mkdir(emptyRepo, { recursive: true });
      try {
        git(emptyRepo, 'init');
        git(emptyRepo, 'config user.email "x@x.com"');
        git(emptyRepo, 'config user.name "X"');

        const miner = new GitHistoryMiner(emptyRepo);
        const events: GitCommitEvent[] = [];
        for await (const ev of miner.stream({ sinceDays: 365 })) {
          events.push(ev);
        }
        expect(events.length).toBe(0);
      } finally {
        await fs.rm(emptyRepo, { recursive: true, force: true });
      }
    });
  });
});
