# Architecture Rules Engine — Design Spec

**Date:** 2026-04-19
**Status:** Approved
**Branch:** feat/tier1-addons

---

## Overview

A CI linter over the dependency graph. Users define forbidden-import rules in `.ctxloom/rules.yml`; ctxloom checks them against the real import graph and reports violations. Ships in core (AGPL).

CLI command: `ctxloom rules check`
MCP tool: `ctx_rules_check`
Config: `.ctxloom/rules.yml`

**Note:** The existing `ctx_get_rules` MCP tool loads project conventions from `.cursorrules`/`CLAUDE.md` — unrelated. The new `ctx_rules_check` tool is a dependency-graph linter. Different names, different purposes, no conflict.

---

## Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Rule types | `no-import` only for v1 | 90% of real arch rules are forbidden-imports; YAGNI on `must-import` / `no-circular` |
| 2 | Pattern syntax | Glob via picomatch | Universal dev syntax; same engine as ESLint, Vite, Prettier |
| 3 | Output format | Text default + `--json` flag | Platform-neutral core; `ctxloom-prbot` consumes JSON |
| 4 | Graph source (CLI) | Fresh rebuild default; `--use-snapshot` opt-in | Correctness > speed for merge gates; opt-in staleness for local dev |
| 5 | Architecture | `src/rules/` module + CLI command + MCP tool | Consistent with product identity; enables AI-assistant rule checks pre-edit |

**Future work (documented, not built):**
- `type: must-import` — A is required to import B
- `from: string[]` and `to: string[]` — multiple patterns per rule (non-breaking schema widening)
- Transitive import checking (flag `A → C → B` where `C` is an intermediary)
- `--config=path` flag for custom config location

---

## Architecture Overview

```
.ctxloom/rules.yml
        │
        ▼
┌──────────────────────────────┐
│   src/rules/                 │
│   ├── types.ts               │  Rule, Violation, CheckResult, RulesConfig
│   ├── loadConfig.ts          │  YAML parser + zod schema validation
│   ├── RulesChecker.ts        │  core algorithm (graph + globs → violations)
│   ├── reporter.ts            │  text + JSON formatters
│   └── index.ts               │  barrel export
└──────────────────────────────┘
        │
    ┌───┴────────────────┬──────────────────────┐
    ▼                    ▼                      ▼
CLI command          MCP tool              Web dashboard
(src/index.ts)    (src/tools/             (imports module
'rules check'      rules-check.ts)         directly, future)
```

`RulesChecker` is graph-source-agnostic — it takes a `DependencyGraph` instance as input. The CLI hands it a freshly-built graph; the MCP tool hands it the live server graph. Same algorithm, different graph sources.

---

## Components & Public APIs

### `src/rules/types.ts`

```typescript
interface Rule {
  name: string;                       // used in violation messages
  type: 'no-import';                  // discriminated union — ready for future types
  from: string;                       // glob, e.g. "src/domain/**"
  to: string;                         // glob, e.g. "src/infra/**"
  severity?: 'error' | 'warn';        // default 'error'
}

interface RulesConfig {
  version: 1;
  rules: Rule[];
}

interface Violation {
  rule: string;                       // rule.name
  severity: 'error' | 'warn';
  fromFile: string;                   // relative to repo root
  toFile: string;
  message: string;                    // pre-formatted human message
}

interface CheckResult {
  violations: Violation[];
  warnings: string[];                 // dead rules, config hints
  rulesChecked: number;
  filesChecked: number;
  durationMs: number;
}
```

### `src/rules/loadConfig.ts`

```typescript
export async function loadRulesConfig(rootDir: string): Promise<RulesConfig | null>;
// Returns null if file missing (caller emits hint to stderr, exits 0).
// Throws RulesConfigError (exit 2) on invalid YAML or schema failure.
// Zod validates: version, rules[].type, rules[].name, rules[].from, rules[].to.
```

### `src/rules/RulesChecker.ts`

```typescript
export class RulesChecker {
  constructor(private graph: DependencyGraph, private config: RulesConfig) {}
  check(): CheckResult;
}
```

### `src/rules/reporter.ts`

```typescript
export function formatText(result: CheckResult, limit?: number): string;
// limit defaults to 50; 0 = unlimited. Truncation note in footer.
// JSON mode is always unlimited — limit is a text-only concern.

export function formatJson(result: CheckResult): string;
// Always emits full violation list.
// Injects schemaVersion: 1 at serialization time (not a field on CheckResult);
// consumers (dashboard, ctxloom-prbot) use it for forward-compat handling.
```

