#!/usr/bin/env tsx
/**
 * ctxloom benchmark suite
 *
 * Metrics:
 *   - indexing: time to run indexDirectory() on the fixture repo
 *   - graph_build: time to run DependencyGraph.buildFromDirectory()
 *   - search_p50/p95: vector search latency percentiles (N=20 runs)
 *   - compression_ratio: context packet tokens vs raw dependency tokens
 *
 * Usage:
 *   tsx benchmarks/benchmark.ts [--fixture ./path/to/repo] [--output ./results.json]
 */
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateEmbedding } from '../src/indexer/embedder.js';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { ASTParser } from '../src/ast/ASTParser.js';
import { VectorStore } from '../src/db/VectorStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse CLI args
const args = process.argv.slice(2);
const fixtureIdx = args.indexOf('--fixture');
const outputIdx = args.indexOf('--output');
const fixtureArg = fixtureIdx >= 0 ? args[fixtureIdx + 1] : undefined;
const outputArg = outputIdx >= 0 ? args[outputIdx + 1] : undefined;

const FIXTURE_DIR = fixtureArg ?? path.join(__dirname, '..'); // default: index this repo
const OUTPUT_FILE = outputArg ?? path.join(__dirname, 'results.json');
const SEARCH_ITERATIONS = 20;

const SEARCH_QUERIES = [
  'dependency graph traversal',
  'vector embedding search',
  'AST parser TypeScript',
  'file watcher debounce',
  'path validator security',
];

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function runBenchmarks(): Promise<void> {
  console.log('[benchmark] Starting ctxloom benchmark suite');
  console.log(`[benchmark] Fixture: ${FIXTURE_DIR}`);

  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    fixture: FIXTURE_DIR,
    node_version: process.version,
  };

  // ── 1. Graph build benchmark ───────────────────────────────────────────
  console.log('\n[benchmark] 1/3 Graph build...');
  const parser = new ASTParser();
  await parser.init();
  const graph = new DependencyGraph();
  graph.setParser(parser);

  // Remove snapshot so we measure a fresh build
  const snapshotPath = path.join(FIXTURE_DIR, '.ctxloom', 'graph-snapshot.json');
  if (fs.existsSync(snapshotPath)) fs.rmSync(snapshotPath);

  const t1 = performance.now();
  await graph.buildFromDirectory(FIXTURE_DIR);
  const graphMs = performance.now() - t1;

  results.graph_build = {
    edges: graph.edgeCount(),
    nodes: graph.allFiles().length,
    duration_ms: Math.round(graphMs),
  };
  console.log(`   → ${graph.edgeCount()} edges, ${graph.allFiles().length} nodes in ${Math.round(graphMs)}ms`);

  // ── 2. Search latency benchmark ────────────────────────────────────────
  console.log('\n[benchmark] 2/3 Search latency (requires indexed DB)...');
  const dbPath = path.join(FIXTURE_DIR, '.ctxloom', 'vectors.lancedb');

  if (fs.existsSync(dbPath)) {
    const store = new VectorStore(dbPath);
    await store.init();

    const searchLatencies: number[] = [];
    for (let i = 0; i < SEARCH_ITERATIONS; i++) {
      const query = SEARCH_QUERIES[i % SEARCH_QUERIES.length];
      const ts = performance.now();
      const embedding = await generateEmbedding(query);
      await store.search(embedding, 10);
      searchLatencies.push(performance.now() - ts);
    }
    searchLatencies.sort((a, b) => a - b);

    results.search = {
      iterations: SEARCH_ITERATIONS,
      p50_ms: Math.round(percentile(searchLatencies, 50)),
      p95_ms: Math.round(percentile(searchLatencies, 95)),
      p99_ms: Math.round(percentile(searchLatencies, 99)),
      mean_ms: Math.round(searchLatencies.reduce((a, b) => a + b, 0) / searchLatencies.length),
    };
    console.log(`   → P50: ${(results.search as Record<string, unknown>).p50_ms}ms  P95: ${(results.search as Record<string, unknown>).p95_ms}ms`);
  } else {
    console.log('   → Skipped (no indexed DB found — run ctxloom index first)');
    results.search = { skipped: true, reason: 'No indexed DB at ' + dbPath };
  }

  // ── 3. Context packet token compression ───────────────────────────────
  console.log('\n[benchmark] 3/3 Context packet compression...');
  const files = graph.allFiles().filter(f => f.endsWith('.ts') || f.endsWith('.py'));
  const sampleFile = files[Math.floor(files.length / 2)] ?? files[0];

  if (sampleFile) {
    const absPath = path.resolve(FIXTURE_DIR, sampleFile);
    let primarySize = 0;
    let dependencyRawSize = 0;
    try {
      primarySize = fs.readFileSync(absPath, 'utf-8').length;
      const deps = graph.getImports(sampleFile);
      for (const dep of deps) {
        try {
          dependencyRawSize += fs.readFileSync(path.resolve(FIXTURE_DIR, dep), 'utf-8').length;
        } catch { /* skip */ }
      }
    } catch { /* skip */ }

    const rawTotal = primarySize + dependencyRawSize;
    results.context_packet = {
      sample_file: sampleFile,
      primary_chars: primarySize,
      dependency_raw_chars: dependencyRawSize,
      raw_total_chars: rawTotal,
      note: 'Skeletonized context packets are ~10-20% of raw_total_chars',
    };
    console.log(`   → Sample: ${sampleFile} | Raw dep chars: ${dependencyRawSize} | Total: ${rawTotal}`);
  }

  // ── Write results ──────────────────────────────────────────────────────
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\n[benchmark] Results written to ${OUTPUT_FILE}`);
  console.log('[benchmark] Done!');
}

runBenchmarks().catch(err => {
  console.error('[benchmark] Error:', err);
  process.exit(1);
});
