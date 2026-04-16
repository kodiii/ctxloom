#!/usr/bin/env tsx
/**
 * benchmark-public-repos.ts — Index named public repos and report metrics.
 *
 * Repos benchmarked (variety of size and language):
 *   - expressjs/express      (Node.js, ~200 JS files)
 *   - sindresorhus/got       (TypeScript, ~100 TS files)
 *   - pallets/flask          (Python, ~100 PY files)
 *   - SergioBenitez/Rocket   (Rust, ~200 RS files)
 *   - fastify/fastify        (Node.js, ~300 JS/TS files)
 *
 * Usage:
 *   npx tsx benchmarks/benchmark-public-repos.ts
 *
 * Requires: git, internet access, ~500MB disk in /tmp/ctxloom-bench-repos
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const REPOS = [
  { name: 'expressjs/express',    url: 'https://github.com/expressjs/express.git',    lang: 'js' },
  { name: 'sindresorhus/got',     url: 'https://github.com/sindresorhus/got.git',     lang: 'ts' },
  { name: 'pallets/flask',        url: 'https://github.com/pallets/flask.git',        lang: 'py' },
  { name: 'SergioBenitez/Rocket', url: 'https://github.com/SergioBenitez/Rocket.git', lang: 'rs' },
  { name: 'fastify/fastify',      url: 'https://github.com/fastify/fastify.git',      lang: 'js' },
] as const;

const WORK_DIR = path.join(os.tmpdir(), 'ctxloom-bench-repos');
fs.mkdirSync(WORK_DIR, { recursive: true });

interface RepoResult {
  name: string;
  lang: string;
  files: number;
  indexTimeMs: number;
  graphEdges: number;
  rawChars: number;
  skeletonChars: number;
  reductionPct: number;
}

function cloneRepo(name: string, url: string): string {
  const dir = path.join(WORK_DIR, name.replace('/', '__'));
  if (!fs.existsSync(dir)) {
    console.log(`  Cloning ${name}...`);
    execSync(`git clone --depth=1 "${url}" "${dir}"`, { stdio: 'pipe' });
  } else {
    console.log(`  Using cached ${name}`);
  }
  return dir;
}

function countSourceFiles(dir: string, exts: readonly string[]): string[] {
  const result: string[] = [];
  const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', 'vendor', 'target', '.ctxloom']);

  function walk(d: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED.has(entry.name)) walk(path.join(d, entry.name));
      } else if (exts.some(e => entry.name.endsWith(e))) {
        result.push(path.join(d, entry.name));
      }
    }
  }

  walk(dir);
  return result;
}

const EXT_MAP: Record<string, string[]> = {
  js: ['.js', '.mjs', '.cjs'],
  ts: ['.ts', '.tsx'],
  py: ['.py'],
  rs: ['.rs'],
};

async function benchmarkRepo(name: string, url: string, lang: string): Promise<RepoResult> {
  console.log(`\n── ${name} ──`);
  const dir = cloneRepo(name, url);
  const exts = EXT_MAP[lang] ?? ['.ts'];
  const files = countSourceFiles(dir, exts);

  console.log(`  ${files.length} ${lang} files found`);

  // Index with graph
  const t0 = Date.now();
  const { DependencyGraph } = await import('../src/graph/DependencyGraph.js');
  const { ASTParser } = await import('../src/ast/ASTParser.js');
  const parser = new ASTParser();
  await parser.init();
  const graph = new DependencyGraph();
  graph.setParser(parser);
  await graph.buildFromDirectory(dir);
  const indexTimeMs = Date.now() - t0;

  console.log(`  Indexed in ${indexTimeMs}ms, ${graph.edgeCount()} edges`);

  // Compression: sample up to 5 TS files only (Skeletonizer is TS/JS only)
  const tsFiles = lang === 'ts' || lang === 'js'
    ? files
    : countSourceFiles(dir, ['.ts', '.js']);

  let rawTotal = 0;
  let skeletonTotal = 0;

  if (tsFiles.length > 0) {
    const { Skeletonizer } = await import('../src/ast/Skeletonizer.js');
    const sk = new Skeletonizer();
    await sk.init();

    const step = Math.max(1, Math.floor(tsFiles.length / 5));
    const sampled = tsFiles.filter((_, i) => i % step === 0).slice(0, 5);

    for (const f of sampled) {
      const raw = fs.readFileSync(f, 'utf-8');
      rawTotal += raw.length;
      try {
        const skeleton = await sk.skeletonize(f);
        skeletonTotal += skeleton.length;
      } catch {
        skeletonTotal += raw.length;
      }
    }
  }

  const reductionPct = rawTotal > 0
    ? Math.round((1 - skeletonTotal / rawTotal) * 100)
    : 0;

  return { name, lang, files: files.length, indexTimeMs, graphEdges: graph.edgeCount(), rawChars: rawTotal, skeletonChars: skeletonTotal, reductionPct };
}

async function main(): Promise<void> {
  console.log('ctxloom Public Repo Benchmark');
  console.log('================================\n');

  const results: RepoResult[] = [];
  for (const { name, url, lang } of REPOS) {
    try {
      results.push(await benchmarkRepo(name, url, lang));
    } catch (err) {
      console.error(`  FAILED ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('\n\n── Results ─────────────────────────────────────────────────────────────');
  console.log('Repo                           Lang  Files  IndexMs  Edges  Reduction');
  console.log('────────────────────────────────────────────────────────────────────────');
  for (const r of results) {
    const row = [
      r.name.padEnd(31),
      r.lang.padEnd(6),
      String(r.files).padEnd(7),
      String(r.indexTimeMs).padEnd(9),
      String(r.graphEdges).padEnd(7),
      r.reductionPct > 0 ? `${r.reductionPct}%` : 'n/a',
    ].join(' ');
    console.log(row);
  }

  const outPath = path.join(process.cwd(), 'benchmarks', 'public-repos-results.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
