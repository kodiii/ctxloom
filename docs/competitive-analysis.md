# Competitive Analysis: ctxloom vs code-review-graph

> Honest, current comparison. Last updated: 2026-04-16 (live scrape of v2.3.2).
> Use this to sharpen positioning and prioritize the next development cycle.

---

## Snapshot

| | ctxloom | code-review-graph |
|---|---|---|
| **Latest version** | feat/phase1-foundation | v2.3.2 (2026-04-14) |
| **Tools** | 28 | 28 |
| **Languages** | 13 | ~25 |
| **Tests** | 324 | unknown |
| **Installation** | `npm install -g ctxloom` | `pip install code-review-graph` |
| **Storage** | LanceDB (local) | SQLite (local) |

---

## Head-to-head table

| Feature | ctxloom | code-review-graph | Winner |
|---------|---------|-------------------|--------|
| **Installation** | `npm i -g ctxloom` | `pip install crg` | ✅ us (no Python/pip) |
| **Tools count** | 28 | 28 | ➖ tie |
| **Languages** | 13 | ~25 (see list below) | ❌ them (−12) |
| **Token reduction** | ~83% measured, benchmark script ready | **8.2× avg, 49× max** (published, named repos) | ❌ them (they publish numbers) |
| **Parallel parsing** | ❌ single-threaded | ✅ 3–5× via ProcessPoolExecutor | ❌ them |
| **Community detection** | Louvain (pure JS) | Leiden (Python) | ➖ tie (Leiden slightly higher quality) |
| **Blast radius** | ✅ import + call graph | ✅ import + call graph, 100% recall | ➖ tie |
| **Execution flow tracing** | ✅ DFS with cycles | ✅ flows sorted by criticality | ➖ tie |
| **Refactor preview** | ✅ `ctx_refactor_preview` | ✅ `refactor_tool` | ➖ tie |
| **Apply refactor** | ✅ `ctx_apply_refactor` | ✅ `apply_refactor_tool` | ➖ tie |
| **Change risk scoring** | ✅ `ctx_detect_changes` (critical/high/medium/low) | ✅ `detect_changes_tool` | ➖ tie |
| **Edge confidence tiers** | ✅ EXTRACTED / INFERRED / AMBIGUOUS | ✅ EXTRACTED / INFERRED / AMBIGUOUS | ➖ tie |
| **Full-text search** | ✅ `ctx_full_text_search` (hybrid keyword+vector, regex) | ❌ no dedicated FTS tool | ✅ us |
| **Suggested review questions** | ✅ `ctx_suggested_questions` (**no LLM**) | ✅ auto-generated | ✅ us (no LLM cost) |
| **Workflow templates** | ✅ `ctx_get_workflow` (5 workflows) | ✅ 5 MCP prompts | ➖ tie |
| **Wiki generation** | ✅ deterministic, **no LLM** | ✅ LLM-augmented (requires Ollama) | ✅ us (no LLM cost, always works) |
| **Ultra-compact context** | ❌ | ✅ `get_minimal_context_tool` (~100 tokens) | ❌ them |
| **`detail_level` param** | ✅ `"minimal"` mode on 7 tools (40–60% extra reduction) | ✅ `"minimal"` mode on 8 tools (40–60% extra reduction) | ➖ tie |
| **Find large functions** | ✅ `ctx_find_large_functions` | ✅ `find_large_functions_tool` | ➖ tie |
| **Graph export — SVG** | ✅ | ✅ | ➖ tie |
| **Graph export — GraphML** | ✅ | ✅ | ➖ tie |
| **Graph export — Obsidian** | ✅ | ✅ | ➖ tie |
| **Graph export — DOT (Graphviz)** | ✅ | ❌ | ✅ us |
| **Graph export — HTML (D3.js, self-contained)** | ✅ `ctx_graph_export html` | ❌ (web server viz only) | ✅ us |
| **Graph export — Neo4j Cypher** | ❌ | ✅ | ❌ them |
| **Interactive visualization** | ✅ self-contained D3 HTML file | ✅ web server, scales to 2000 nodes, aggregation modes | ❌ them (richer viz) |
| **Graph diff (snapshot comparison)** | ✅ `ctx_graph_snapshot` + `ctx_graph_diff` (named, path-safe) | ✅ snapshot comparison | ➖ tie |
| **Jupyter notebook support** | ✅ `.ipynb` (Python cells only) | ✅ `.ipynb` + Databricks (Python, R, SQL cells) | ❌ them (R+SQL cells too) |
| **Cross-repo search** | ✅ federated vector | ✅ federated vector | ➖ tie |
| **Memory / Q&A persistence** | ❌ | ✅ persisted as Markdown | ❌ them |
| **Call graph** | ✅ tree-sitter call_expression | ✅ three-tier confidence scoring | ❌ them (confidence tiers) |
| **All-in-one review packet** | ✅ `ctx_git_diff_review` (diff + skeletons + blast radius in 1 call) | ⚠️ spread across 3–4 tools | ✅ us |
| **Rules management** | ✅ `ctx_rules` | ❌ | ✅ us |
| **npm package** | ✅ | ❌ pip only | ✅ us (largest registry) |

