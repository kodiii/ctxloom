# Architecture Rules Engine

Define forbidden import rules in `.ctxloom/rules.yml` and enforce them in CI or via your AI coding assistant.

## Quick Start

Create `.ctxloom/rules.yml` in your project root:

```yaml
version: 1

rules:
  - name: "domain must not import infrastructure"
    type: no-import
    from: "src/domain/**"
    to: "src/infra/**"
    severity: error

  - name: "warn on UI importing services directly"
    type: no-import
    from: "src/ui/**"
    to: "src/services/**"
    severity: warn
```

Then run:

```bash
ctxloom rules check
```

## CLI Reference

```
ctxloom rules check                   Check all rules (fresh graph build)
ctxloom rules check --json            Output violations as JSON
ctxloom rules check --use-snapshot    Fast mode: reuse last indexed graph
ctxloom rules check --limit=N         Show only first N violations in text mode (default: 50)
ctxloom rules check --limit=0         Show all violations (no truncation)
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Clean — no violations, or only `warn` severity |
| 1 | Rule violations found (at least one `error` severity) |
| 2 | Configuration error or build failure |

## Rule Config Reference

```yaml
version: 1   # required, must be 1

rules:
  - name: "human-readable rule name"  # required; appears in violation messages
    type: no-import                    # required; only supported type in v1
    from: "glob/**"                    # required; files that must not import...
    to: "glob/**"                      # required; ...these files
    severity: error                    # optional; "error" (default) or "warn"
```

### Glob Syntax

Patterns use [picomatch](https://github.com/micromatch/picomatch) semantics:

| Pattern | Matches |
|---------|---------|
| `src/domain/**` | All files anywhere under `src/domain/` |
| `src/*/index.ts` | `index.ts` one level inside any dir under `src/` |
| `**/*.test.ts` | All test files in the repo |

### Severity

- **`error`** (default): violations cause `ctxloom rules check` to exit with code 1. Blocks CI.
- **`warn`**: violations are reported but exit code stays 0. Use while cleaning up a codebase.

## CI Integration (GitHub Actions)

```yaml
- name: Check architecture rules
  run: ctxloom rules check
```

For JSON output (consumed by ctxloom-prbot or custom scripts):

```yaml
- name: Check architecture rules (JSON)
  run: ctxloom rules check --json > violations.json
```

## MCP Tool: `ctx_rules_check`

When ctxloom is running as an MCP server, AI assistants can query architecture rules directly:

> "Are there any architecture rule violations in this file?"

The tool reads `.ctxloom/rules.yml` and checks the live dependency graph (maintained by FileWatcher). Results reflect the current state of the code without requiring a rebuild.

## Known Limitations (v1)

- **Direct imports only.** `A → B → C` does not flag `A` for importing `C` transitively. Only direct edges are checked.
- **Supported languages.** The dependency graph covers TypeScript, JavaScript, Python, Go, Rust, Java, C#, Ruby, Kotlin, Swift, PHP, Dart, and Jupyter notebooks. Other file types have no edges and cannot be matched.
- **One pattern per rule.** `from` and `to` each take a single glob string. Write multiple rules for multiple source/target sets.
