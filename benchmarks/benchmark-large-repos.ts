#!/usr/bin/env tsx
/**
 * benchmark-large-repos.ts — Run skeletonization across the FULL TS/JS
 * surface of each repo (not the 5-file sample the small-repo bench
 * uses), so we can publish honest reduction numbers for codebases
 * representative of what real users index.
 *
 * Picks medium-to-large repos that are TS/JS heavy and pure source
 * (no monorepo build artefacts polluting counts):
 *   - vercel/next.js      (~10k TS/TSX files — large framework)
 *   - nestjs/nest         (~2k TS files — backend framework)
 *   - withastro/astro     (~3k TS/TSX files — full-stack framework)
 *   - honojs/hono         (~600 TS files — small but well-typed)
 *   - vitejs/vite         (~1.5k TS/JS files — bundler)
 *
 * Usage:
 *   npx tsx benchmarks/benchmark-large-repos.ts
 *
 * Output: benchmarks/large-repos-results.json + a Markdown table on
 * stdout that can be pasted into the marketing site.
 *
 * Requires: git, ~5GB free in /tmp/ctxloom-bench-large.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
fs.mkdirSync(WORK_DIR, { recursive: true });

const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'lib', 'target',
  '.next', '.nuxt', '.cache', '.turbo', 'coverage', 'fixtures',
  'examples', 'test', 'tests', '__tests__', 'e2e', 'benchmark',
  'benchmarks', 'docs', 'website',
]);

interface Result {
  name: string;
  files: number;
  totalRawChars: number;
  totalSkeletonChars: number;
  totalRawTokensApprox: number;
  totalSkeletonTokensApprox: number;
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
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name)) walk(path.join(d, e.name));
      } else if (SOURCE_EXTS.some((ext) => e.name.endsWith(ext))) {
        // Skip declaration files — they're already signature-only,
        // skeletonization is a no-op and pollutes the average.
        if (e.name.endsWith('.d.ts')) continue;
        // Skip tests; the reduction signal we care about is on source.
        if (/\.(test|spec)\./.test(e.name)) continue;
        out.push(path.join(d, e.name));
      }
    }
  }
  walk(dir);
  return out;
}

/**
 * Approximate token count: most tokenizers (cl100k_base, GPT-4) produce
 * one token per ~4 chars of TS/JS source. The same approximation is
 * what the dashboard's TokenStats panel uses.
 */
function approxTokens(chars: number): number {
  return Math.round(chars / 4);
}

async function benchmarkRepo(spec: RepoSpec): Promise<Result> {
  const dir = cloneRepo(spec.name, spec.url);
  const files = findSourceFiles(dir);
  process.stdout.write(`  ${files.length.toLocaleString()} source files\n`);

  const { Skeletonizer } = await import('../packages/core/src/ast/Skeletonizer.ts');
  const sk = new Skeletonizer();
  await sk.init();

  let rawChars = 0;
  let skeletonChars = 0;
  let failed = 0;
  const t0 = Date.now();
  let processed = 0;

  for (const file of files) {
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf-8');
    } catch {
      failed++;
      continue;
    }
    rawChars += raw.length;
    try {
      const skel = await sk.skeletonize(file);
      skeletonChars += skel.length;
    } catch {
      // Skeletonization failed (parse error, unsupported language) —
      // count the raw size so we don't undercount the denominator.
      // This is conservative: real users would either fall back to
      // raw or skip the file; either way the reduction number we
      // report shouldn't pretend the file shrank.
      skeletonChars += raw.length;
      failed++;
    }
    processed++;
    if (processed % 500 === 0) {
      process.stdout.write(`    ${processed.toLocaleString()}/${files.length.toLocaleString()}…\n`);
    }
  }

  const durationMs = Date.now() - t0;
  const reductionPct = rawChars > 0
    ? Math.round((1 - skeletonChars / rawChars) * 100)
    : 0;

  return {
    name: spec.name,
    files: files.length,
    totalRawChars: rawChars,
    totalSkeletonChars: skeletonChars,
    totalRawTokensApprox: approxTokens(rawChars),
    totalSkeletonTokensApprox: approxTokens(skeletonChars),
    reductionPct,
    failedFiles: failed,
    durationMs,
  };
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000).toLocaleString()}k`;
  return String(n);
}

async function main(): Promise<void> {
  console.log('ctxloom large-repo benchmark');
  console.log('============================\n');

  const results: Result[] = [];
  for (const spec of REPOS) {
    console.log(`── ${spec.name} ──`);
    try {
      const r = await benchmarkRepo(spec);
      results.push(r);
      console.log(
        `  ${fmtTokens(r.totalRawTokensApprox)} → ${fmtTokens(r.totalSkeletonTokensApprox)} tokens · ${r.reductionPct}% reduction · ${(r.durationMs / 1000).toFixed(1)}s · ${r.failedFiles} failed\n`,
      );
    } catch (err) {
      console.error(`  FAILED ${spec.name}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  // Aggregate. Weight by raw tokens so a 10k-token repo doesn't get
  // the same say as a 1M-token repo — the average should reflect what
  // a realistic user-population cares about.
  const totalRaw = results.reduce((s, r) => s + r.totalRawTokensApprox, 0);
  const totalSk = results.reduce((s, r) => s + r.totalSkeletonTokensApprox, 0);
  const aggregateReduction = totalRaw > 0
    ? Math.round((1 - totalSk / totalRaw) * 100)
    : 0;

  console.log('\n── Markdown table ─────────────────────────────────────────────────');
  console.log('| Repo | Files | Raw tokens | Skeleton tokens | Reduction |');
  console.log('|---|---:|---:|---:|---:|');
  for (const r of results) {
    console.log(
      `| ${r.name} | ${r.files.toLocaleString()} | ${fmtTokens(r.totalRawTokensApprox)} | ${fmtTokens(r.totalSkeletonTokensApprox)} | ${r.reductionPct}% |`,
    );
  }
  console.log(
    `| **Weighted average** | — | ${fmtTokens(totalRaw)} | ${fmtTokens(totalSk)} | **${aggregateReduction}%** |`,
  );

  const outPath = path.join(process.cwd(), 'benchmarks', 'large-repos-results.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify({ runAt: new Date().toISOString(), aggregateReduction, totalRawTokensApprox: totalRaw, totalSkeletonTokensApprox: totalSk, results }, null, 2),
  );
  console.log(`\nResults written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