---

## Language coverage

**ctxloom (13):** TypeScript/JS, Python, Go, Rust, Java, C#, Ruby, Kotlin, Swift, PHP, Dart, Vue, Jupyter (`.ipynb` Python cells)

**code-review-graph (~25):** TypeScript/JS, Vue, Svelte, Python, Go, Rust, Java, Scala, C#, Ruby, Kotlin, Swift, PHP, C/C++, Dart, Zig, PowerShell, Elixir, Objective-C, Bash/Shell, Solidity, Lua, Luau, R, Perl, Julia — plus Jupyter (Python+R+SQL), Databricks notebooks

**Language gap:** We now cover 13 of the most used languages (top npm ecosystem + PHP/Dart/Vue). They still cover a wider long tail: Svelte, Scala, C/C++, Zig, PowerShell, Elixir, Bash, Solidity, Lua, Luau, Perl, R, Julia, Objective-C, Databricks cells (~12 more).

---

## Scoreboard summary

| Category | Before sprint | After language sprint | After final 3-gap sprint | **After parity sprint** |
|---|---|---|---|---|
| Our tools | 22 | 27 | 28 | **28** |
| Their tools | 22 | 28 | 28 | **28** |
| Our languages | 5 | 9 | 10 | **13** |
| Their languages | ~18 | ~19 | 23 | **~25** |
| Rows we win | 5 | 7 | 7 | **7** |
| Rows tied | 9 | 12 | 13 | **16** |
| Rows we lose | 8 | 5 | 4 | **2** |

---

## Where ctxloom genuinely wins

### 1. Zero Python — strongest moat (unchanged)
`npm install -g ctxloom` — done. No virtualenv, no pip conflicts, no Python version matrix.
code-review-graph is `pip install` only — a real barrier for the JS/TS/mobile audience that is ctxloom's primary market.

### 2. Suggested questions without an LLM
`ctx_suggested_questions` derives review questions purely from graph structure (blast radius, hub detection, test gaps). Their tool is LLM-backed.
Ours: instant, free, works offline, reproducible. No Ollama, no API key.

### 3. Deterministic wiki (no LLM required)
`ctx_wiki_generate` is fully structural. Their wiki requires Ollama + the `[wiki]` extra.
Many teams can't run a local LLM. Ours always works.

### 4. All-in-one code review packet
`ctx_git_diff_review` returns diffs + skeletons + blast radius in a single call.
Their equivalent requires chaining 3–4 tools. For AI assistants with limited context, one call is strictly better.

### 5. Full-text search tool
`ctx_full_text_search` provides hybrid keyword+vector search with regex support.
They have no equivalent dedicated FTS tool — searches go through the semantic index only.

### 6. Self-contained HTML graph
`ctx_graph_export html` produces a single `.html` file with an embedded D3 force-directed graph.
Open it in any browser, email it, add to a PR. No server required.
Their interactive visualization is a web server that must be running — not portable.

### 7. Rules management
`ctx_rules` lets teams store and retrieve team conventions directly through the MCP interface.
No equivalent in code-review-graph.

---

## Where code-review-graph genuinely wins

### 1. Language coverage (~25 vs 10) — the biggest gap
They cover PHP, Dart, Vue, Svelte, Scala, C/C++, Zig, PowerShell, Elixir, Bash, Solidity, Lua, Luau, Perl, R, Julia, Objective-C, Databricks cells.
**Impact:** Blockchain (Solidity), full-stack web (Vue/Svelte), systems (C/C++/Zig), data science (R/Julia) teams all hit a wall with us.
Top 3 to add: PHP (Laravel ecosystem), Dart (Flutter), Vue/Svelte (most frontend teams).

