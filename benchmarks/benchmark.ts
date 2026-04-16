#!/usr/bin/env tsx
/**
 * ctxloom benchmark suite
 *
 * Metrics:
 *   - graph_build:         time + edges + nodes to build DependencyGraph from scratch
 *   - search:              vector search P50/P95/P99 latency (20 iterations, 5 queries)
 *   - compression:         actual skeletonized chars vs raw chars for 5 sample files
 *                          (this is the independently reproducible proof of token reduction)
 *
 * Usage:
 *   npx tsx benchmarks/benchmark.ts [--fixture ./path/to/repo] [--output ./results.json]
 */
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateEmbedding } from '../src/indexer/embedder.js';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { ASTParser } from '../src/ast/ASTParser.js';
import { Skeletonizer } from '../src/ast/Skeletonizer.js';
import { VectorStore } from '../src/db/VectorStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CLI args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const fixtureIdx = args.indexOf('--fixture');
const outputIdx = args.indexOf('--output');
const fixtureArg = fixtureIdx >= 0 ? args[fixtureIdx + 1] : undefined;
const outputArg = outputIdx >= 0 ? args[outputIdx + 1] : undefined;

const FIXTURE_DIR = path.resolve(fixtureArg ?? path.join(__dirname, '..'));
const OUTPUT_FILE = outputArg ?? path.join(__dirname, 'results.json');
const SEARCH_ITERATIONS = 20;
const COMPRESSION_SAMPLES = 5;

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

function charCount(s: string): number {
  return s.length;
}

/** Approximate token count: chars / 4 (GPT-style rough estimate). */
function approxTokens(chars: number): number {
  return Math.round(chars / 4);
}

