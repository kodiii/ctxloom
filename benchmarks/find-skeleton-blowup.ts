#!/usr/bin/env tsx
/**
 * find-skeleton-blowup.ts — diagnostic for "skeleton output bigger
 * than raw input" pathology seen in vercel/next.js.
 *
 * Walks the Next.js source tree and prints any file whose
 * skeletonized output exceeds raw size. The earlier chunked bench
 * showed 24× expansion in aggregate; this surfaces the individual
 * offenders so we can look at the AST walk on a real reproducer.
 *
 * Usage:
 *   npx tsx benchmarks/find-skeleton-blowup.ts [--limit=N] [--target=path]
 *
 *   --limit=N       Stop after N files processed (default: unlimited)
 *   --target=path   Skeletonize one specific file and dump output
 *                   length. Use this to drill into a known offender.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const REPO_DIR = path.join(os.tmpdir(), 'ctxloom-bench-large', 'vercel__next.js');
const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'lib', 'target',
  '.next', '.nuxt', '.cache', '.turbo', 'coverage', 'fixtures',
  'examples', 'test', 'tests', '__tests__', 'e2e', 'benchmark',
  'benchmarks', 'docs', 'website',
]);

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

const args = process.argv.slice(2);
const limit = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? Infinity);
const target = args.find((a) => a.startsWith('--target='))?.split('=')[1];

async function main(): Promise<void> {
  const { Skeletonizer } = await import('../packages/core/src/ast/Skeletonizer.ts');
  const sk = new Skeletonizer();
  await sk.init();

  if (target) {
    // Single-file mode. Load, skeletonize, dump sizes + a head of the
    // skeleton output so we can eyeball what's blowing up.
    const raw = fs.readFileSync(target, 'utf-8');
    const t0 = Date.now();
    const skel = await sk.skeletonize(target);
    const dt = Date.now() - t0;
    console.log(`file:    ${target}`);
    console.log(`raw:     ${raw.length.toLocaleString()} chars (${raw.split('\n').length} lines)`);
    console.log(`skel:    ${skel.length.toLocaleString()} chars (${skel.split('\n').length} lines)`);
    console.log(`ratio:   ${(skel.length / raw.length).toFixed(2)}× `);
    console.log(`time:    ${dt}ms`);
    console.log(`\nfirst 1000 chars of skeleton:\n${skel.slice(0, 1000)}`);
    return;
  }

  // Sweep mode. Process files one-by-one, print offenders.
  const files = findSourceFiles(REPO_DIR);
  console.log(`scanning ${files.length.toLocaleString()} files in ${REPO_DIR}`);
  console.log('reporting any file where skeleton output > raw input.\n');

  const offenders: Array<{ file: string; raw: number; skel: number; ratio: number }> = [];
  let processed = 0;
  for (const file of files.slice(0, limit)) {
    processed++;
    let raw: string;
    try { raw = fs.readFileSync(file, 'utf-8'); } catch { continue; }
    let skel: string;
    try { skel = await sk.skeletonize(file); }
    catch (err) {
      // If skeletonize itself throws, that's a different bug — log it
      // but keep going.
      console.log(`  THROW  ${path.relative(REPO_DIR, file)}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (skel.length > raw.length) {
      const ratio = skel.length / raw.length;
      const rel = path.relative(REPO_DIR, file);
      console.log(
        `  ${ratio >= 5 ? '⚠ ' : '  '}${ratio.toFixed(2)}×  ${rel}  (raw=${raw.length.toLocaleString()}, skel=${skel.length.toLocaleString()})`,
      );
      offenders.push({ file: rel, raw: raw.length, skel: skel.length, ratio });
    }
    if (processed % 200 === 0) {
      process.stderr.write(`  …${processed}/${files.length}\n`);
    }
  }

  console.log(`\n── summary ──`);
  console.log(`processed:           ${processed.toLocaleString()}`);
  console.log(`offenders (skel>raw): ${offenders.length.toLocaleString()}`);
  if (offenders.length === 0) return;

  offenders.sort((a, b) => b.ratio - a.ratio);
  console.log(`\ntop 10 by ratio:`);
  for (const o of offenders.slice(0, 10)) {
    console.log(
      `  ${o.ratio.toFixed(2)}×  ${o.file}  (raw=${o.raw.toLocaleString()}, skel=${o.skel.toLocaleString()})`,
    );
  }
  console.log(`\ntop 10 by absolute skel size:`);
  for (const o of offenders.slice().sort((a, b) => b.skel - a.skel).slice(0, 10)) {
    console.log(
      `  ${(o.skel / 1024).toFixed(1)}KB  ${o.ratio.toFixed(2)}×  ${o.file}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
