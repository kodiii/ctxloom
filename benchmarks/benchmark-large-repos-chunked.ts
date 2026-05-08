#!/usr/bin/env tsx
/**
 * benchmark-large-repos-chunked.ts — full-source skeletonization
 * benchmark that survives the tree-sitter memory leak.
 *
 * Why chunked: Skeletonizer / ASTParser don't dispose tree-sitter
 * `tree` objects (WASM-allocated; V8 GC can't reclaim under pressure).
 * Running thousands of files in one process OOMs around the 1k mark
 * even with --max-old-space-size=8192. Spawning a fresh child per
 * 200-file chunk resets the heap between batches; we get full coverage
 * at a fixed memory ceiling.
 *
 * The leak itself is filed as a separate fix (tree.delete() in
 * ASTParser parse methods). Once that lands this script can collapse
 * back to a single process.
 *
 * Output:
 *   - benchmarks/large-repos-results.json
 *   - Markdown table on stdout (paste into BenchmarkSection.tsx)
 */
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

interface RepoSpec {
  name: string;
  url: string;
}

const REPOS: RepoSpec[] = [
  { name: 'vercel/next.js', url: 'https://github.com/vercel/next.js.git' },
  { name: 'nestjs/nest', url: 'https://github.com/nestjs/nest.git' },
  { name: 'withastro/astro', url: 'https://github.com/withastro/astro.git' },
  { name: 'honojs/hono', url: 'https://github.com/honojs/hono.git' },
  { name: 'vitejs/vite', url: 'https://github.com/vitejs/vite.git' },
];

const WORK_DIR = path.join(os.tmpdir(), 'ctxloom-bench-large');
const CHUNK_SIZE = 200;

const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'lib', 'target',
  '.next', '.nuxt', '.cache', '.turbo', 'coverage', 'fixtures',
  'examples', 'test', 'tests', '__tests__', 'e2e', 'benchmark',
  'benchmarks', 'docs', 'website',
]);

const __filename = fileURLToPath(import.meta.url);

interface ChunkResult {
  rawChars: number;
  skelChars: number;
  files: number;
  failed: number;
}

interface RepoResult {
  name: string;
  files: number;
  totalRawChars: number;
  totalSkelChars: number;
  totalRawTokensApprox: number;
  totalSkelTokensApprox: number;
  reductionPct: number;
  failedFiles: number;
  durationMs: number;
}

