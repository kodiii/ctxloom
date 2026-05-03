# e2e-corpus — Realistic-test E2E for ctxloom

Curated public-repo test corpus that exercises the **whole product surface**
end-to-end against real codebases at frozen commits.

This is **Tier 1** of the realistic-test strategy: high-leverage automated
correctness checks against repos that look like what real users index.

## What it tests

For each repo in `repos.json`:

1. `git clone --depth=1 --branch <pinned-commit>`
2. `ctxloom index` — full hybrid Vector + AST + Graph build
3. **Graph stats**: assert `nodes ≥ minNodes`, `edges ≥ minEdges`,
   `parseErrors ≤ maxParseErrors`. Catches parser regressions.
4. **MCP tool calls** over real stdio JSON-RPC: each query runs a fresh
   `ctxloom` server process, sends `initialize` + `tools/call`, parses the
   response, and asserts on the result. No in-process shortcuts.
5. **Per-query assertions**: `minResults`, `anyHitMatches`,
   `contentIncludes`, `queryLatencyBudgetMs`.

## The corpus

| Repo | Lang | Scale | Why |
|---|---|---|---|
| `expressjs/express` @ 5.0.1 | JS | small (~200 files) | Mature Node.js — TS/JS parser + semantic search |
| `pallets/flask` @ 3.1.0 | Python | small (~150 files) | Python parser + Python-idiomatic queries |
| `gin-gonic/gin` @ v1.10.0 | Go | small (~100 files) | Go parser |
| `tokio-rs/axum` @ axum-v0.7.9 | Rust | medium (~300 files) | Rust + async-heavy + deep traits |
| `vercel/next.js` @ v15.0.3 | TS | large (~10K+ files) | Scale: index time, latency, monorepo |

Pinned commits keep results deterministic — the corpus only changes when we
deliberately bump versions in `repos.json`.

## Usage

### Local

```bash
npm run build                                # produce dist/index.js
node e2e-corpus/run.mjs                      # all repos
node e2e-corpus/run.mjs --repo=pallets/flask # one repo
node e2e-corpus/run.mjs --json               # machine-readable
```

Clones are cached in `/tmp/ctxloom-e2e-corpus` between runs. Override with
`CTXLOOM_E2E_WORK_DIR=/path/to/cache`.

### CI

`.github/workflows/e2e-corpus.yml` runs the full corpus nightly and on
manual `workflow_dispatch`. Each repo runs as its own matrix leg in
parallel — a flaky single repo doesn't gate the others (`fail-fast: false`).

## Exit codes

- `0` — all assertions passed
- `1` — at least one assertion or step failed
- `2` — runner usage / config error

## Adding a new repo

1. Pick a stable tag or commit on the upstream repo.
2. Add an entry to `repos.json` pointing at a new `scenarios/<repo>.json`.
3. Write the scenario file with realistic queries and assertions calibrated
   to that repo's content. Run locally to confirm it passes against a clean
   clone.
4. Add the repo to the matrix in `.github/workflows/e2e-corpus.yml`.

## Relationship to other testing

- **Unit tests** (`vitest` + `tests/`) — fast, mock-heavy, run on every PR
- **Integration tests** (`apps/vscode-extension/tests/integration/`) — real
  filesystem + real subprocesses but synthetic fixtures
- **e2e-corpus** (this) — **real public repos**, real product surface
- **Benchmarks** (`benchmarks/benchmark-public-repos.ts`) — performance
  numbers, not correctness assertions
