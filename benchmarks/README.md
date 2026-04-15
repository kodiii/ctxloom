# ctxloom Benchmarks

Methodology and results for the ctxloom indexing and search performance suite.

## Running

```bash
# Benchmark against this repo (default)
npx tsx benchmarks/benchmark.ts

# Benchmark against a specific directory
npx tsx benchmarks/benchmark.ts --fixture /path/to/project --output benchmarks/results.json
```

## Metrics

| Metric | Description |
|--------|-------------|
| `graph_build.duration_ms` | Time to build full dependency graph from scratch |
| `search.p50_ms` | Median vector search latency (20 iterations) |
| `search.p95_ms` | 95th-percentile vector search latency |
| `context_packet` | Raw vs skeletonized dependency size for a sample file |

## Reproducibility

Results are written to `benchmarks/results.json`. The fixture is the repo itself by default.
To reproduce independently: clone the repo, run `npm install`, then run the benchmark command above.

## CI

The benchmark runs on every PR via `.github/workflows/benchmark.yml`.
Results are posted as a PR comment for regressions to be visible before merge.