### `src/tools/rules-check.ts` (MCP tool)

```typescript
export function registerRulesCheckTool(registry: ToolRegistry, ctx: ServerContext): void;
// Registers 'ctx_rules_check'.
// Loads config from ctx.getRoot()/.ctxloom/rules.yml on each call (no caching).
// Queries ctx.getGraph() (live, FileWatcher-maintained).
// Returns CheckResult as structured JSON in MCP response.
// Returns {violations: [], warnings: ["no rules configured"]} when config missing — never throws.
```

### CLI (`src/index.ts`) — new `rules` case

```
ctxloom rules check                   # fresh rebuild, text output, exit 0/1/2
ctxloom rules check --json            # fresh rebuild, JSON to stdout
ctxloom rules check --use-snapshot    # fast local-dev mode (accepts staleness)
ctxloom rules check --limit=N         # cap text output at N violations (default 50)
ctxloom rules check --limit=0         # unlimited text output
```

---

## Data Flow & Algorithm

### CLI flow

```
1. Parse flags: --json, --use-snapshot, --limit
2. loadRulesConfig(cwd):
   - null → print hint to stderr, exit 0
   - throws → print error to stderr, exit 2
3. Get DependencyGraph:
   - default: fresh buildFromDirectory(cwd) — deterministic, CI-safe
   - --use-snapshot: load existing snapshot; exit 2 if missing
4. new RulesChecker(graph, config).check() → CheckResult
5. Format:
   - text (default): formatText(result, limit) → stdout
   - --json: formatJson(result) → stdout (always full list)
   - hints / errors always → stderr
6. Exit code per taxonomy below
```

### MCP flow

```
1. loadRulesConfig(ctx.getRoot()) — on every call, no caching
2. graph = ctx.getGraph()  (live, FileWatcher-maintained)
3. new RulesChecker(graph, config).check() → CheckResult
4. Return as MCP JSON response
```

### Core algorithm (`RulesChecker.check()`)

```
const allFiles = graph.allFiles()           // called once

for each rule in config.rules:
  fromMatcher = picomatch(rule.from, { dot: true })  // compiled once per rule
  toMatcher   = picomatch(rule.to,   { dot: true })

  fromFiles = allFiles.filter(fromMatcher)
  toFiles   = new Set(allFiles.filter(toMatcher))  // Set for O(1) lookup

  if fromFiles.length === 0 || toFiles.size === 0:
    warnings.push(`rule "${rule.name}" matched 0 files on from/to — check glob`)
    continue

  for each fromFile in fromFiles:
    for each importedFile of graph.getImports(fromFile):
      if toFiles.has(importedFile):
        violations.push({
          rule: rule.name,
          severity: rule.severity ?? 'error',
          fromFile,
          toFile: importedFile,
          message: `${fromFile} must not import ${importedFile}  [${rule.name}]`
        })
```

**Complexity:** O(R × N + R × E_from) where R = rules, N = files, E_from = edges from `from`-matched files. Sub-second on any realistic codebase.

**Checks direct imports only.** Transitive reach (`A → C → B`) is not flagged in v1. This is a deliberate scope decision: direct violations produce clear, actionable messages; transitive chains require path explanation and graph traversal with cycle detection. Document as known limitation.

---

## Exit Code Taxonomy

| Code | Meaning |
|------|---------|
| **0** | Clean run — no violations, or only `warn` severity |
| **1** | Rule violations found — at least one `error` severity |
| **2** | Anything went wrong — config invalid, I/O error, build failure, missing snapshot |

---

## Error Handling

| Situation | Behavior |
|-----------|----------|
| `.ctxloom/rules.yml` missing | Print hint to **stderr**, exit 0 |
| Invalid YAML syntax | Print parse error with line number to stderr, exit 2 |
| Zod schema failure | Print each field error (e.g. `rules[0].from: must be a string`) to stderr, exit 2 |
| Empty `rules: []` | Print "0 rules configured. 0 violations." to stdout, exit 0 |
| Invalid glob pattern (picomatch throws) | Treat as config error — exit 2, name the offending rule |
| `--use-snapshot` with no snapshot | Print "No graph snapshot found. Run `ctxloom index` first." to stderr, exit 2 |
| Fresh build fails (I/O, parser crash) | Print error to stderr, exit 2 (not 1 — not a rule violation) |
| MCP call with no config file | Return `{violations: [], warnings: ["no rules configured"]}` — never throw |
| 50+ violations in text mode | Emit first 50 + footer: "... and N more. Run with `--json` for full output." |
| `--json` + any violations | Always emit full list — `--limit` is ignored in JSON mode |

