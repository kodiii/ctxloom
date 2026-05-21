# ctxloom benchmark

Generated 2026-05-21T10:27:49.802Z on commit a63bcb4.
Stage: **full**.

Reproduce locally:

```
npm run bench:full
```

## Overall

| Repos | PRs | Avg F1 | Avg Precision | Avg Recall | Avg Source Recall | Avg Reduction |
|------:|----:|-------:|--------------:|-----------:|------------------:|--------------:|
| 5 | 15 | 0.40 | 0.53 | 0.47 | 0.56 | 0.0× |

> **Source Recall** = recall computed against only the indexable (source-file) subset of each PR's ground truth — see [methodology](../methodology.md#source-recall).

## Per-repo

| Repo | PRs | Avg F1 | Precision | Recall | Source Recall | Avg Reduction |
|------|----:|-------:|----------:|-------:|--------------:|--------------:|
| `express` | 3 | 0.26 | 0.20 | 0.53 | 0.67 | 0.0× |
| `fastapi` | 3 | 0.46 | 0.54 | 0.51 | 0.59 | 0.0× |
| `flask` | 3 | 0.39 | 0.40 | 0.62 | 0.74 | 0.0× |
| `gin` | 3 | 0.38 | 0.83 | 0.25 | 0.27 | 0.0× |
| `httpx` | 3 | 0.50 | 0.66 | 0.45 | 0.54 | 0.0× |

## Per-PR (full data)

<details><summary>Click to expand</summary>

### express

| PR | TP | FP | FN | Precision | Recall | F1 | Src TP/GT | Src Recall | Naive tok | Graph tok | Reduction |
|---:|---:|---:|---:|----------:|-------:|---:|----------:|-----------:|----------:|----------:|----------:|
| #6903 | 2 | 27 | 1 | 0.07 | 0.67 | 0.13 | 2/2 | 1.00 | 0 | 0 | 0.0× |
| #6525 | 11 | 17 | 3 | 0.39 | 0.79 | 0.52 | 11/13 | 0.85 | 0 | 0 | 0.0× |
| #5885 | 1 | 6 | 6 | 0.14 | 0.14 | 0.14 | 1/6 | 0.17 | 0 | 0 | 0.0× |

### fastapi

| PR | TP | FP | FN | Precision | Recall | F1 | Src TP/GT | Src Recall | Naive tok | Graph tok | Reduction |
|---:|---:|---:|---:|----------:|-------:|---:|----------:|-----------:|----------:|----------:|----------:|
| #15030 | 10 | 0 | 13 | 1.00 | 0.43 | 0.61 | 10/17 | 0.59 | 0 | 0 | 0.0× |
| #14186 | 10 | 8 | 3 | 0.56 | 0.77 | 0.65 | 10/13 | 0.77 | 0 | 0 | 0.0× |
| #14978 | 4 | 53 | 8 | 0.07 | 0.33 | 0.12 | 4/10 | 0.40 | 0 | 0 | 0.0× |

### flask

| PR | TP | FP | FN | Precision | Recall | F1 | Src TP/GT | Src Recall | Naive tok | Graph tok | Reduction |
|---:|---:|---:|---:|----------:|-------:|---:|----------:|-----------:|----------:|----------:|----------:|
| #4682 | 5 | 3 | 18 | 0.63 | 0.22 | 0.32 | 5/17 | 0.29 | 0 | 0 | 0.0× |
| #4995 | 12 | 32 | 4 | 0.27 | 0.75 | 0.40 | 12/13 | 0.92 | 0 | 0 | 0.0× |
| #5928 | 9 | 20 | 1 | 0.31 | 0.90 | 0.46 | 8/8 | 1.00 | 0 | 0 | 0.0× |

### gin

| PR | TP | FP | FN | Precision | Recall | F1 | Src TP/GT | Src Recall | Naive tok | Graph tok | Reduction |
|---:|---:|---:|---:|----------:|-------:|---:|----------:|-----------:|----------:|----------:|----------:|
| #3904 | 1 | 1 | 5 | 0.50 | 0.17 | 0.25 | 1/6 | 0.17 | 0 | 0 | 0.0× |
| #4053 | 3 | 0 | 5 | 1.00 | 0.38 | 0.55 | 3/7 | 0.43 | 0 | 0 | 0.0× |
| #4491 | 1 | 0 | 4 | 1.00 | 0.20 | 0.33 | 1/5 | 0.20 | 0 | 0 | 0.0× |

### httpx

| PR | TP | FP | FN | Precision | Recall | F1 | Src TP/GT | Src Recall | Naive tok | Graph tok | Reduction |
|---:|---:|---:|---:|----------:|-------:|---:|----------:|-----------:|----------:|----------:|----------:|
| #3139 | 4 | 2 | 11 | 0.67 | 0.27 | 0.38 | 4/9 | 0.44 | 0 | 0 | 0.0× |
| #3319 | 10 | 3 | 19 | 0.77 | 0.34 | 0.48 | 9/21 | 0.43 | 0 | 0 | 0.0× |
| #3673 | 6 | 5 | 2 | 0.55 | 0.75 | 0.63 | 6/8 | 0.75 | 0 | 0 | 0.0× |

</details>

---

See [methodology](../methodology.md) for how these numbers are computed and [limitations](../limitations.md) for known weaknesses.