async function runBenchmarks(): Promise<void> {
  console.log('━'.repeat(60));
  console.log('  ctxloom benchmark suite');
  console.log('━'.repeat(60));
  console.log(`  Fixture : ${FIXTURE_DIR}`);
  console.log(`  Output  : ${OUTPUT_FILE}`);
  console.log(`  Node    : ${process.version}`);
  console.log('━'.repeat(60));

  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    fixture: FIXTURE_DIR,
    node_version: process.version,
  };

  // ── 1. Graph build ────────────────────────────────────────────────────────
  console.log('\n[1/3] Graph build (cold — no snapshot)');
  const parser = new ASTParser();
  await parser.init();

  const graph = new DependencyGraph();
  graph.setParser(parser);

  // Remove snapshot so we measure a true cold build
  const snapshotPath = path.join(FIXTURE_DIR, '.ctxloom', 'graph-snapshot.json');
  if (fs.existsSync(snapshotPath)) fs.rmSync(snapshotPath);

  const t1 = performance.now();
  await graph.buildFromDirectory(FIXTURE_DIR);
  const graphMs = Math.round(performance.now() - t1);

  const nodeCount = graph.allFiles().length;
  const edgeCount = graph.edgeCount();

  results.graph_build = {
    edges: edgeCount,
    nodes: nodeCount,
    duration_ms: graphMs,
    edges_per_second: Math.round(edgeCount / (graphMs / 1000)),
  };

  console.log(`   ✓ ${nodeCount} nodes, ${edgeCount} edges in ${graphMs}ms`);
  console.log(`     (${Math.round(edgeCount / (graphMs / 1000))} edges/sec)`);

  // ── 2. Search latency ─────────────────────────────────────────────────────
  console.log('\n[2/3] Search latency');
  const dbPath = path.join(FIXTURE_DIR, '.ctxloom', 'vectors.lancedb');

  if (fs.existsSync(dbPath)) {
    const store = new VectorStore(dbPath);
    await store.init();

    const latencies: number[] = [];
    const embedLatencies: number[] = [];
    const searchLatencies: number[] = [];

    for (let i = 0; i < SEARCH_ITERATIONS; i++) {
      const query = SEARCH_QUERIES[i % SEARCH_QUERIES.length];
      const t0 = performance.now();
      const embedding = await generateEmbedding(query);
      const tEmbed = performance.now();
      await store.search(embedding, 10);
      const tSearch = performance.now();
      embedLatencies.push(tEmbed - t0);
      searchLatencies.push(tSearch - tEmbed);
      latencies.push(tSearch - t0);
    }

    latencies.sort((a, b) => a - b);
    embedLatencies.sort((a, b) => a - b);
    searchLatencies.sort((a, b) => a - b);

    results.search = {
      iterations: SEARCH_ITERATIONS,
      total: {
        p50_ms: Math.round(percentile(latencies, 50)),
        p95_ms: Math.round(percentile(latencies, 95)),
        p99_ms: Math.round(percentile(latencies, 99)),
        mean_ms: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
      },
      embedding_only: {
        p50_ms: Math.round(percentile(embedLatencies, 50)),
        p95_ms: Math.round(percentile(embedLatencies, 95)),
      },
      vector_search_only: {
        p50_ms: Math.round(percentile(searchLatencies, 50)),
        p95_ms: Math.round(percentile(searchLatencies, 95)),
      },
    };

    const s = results.search as Record<string, Record<string, number>>;
    console.log(`   ✓ P50: ${s.total.p50_ms}ms | P95: ${s.total.p95_ms}ms | P99: ${s.total.p99_ms}ms`);
    console.log(`     embed P50: ${s.embedding_only.p50_ms}ms | lancedb P50: ${s.vector_search_only.p50_ms}ms`);
  } else {
    console.log('   ⚠ Skipped — no indexed DB found. Run: ctxloom index');
    results.search = { skipped: true, reason: 'No LanceDB at ' + dbPath };
  }

  // ── 3. Skeletonization compression ratio ──────────────────────────────────
  console.log('\n[3/3] Skeletonization compression ratio');

  const skeletonizer = new Skeletonizer();
  skeletonizer.setParser(parser); // reuse the already-initialised parser

  // Sample TS files spread across the codebase
  const tsFiles = graph
    .allFiles()
    .filter(f => (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.includes('node_modules'))
    .sort(); // deterministic order

  // Pick COMPRESSION_SAMPLES files spread evenly across the sorted list
  const step = Math.max(1, Math.floor(tsFiles.length / COMPRESSION_SAMPLES));
  const sampleFiles = Array.from({ length: COMPRESSION_SAMPLES }, (_, i) => tsFiles[i * step]).filter(Boolean);

  interface CompressionSample {
    file: string;
    raw_chars: number;
    skeleton_chars: number;
    raw_tokens: number;
    skeleton_tokens: number;
    ratio: number; // skeleton / raw (lower = better compression)
    reduction_pct: number;
  }

  const samples: CompressionSample[] = [];
  let totalRawChars = 0;
  let totalSkeletonChars = 0;

  for (const relFile of sampleFiles) {
    const absPath = path.join(FIXTURE_DIR, relFile);
    try {
      const raw = fs.readFileSync(absPath, 'utf-8');
      const rawChars = charCount(raw);

      const skeleton = await skeletonizer.skeletonize(absPath);
      const skeletonChars = charCount(skeleton);

      const ratio = skeletonChars / rawChars;
      totalRawChars += rawChars;
      totalSkeletonChars += skeletonChars;

      samples.push({
        file: relFile,
        raw_chars: rawChars,
        skeleton_chars: skeletonChars,
        raw_tokens: approxTokens(rawChars),
        skeleton_tokens: approxTokens(skeletonChars),
        ratio: Math.round(ratio * 1000) / 1000,
        reduction_pct: Math.round((1 - ratio) * 100),
      });

      console.log(
        `   ${relFile.padEnd(55)} ${String(approxTokens(rawChars)).padStart(5)} → ` +
        `${String(approxTokens(skeletonChars)).padStart(4)} tokens  (${Math.round((1 - ratio) * 100)}% reduction)`,
      );
    } catch (err) {
      console.warn(`   ⚠ Skipped ${relFile}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const overallRatio = totalRawChars > 0 ? totalSkeletonChars / totalRawChars : 1;
  const overallReduction = Math.round((1 - overallRatio) * 100);

  results.compression = {
    samples,
    aggregate: {
      total_raw_chars: totalRawChars,
      total_skeleton_chars: totalSkeletonChars,
      total_raw_tokens: approxTokens(totalRawChars),
      total_skeleton_tokens: approxTokens(totalSkeletonChars),
      overall_ratio: Math.round(overallRatio * 1000) / 1000,
      overall_reduction_pct: overallReduction,
    },
  };

  const agg = (results.compression as Record<string, Record<string, number>>).aggregate;
  console.log('\n   ── Aggregate ──────────────────────────────────────────');
  console.log(`   Raw tokens      : ${agg.total_raw_tokens.toLocaleString()}`);
  console.log(`   Skeleton tokens : ${agg.total_skeleton_tokens.toLocaleString()}`);
  console.log(`   Reduction       : ${agg.overall_reduction_pct}%  (ratio: ${agg.overall_ratio})`);

  // ── Write results ─────────────────────────────────────────────────────────
  console.log('\n' + '━'.repeat(60));
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`  Results → ${OUTPUT_FILE}`);
  console.log('━'.repeat(60));
}

runBenchmarks().catch(err => {
  console.error('[benchmark] Fatal:', err);
  process.exit(1);
});