**Stderr/stdout discipline:**
- **stdout**: violation output (text or JSON), clean-run messages
- **stderr**: hints, config errors, runtime errors — never pollutes stdout in JSON mode

---

## Config File Format

```yaml
# .ctxloom/rules.yml
version: 1

rules:
  - name: "domain must not import infrastructure"
    type: no-import
    from: "src/domain/**"
    to: "src/infra/**"
    severity: error      # optional, defaults to error

  - name: "domain must not import adapters"
    type: no-import
    from: "src/domain/**"
    to: "src/adapters/**"

  - name: "warn on ui importing services directly"
    type: no-import
    from: "src/ui/**"
    to: "src/services/**"
    severity: warn
```

**Glob semantics:** picomatch with `{ dot: true }`. Patterns match relative file paths as stored in the dependency graph (e.g. `src/domain/user.ts`). Use `**` for recursive matching, `*` for single-segment wildcard.

---

## Testing Strategy

### Unit tests (Vitest)

| File | Coverage |
|------|----------|
| `loadConfig.test.ts` | Valid parse; missing file returns null; invalid YAML throws; zod rejects bad `type`, missing fields, wrong types; default severity |
| `RulesChecker.test.ts` | Direct violation detected; no false positive on unrelated edges; multiple rules firing on same edge → multiple violations; dead-rule warning (0 from-matches, 0 to-matches); severity propagated; empty graph handled; empty rules handled; glob patterns (`**`, `*`, nested, dotfiles) |
| `reporter.test.ts` | Text format snapshot; `--limit` truncation with footer; no truncation in JSON; `schemaVersion: 1` in JSON; violation grouping |

### Integration tests

| File | Coverage |
|------|----------|
| `rules-cli.integration.test.ts` | Spawn `ctxloom rules check` against fixture repos; assert: fresh-build path, `--use-snapshot` path, `--json` output, exit codes 0/1/2, stdout/stderr separation (JSON mode: clean stdout, hints to stderr) |
| `rules-mcp.integration.test.ts` | Register `ctx_rules_check` in a test MCP server; assert JSON response shape; assert live-graph freshness: after adding violating edge, next call sees it without restart |

### Test fixtures

| Fixture | Purpose |
|---------|---------|
| `test/fixtures/rules/clean-repo/` | Passes all rules — expect exit 0, 0 violations |
| `test/fixtures/rules/violating-repo/` | 3 known violations (domain→infra, ui→services, etc.) — expect exit 1 |
| `test/fixtures/rules/no-config/` | No `.ctxloom/rules.yml` — expect exit 0, hint on stderr |
| `test/fixtures/rules/bad-config/` | Malformed YAML — expect exit 2 |

**Coverage target:** ≥80% on `src/rules/**`

### Not tested in v1

- Performance benchmarks (manual spot-check on large repo; add if perf regresses)
- Stale-snapshot behavior under `--use-snapshot` (documented limitation, user opt-in)
- picomatch internal caching (implementation detail; document via code comment)

---

## File Inventory

New files:
```
src/rules/types.ts
src/rules/loadConfig.ts
src/rules/RulesChecker.ts
src/rules/reporter.ts
src/rules/index.ts
src/tools/rules-check.ts
docs/rules-engine.md                 (user-facing guide: config syntax, CLI/MCP usage, examples)
test/fixtures/rules/clean-repo/      (minimal fixture)
test/fixtures/rules/violating-repo/  (minimal fixture)
test/fixtures/rules/no-config/       (empty dir)
test/fixtures/rules/bad-config/      (malformed yml)
src/rules/__tests__/loadConfig.test.ts
src/rules/__tests__/RulesChecker.test.ts
src/rules/__tests__/reporter.test.ts
test/integration/rules-cli.integration.test.ts
test/integration/rules-mcp.integration.test.ts
```

Modified files:
```
src/index.ts          — add 'rules' case with 'check' subcommand
src/server.ts         — register ctx_rules_check MCP tool
src/tools/index.ts    — add registerRulesCheckTool to tool registry
```
