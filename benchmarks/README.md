# ctxloom Benchmarks

Methodology and independently reproducible results for ctxloom's three core performance claims.

## Running

```bash
# Benchmark against this repo (default fixture)
npx tsx benchmarks/benchmark.ts

# Benchmark against your own project
npx tsx benchmarks/benchmark.ts --fixture /path/to/your/project --output benchmarks/results.json
```

## Metrics

### 1. Graph Build (`graph_build`)

Cold build of `DependencyGraph` from scratch (snapshot deleted before run).

| Field | Description |
|-------|-------------|
| `nodes` | Total files in the dependency graph |
| `edges` | Total import edges |
| `duration_ms` | Wall-clock time for the full build |
| `edges_per_second` | Throughput: edges processed per second |

### 2. Vector Search Latency (`search`)

20 iterations across 5 representative queries. Requires `ctxloom index` to have been run first.

| Field | Description |
|-------|-------------|
| `total.p50_ms` | Median end-to-end latency (embed + LanceDB query) |
| `total.p95_ms` | 95th-percentile end-to-end latency |
| `total.p99_ms` | 99th-percentile end-to-end latency |
| `embedding_only.p50_ms` | Median embedding model inference time |
| `vector_search_only.p50_ms` | Median LanceDB ANN query time |

### 3. Skeletonization Compression (`compression`)

The key claim: **skeletonized context packets use 70–90% fewer tokens than raw file content.**

Measured by calling `Skeletonizer.skeletonize()` on 5 TypeScript files sampled evenly across
the codebase, then comparing actual character counts (not estimates).

Token counts use the standard approximation of 4 chars/token (GPT tokenizer average for code).

| Field | Description |
|-------|-------------|
| `samples[].raw_tokens` | Approximate tokens in the full source file |
| `samples[].skeleton_tokens` | Approximate tokens in the skeletonized view |
| `samples[].reduction_pct` | Token reduction percentage for that file |
| `aggregate.overall_reduction_pct` | **The headline number** — reduction across all samples |
| `aggregate.overall_ratio` | `skeleton_chars / raw_chars` (lower is better) |

## Reproducibility

Results are deterministic: the benchmark uses a fixed set of queries and samples files
at evenly-spaced intervals from a sorted file list.

To reproduce independently:

```bash
git clone https://github.com/kodiii/ctxloom.git
cd ctxloom
npm install
npx tsx benchmarks/benchmark.ts
cat benchmarks/results.json
```

No internet connection required after `npm install` — the embedding model runs fully locally.

## Public Repo Benchmark

Benchmark ctxloom against well-known open-source repos to get credible, comparable numbers:

```bash
npm run bench:repos
```

This clones (with `--depth=1`) and indexes 5 repos covering JavaScript, TypeScript, Python, and Rust:

| Repo | Language | Purpose |
|------|----------|---------|
| expressjs/express | JavaScript | Web framework |
| sindresorhus/got | TypeScript | HTTP client |
| pallets/flask | Python | Web framework |
| SergioBenitez/Rocket | Rust | Web framework |
| fastify/fastify | JavaScript | Web framework |

Results are saved to `benchmarks/public-repos-results.json` for CI history.

### Metrics reported

| Field | Description |
|-------|-------------|
| `files` | Number of source files in the target language |
| `indexTimeMs` | Time to build full dependency graph |
| `graphEdges` | Total import edges detected |
| `reductionPct` | Token reduction from skeletonization (TS/JS only) |

## CI Integration

The benchmark runs automatically on every pull request via
[`.github/workflows/benchmark.yml`](../.github/workflows/benchmark.yml).

Results are posted as a PR comment so regressions are visible before merge.
The comment is updated (not duplicated) if the benchmark re-runs on the same PR.

## Example Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ctxloom benchmark suite
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Fixture : /path/to/ctxloom
  Node    : v20.x.x

[1/3] Graph build (cold — no snapshot)
   ✓ 47 nodes, 89 edges in 312ms

[2/3] Search latency
   ⚠ Skipped — no indexed DB found. Run: ctxloom index

[3/3] Skeletonization compression ratio
   src/graph/DependencyGraph.ts              1842 →  312 tokens  (83% reduction)
   src/ast/ASTParser.ts                       934 →  145 tokens  (84% reduction)
   src/db/VectorStore.ts                      623 →   98 tokens  (84% reduction)
   src/tools/blast-radius.ts                  412 →   67 tokens  (83% reduction)
   src/indexer/embedder.ts                    389 →   58 tokens  (85% reduction)

   ── Aggregate ──────────────────────────────────────────
   Raw tokens      : 4,200
   Skeleton tokens :   680
   Reduction       : 84%  (ratio: 0.162)
```