function cloneRepo(name: string, url: string): string {
  const dir = path.join(WORK_DIR, name.replace('/', '__'));
  if (!fs.existsSync(dir)) {
    process.stdout.write(`  cloning ${name}…`);
    const t0 = Date.now();
    execSync(`git clone --depth=1 "${url}" "${dir}"`, { stdio: 'pipe' });
    process.stdout.write(` ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  } else {
    process.stdout.write(`  using cached ${name}\n`);
  }
  return dir;
}

function findSourceFiles(dir: string): string[] {
  const out: string[] = [];
  function walk(d: string): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name)) walk(path.join(d, e.name));
      } else if (SOURCE_EXTS.some((ext) => e.name.endsWith(ext))) {
        if (e.name.endsWith('.d.ts')) continue;
        if (/\.(test|spec)\./.test(e.name)) continue;
        out.push(path.join(d, e.name));
      }
    }
  }
  walk(dir);
  return out;
}

function approxTokens(chars: number): number {
  return Math.round(chars / 4);
}

/**
 * Worker mode — invoked by the parent via `tsx benchmark-large-repos-chunked.ts --worker`.
 * Reads file paths from stdin (newline-separated), skeletonizes each,
 * writes a JSON ChunkResult to stdout. Lives + dies in one chunk.
 */
async function runWorker(): Promise<void> {
  const stdin = fs.readFileSync(0, 'utf-8');
  const files = stdin.split('\n').map((s) => s.trim()).filter(Boolean);
  const { Skeletonizer } = await import('../packages/core/src/ast/Skeletonizer.ts');
  const sk = new Skeletonizer();
  await sk.init();

  let rawChars = 0;
  let skelChars = 0;
  let failed = 0;
  for (const file of files) {
    let raw: string;
    try { raw = fs.readFileSync(file, 'utf-8'); }
    catch { failed++; continue; }
    rawChars += raw.length;
    try {
      const out = await sk.skeletonize(file);
      skelChars += out.length;
    } catch {
      // Conservative: count raw size when we can't compress, so we
      // don't pretend the file shrank. Same policy as the small-repo
      // bench.
      skelChars += raw.length;
      failed++;
    }
  }

  const result: ChunkResult = { rawChars, skelChars, files: files.length, failed };
  process.stdout.write(JSON.stringify(result));
}

if (process.argv.includes('--worker')) {
  runWorker().catch((err) => {
    process.stderr.write(`worker error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
} else {
  await main();
}

async function main(): Promise<void> {
  console.log('ctxloom large-repo benchmark (chunked)');
  console.log('======================================\n');
  fs.mkdirSync(WORK_DIR, { recursive: true });

  const results: RepoResult[] = [];
  for (const spec of REPOS) {
    console.log(`── ${spec.name} ──`);
    const dir = cloneRepo(spec.name, spec.url);
    const files = findSourceFiles(dir);
    console.log(`  ${files.length.toLocaleString()} source files · ${Math.ceil(files.length / CHUNK_SIZE)} chunks of ${CHUNK_SIZE}`);

    const t0 = Date.now();
    let rawChars = 0;
    let skelChars = 0;
    let failed = 0;

    for (let start = 0; start < files.length; start += CHUNK_SIZE) {
      const chunk = files.slice(start, start + CHUNK_SIZE);
      const stdinText = chunk.join('\n');
      const child = spawnSync('npx', ['tsx', __filename, '--worker'], {
        input: stdinText,
        encoding: 'utf-8',
        env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' },
        maxBuffer: 16 * 1024 * 1024,
      });
      if (child.status !== 0) {
        process.stderr.write(`  chunk ${start}-${start + chunk.length} failed (exit ${child.status}); falling back to raw counts\n`);
        // Fall back: count raw chars only, treat all files as failed.
        for (const f of chunk) {
          try {
            const raw = fs.readFileSync(f, 'utf-8');
            rawChars += raw.length;
            skelChars += raw.length;
          } catch { /* ignore */ }
        }
        failed += chunk.length;
        continue;
      }
      try {
        const r = JSON.parse(child.stdout) as ChunkResult;
        rawChars += r.rawChars;
        skelChars += r.skelChars;
        failed += r.failed;
      } catch (err) {
        process.stderr.write(`  chunk ${start} stdout parse failed: ${String(err)}\n`);
        failed += chunk.length;
      }
      process.stdout.write(`    ${Math.min(start + CHUNK_SIZE, files.length).toLocaleString()}/${files.length.toLocaleString()}…\n`);
    }

    const durationMs = Date.now() - t0;
    const reductionPct = rawChars > 0 ? Math.round((1 - skelChars / rawChars) * 100) : 0;
    const r: RepoResult = {
      name: spec.name,
      files: files.length,
      totalRawChars: rawChars,
      totalSkelChars: skelChars,
      totalRawTokensApprox: approxTokens(rawChars),
      totalSkelTokensApprox: approxTokens(skelChars),
      reductionPct,
      failedFiles: failed,
      durationMs,
    };
    results.push(r);
    console.log(
      `  ${fmtTokens(r.totalRawTokensApprox)} → ${fmtTokens(r.totalSkelTokensApprox)} tokens · ${r.reductionPct}% · ${(durationMs / 1000).toFixed(1)}s · ${r.failedFiles} failed\n`,
    );
  }

  const totalRaw = results.reduce((s, r) => s + r.totalRawTokensApprox, 0);
  const totalSk = results.reduce((s, r) => s + r.totalSkelTokensApprox, 0);
  const aggregate = totalRaw > 0 ? Math.round((1 - totalSk / totalRaw) * 100) : 0;

  console.log('\n── Markdown table ────────────────────────────────────────');
  console.log('| Repo | Files | Raw tokens | Skeleton tokens | Reduction |');
  console.log('|---|---:|---:|---:|---:|');
  for (const r of results) {
    console.log(`| ${r.name} | ${r.files.toLocaleString()} | ${fmtTokens(r.totalRawTokensApprox)} | ${fmtTokens(r.totalSkelTokensApprox)} | ${r.reductionPct}% |`);
  }
  console.log(`| **Weighted average** | — | ${fmtTokens(totalRaw)} | ${fmtTokens(totalSk)} | **${aggregate}%** |`);

  const outPath = path.join(process.cwd(), 'benchmarks', 'large-repos-results.json');
  fs.writeFileSync(outPath, JSON.stringify({
    runAt: new Date().toISOString(),
    aggregateReduction: aggregate,
    totalRawTokensApprox: totalRaw,
    totalSkelTokensApprox: totalSk,
    results,
  }, null, 2));
  console.log(`\nResults → ${outPath}`);
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000).toLocaleString()}k`;
  return String(n);
}
