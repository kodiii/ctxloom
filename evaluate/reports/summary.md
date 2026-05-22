# ctxloom benchmark

Generated 2026-05-22T07:31:24.797Z on commit 009f7c6.
Stage: **full**.

Reproduce locally:

```
npm run bench:full
```

## Overall

| Repos | PRs | Avg F1 | Avg Precision | Avg Recall | Avg Source Recall | Avg Graph Reachability | Avg Symbol Coverage | Avg Import Coverage | Avg Reduction |
|------:|----:|-------:|--------------:|-----------:|------------------:|----------------------:|-------------------:|-------------------:|--------------:|
| 5 | 15 | 0.42 | 0.47 | 0.52 | 0.61 | 0.94 | 1.00 | 1.00 | 24.6× |

> **Source Recall** = recall computed against only the indexable (source-file) subset of each PR's ground truth — measures the prediction algorithm.

> **Graph Reachability** = fraction of source-file ground truth that is structurally reachable from the entry point via BFS over the import graph (depth ≤ 4, forward + reverse). Measures the **graph** independent of the prediction algorithm — separates "graph completeness" from "algorithm quality". If sourceRecall ≪ graphReachability the algorithm is too conservative; if graphReachability itself is low the graph is missing edges.

> **Symbol Coverage** = fraction of AST-declared function/class/method/interface symbols present in `graph.symbolIndex` with correct file attribution. Measured DIRECTLY against AST ground truth — no prediction algorithm or external oracle in between. The primary test of "absurd accuracy across all project files": if symbolCoverage ≥ 0.95 the graph genuinely knows where 95%+ of declared symbols live; downstream tools (`ctx_get_definition`, `find_callers`, refactor preview) inherit that accuracy.

> **Import Coverage** = fraction of AST-found intra-repo (relative) import statements that resulted in a graph forwardEdge. Direct measure of the import resolver's correctness, independent of any prediction algorithm. Per-extension breakdown isolates language-specific resolver gaps — e.g. if `gin` shows .go imports at 0.30 coverage while JS/TS/Py are at 1.00, the Go-resolver path is dropping edges. Diagnoses precisely WHERE in the graph layer a low graphReachability number originates.

## Per-repo

| Repo | PRs | Avg F1 | Precision | Recall | Source Recall | Graph Reach. | Symbol Cov. | Import Cov. | Avg Reduction |
|------|----:|-------:|----------:|-------:|--------------:|-------------:|------------:|------------:|--------------:|
| `express` | 3 | 0.26 | 0.20 | 0.53 | 0.67 | 1.00 | 1.00 | 1.00 | 20.3× |
| `fastapi` | 3 | 0.46 | 0.54 | 0.51 | 0.59 | 0.89 | 1.00 | 1.00 | 32.3× |
| `flask` | 3 | 0.39 | 0.40 | 0.62 | 0.74 | 0.98 | 1.00 | 1.00 | 17.5× |
| `gin` | 3 | 0.47 | 0.55 | 0.47 | 0.49 | 0.95 | 1.00 | n/a | 28.3× |
| `httpx` | 3 | 0.50 | 0.66 | 0.45 | 0.54 | 0.86 | 1.00 | 1.00 | 24.5× |

## Per-PR (full data)

<details><summary>Click to expand</summary>

### express

| PR | TP | FP | FN | Precision | Recall | F1 | Src TP/GT | Src Recall | Graph Reach. | Naive tok | Graph tok | Reduction |
|---:|---:|---:|---:|----------:|-------:|---:|----------:|-----------:|-------------:|----------:|----------:|----------:|
| #6903 | 2 | 27 | 1 | 0.07 | 0.67 | 0.13 | 2/2 | 1.00 | 1.00 | 39,911 | 2,342 | 17.0× |
| #6525 | 11 | 17 | 3 | 0.39 | 0.79 | 0.52 | 11/13 | 0.85 | 1.00 | 48,817 | 2,528 | 19.3× |
| #5885 | 1 | 6 | 6 | 0.14 | 0.14 | 0.14 | 1/6 | 0.17 | 1.00 | 9,402 | 382 | 24.6× |

### fastapi

| PR | TP | FP | FN | Precision | Recall | F1 | Src TP/GT | Src Recall | Graph Reach. | Naive tok | Graph tok | Reduction |
|---:|---:|---:|---:|----------:|-------:|---:|----------:|-----------:|-------------:|----------:|----------:|----------:|
| #15030 | 10 | 0 | 13 | 1.00 | 0.43 | 0.61 | 10/17 | 0.59 | 0.88 | 179,123 | 2,694 | 66.5× |
| #14186 | 10 | 8 | 3 | 0.56 | 0.77 | 0.65 | 10/13 | 0.77 | 1.00 | 166,921 | 8,779 | 19.0× |
| #14978 | 4 | 53 | 8 | 0.07 | 0.33 | 0.12 | 4/10 | 0.40 | 0.80 | 140,823 | 12,498 | 11.3× |

### flask

| PR | TP | FP | FN | Precision | Recall | F1 | Src TP/GT | Src Recall | Graph Reach. | Naive tok | Graph tok | Reduction |
|---:|---:|---:|---:|----------:|-------:|---:|----------:|-----------:|-------------:|----------:|----------:|----------:|
| #4682 | 5 | 3 | 18 | 0.63 | 0.22 | 0.32 | 5/17 | 0.29 | 0.94 | 97,552 | 2,941 | 33.2× |
| #4995 | 12 | 32 | 4 | 0.27 | 0.75 | 0.40 | 12/13 | 0.92 | 1.00 | 100,830 | 10,858 | 9.3× |
| #5928 | 9 | 20 | 1 | 0.31 | 0.90 | 0.46 | 8/8 | 1.00 | 1.00 | 88,343 | 8,920 | 9.9× |

### gin

| PR | TP | FP | FN | Precision | Recall | F1 | Src TP/GT | Src Recall | Graph Reach. | Naive tok | Graph tok | Reduction |
|---:|---:|---:|---:|----------:|-------:|---:|----------:|-----------:|-------------:|----------:|----------:|----------:|
| #3904 | 3 | 9 | 3 | 0.25 | 0.50 | 0.33 | 3/6 | 0.50 | 1.00 | 75,690 | 5,057 | 15.0× |
| #4053 | 4 | 0 | 4 | 1.00 | 0.50 | 0.67 | 4/7 | 0.57 | 0.86 | 59,482 | 1,237 | 48.1× |
| #4491 | 2 | 3 | 3 | 0.40 | 0.40 | 0.40 | 2/5 | 0.40 | 1.00 | 81,730 | 3,741 | 21.8× |

### httpx

| PR | TP | FP | FN | Precision | Recall | F1 | Src TP/GT | Src Recall | Graph Reach. | Naive tok | Graph tok | Reduction |
|---:|---:|---:|---:|----------:|-------:|---:|----------:|-----------:|-------------:|----------:|----------:|----------:|
| #3139 | 4 | 2 | 11 | 0.67 | 0.27 | 0.38 | 4/9 | 0.44 | 1.00 | 64,964 | 2,512 | 25.9× |
| #3319 | 10 | 3 | 19 | 0.77 | 0.34 | 0.48 | 9/21 | 0.43 | 0.95 | 110,191 | 3,666 | 30.1× |
| #3673 | 6 | 5 | 2 | 0.55 | 0.75 | 0.63 | 6/8 | 0.75 | 0.63 | 49,313 | 2,806 | 17.6× |

</details>

---

See [methodology](../methodology.md) for how these numbers are computed and [limitations](../limitations.md) for known weaknesses.