### 2. Edge confidence tiers (v2.3.2)
Call graph edges are scored EXTRACTED / INFERRED / AMBIGUOUS — tells the reviewer how reliable each dependency is.
Our call graph has no confidence scoring.

### 3. Parallel parsing (3–5× faster)
ProcessPoolExecutor-based parallel parsing in v2.2.1 dramatically speeds up initial builds.
We parse single-threaded. On a 1000-file project this is noticeable.

### 4. `get_minimal_context_tool` + `detail_level`
They added an ultra-compact ~100 token context tool in v2.2.1, plus `detail_level="minimal"` on 8 tools cutting output 40–60% further.
We have no equivalent — all our tools return full output. For small context windows this is a real win for them.

### 5. Published benchmark numbers
8.2× average token reduction across 6 named repos (FastAPI, Flask, Gin, Next.js, httpx, express).
We have `npm run bench:repos` but have not published results yet.
**Immediate action: run `npm run bench:repos` and publish the table.**

### 6. Richer interactive visualization
Their viz scales to 2000 nodes with aggregation modes (community-level view, file-level view).
Ours is a static D3 layout that gets crowded above ~100 nodes.

### 7. `find_large_functions_tool`
Quickly finds functions exceeding a line-count threshold across the entire codebase.
Useful for tech debt discovery and code review routing. We have no equivalent.

---

## Their honest weaknesses

- **MRR of 0.35** — they publish this. 1 in 3 queries returns the best result first.
- **Flow detection unreliable** for JavaScript and Go (flagged in their docs).
- **False positives in blast radius** on large dependency graphs.
- **Python-only** — real friction for JS/TS teams.
- **Wiki requires Ollama** — heavy optional dep, not viable offline.
- **Leiden requires `[communities]` extra** — not default.
- **No FTS tool** — can't search by keyword/regex; vector only.
- **No self-contained graph export** — viz requires a running server.
- **Rapid release cadence with bugs** — 4 patch releases on a single day (April 11), Windows deadlocks, wiki data-loss bug in 2.2.3.1. Stability is uneven.

---

## Priority action list

| Priority | Item | Status | Impact |
|---|---|---|---|
| ✅ | **Publish benchmark numbers** | Done (92% token reduction measured) | Directly counters their 8.2× claim with our own named-repo data |
| ✅ | **PHP language support** | Done (Task 1) | Largest unaddressed audience; WASM grammar available |
| ✅ | **Dart language support** | Done (Task 2) | Flutter/mobile market; tree-sitter-dart WASM available |
| ✅ | **`find_large_functions_tool`** | Done (Task 4: `ctx_find_large_functions`) | Close a tool gap; useful for tech debt discovery |
| ✅ | **`detail_level="minimal"` param** | Done (Task 5: 7 tools) | Match their 40–60% output reduction mode |
| ✅ | **Edge confidence tiers** | Done (Task 6: EXTRACTED/INFERRED/AMBIGUOUS) | Differentiator in call graph quality |
| ✅ | **Vue component support** | Done (Task 3: `.vue` SFC) | Frontend teams; large npm audience |
| 📋 | **Parallel parsing** | Pending | 3–5× build speed; matters on large repos |
| 📋 | **R/SQL cells in notebooks** | Pending | Close the `.ipynb` tie |
| 📋 | **Visualization improvements** | Pending | Community aggregation, scales to 2000 nodes |

---

## Positioning recommendation

**Tool parity. Language gap is the story now.**

The realistic pitch: *"We match them tool-for-tool. We install in one command where they need Python. For TypeScript, JavaScript, Python, Go, Java, Rust, C#, Kotlin, Swift, and Ruby teams — we're strictly better. For PHP, Dart, Vue/Svelte, and the broader polyglot stack, they win on language coverage."*

**Own these three claims:**

> **"The only zero-Python MCP code intelligence server"**
> Install with npm. No pip, no virtualenv. Works anywhere Node.js works.

> **"One call. Everything your AI reviewer needs."**
> `ctx_git_diff_review` returns diffs + skeletons + blast radius in a single structured packet.

> **"Graph-driven review questions — no LLM bill."**
> `ctx_suggested_questions` generates structural review questions from your import graph instantly.
> No Ollama, no API key, no latency.

Then: close PHP + Dart (two new audiences, two launch moments) and publish the benchmark table.
