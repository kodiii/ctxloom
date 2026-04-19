# Architecture Rules Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `ctxloom rules check` CLI command and `ctx_rules_check` MCP tool that lint the dependency graph against user-defined forbidden-import rules in `.ctxloom/rules.yml`.

**Architecture:** A `src/rules/` module owns all logic (types, config loading, checking, formatting). The CLI in `src/index.ts` rebuilds the graph fresh and calls into it; the MCP tool in `src/tools/rules-check.ts` queries the live server graph. `RulesChecker` is graph-source-agnostic — it receives a `DependencyGraph` instance and emits a `CheckResult`.

**Tech Stack:** TypeScript, `js-yaml` (already in deps), `zod` (already in deps), `picomatch` (already installed transitively via `chokidar` — add as direct dep), `vitest` (existing test runner)

---

## File Map

**New files:**
| File | Responsibility |
|------|---------------|
| `src/rules/types.ts` | All shared types + `RulesConfigError` class |
| `src/rules/loadConfig.ts` | Read + validate `.ctxloom/rules.yml` via `js-yaml` + `zod` |
| `src/rules/RulesChecker.ts` | Core algorithm: graph edges × glob rules → violations |
| `src/rules/reporter.ts` | `formatText()` and `formatJson()` formatters |
| `src/rules/index.ts` | Barrel export |
| `src/tools/rules-check.ts` | MCP tool `ctx_rules_check` |
| `tests/RulesLoadConfig.test.ts` | Unit tests for loadConfig |
| `tests/RulesChecker.test.ts` | Unit tests for RulesChecker |
| `tests/RulesReporter.test.ts` | Unit tests for reporter |
| `tests/RulesCLI.test.ts` | Integration tests for `rules check` CLI |
| `tests/RulesMCP.test.ts` | Integration tests for `ctx_rules_check` MCP tool |
| `test/fixtures/rules/clean-repo/.ctxloom/rules.yml` | Fixture: passes all rules |
| `test/fixtures/rules/clean-repo/src/domain/user.ts` | Fixture file with no infra imports |
| `test/fixtures/rules/clean-repo/src/infra/db.ts` | Fixture infra file |
| `test/fixtures/rules/violating-repo/.ctxloom/rules.yml` | Fixture: has violations |
| `test/fixtures/rules/violating-repo/src/domain/user.ts` | Imports infra (violation) |
| `test/fixtures/rules/violating-repo/src/domain/order.ts` | Imports infra (violation) |
| `test/fixtures/rules/violating-repo/src/infra/db.ts` | Target infra file |
| `test/fixtures/rules/violating-repo/src/infra/cache.ts` | Target infra file |
| `test/fixtures/rules/bad-config/.ctxloom/rules.yml` | Fixture: malformed YAML |
| `docs/rules-engine.md` | User-facing guide |

**Modified files:**
| File | Change |
|------|--------|
| `src/index.ts` | Add `rules` command with `check` subcommand |
| `src/tools/index.ts` | Import + call `registerRulesCheckTool` |
| `package.json` | Add `picomatch` as direct dependency |

---

## Task 1: Add picomatch as a direct dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install picomatch**

```bash
npm install picomatch
npm install --save-dev @types/picomatch
```

Expected: `package.json` `dependencies` now includes `"picomatch": "^4.x.x"` and `devDependencies` includes `"@types/picomatch"`.

- [ ] **Step 2: Verify picomatch resolves**

```bash
node -e "import('picomatch').then(m => console.log('ok', typeof m.default))"
```

Expected output: `ok function`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add picomatch as direct dependency"
```

---

## Task 2: Define shared types

**Files:**
- Create: `src/rules/types.ts`

No tests required for pure type definitions.

- [ ] **Step 1: Create `src/rules/types.ts`**

```typescript
export interface Rule {
  name: string;
  type: 'no-import';
  from: string;
  to: string;
  severity?: 'error' | 'warn';
}

export interface RulesConfig {
  version: 1;
  rules: Rule[];
}

export interface Violation {
  rule: string;
  severity: 'error' | 'warn';
  fromFile: string;
  toFile: string;
  message: string;
}

export interface CheckResult {
  violations: Violation[];
  warnings: string[];
  rulesChecked: number;
  filesChecked: number;
  durationMs: number;
}

export class RulesConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RulesConfigError';
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/rules/types.ts
git commit -m "feat(rules): add shared types"
```

---

## Task 3: Implement loadConfig (TDD)

**Files:**
- Create: `src/rules/loadConfig.ts`
- Create: `tests/RulesLoadConfig.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/RulesLoadConfig.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadRulesConfig } from '../src/rules/loadConfig.js';
import { RulesConfigError } from '../src/rules/types.js';

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ctxloom-rules-test-'));
}

describe('loadRulesConfig', () => {
  it('returns null when .ctxloom/rules.yml is missing', async () => {
    const dir = await makeTmpDir();
    const result = await loadRulesConfig(dir);
    expect(result).toBeNull();
  });

  it('parses a valid rules.yml', async () => {
    const dir = await makeTmpDir();
    await fs.mkdir(path.join(dir, '.ctxloom'));
    await fs.writeFile(path.join(dir, '.ctxloom', 'rules.yml'), `
version: 1
rules:
  - name: "no infra in domain"
    type: no-import
    from: "src/domain/**"
    to: "src/infra/**"
    severity: error
`);
    const result = await loadRulesConfig(dir);
    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
    expect(result!.rules).toHaveLength(1);
    expect(result!.rules[0]!.name).toBe('no infra in domain');
    expect(result!.rules[0]!.from).toBe('src/domain/**');
    expect(result!.rules[0]!.severity).toBe('error');
  });

  it('allows severity to be omitted (Rule.severity is optional)', async () => {
    const dir = await makeTmpDir();
    await fs.mkdir(path.join(dir, '.ctxloom'));
    await fs.writeFile(path.join(dir, '.ctxloom', 'rules.yml'), `
version: 1
rules:
  - name: "no infra in domain"
    type: no-import
    from: "src/domain/**"
    to: "src/infra/**"
`);
    const result = await loadRulesConfig(dir);
    expect(result!.rules[0]!.severity).toBeUndefined();
  });

  it('accepts empty rules array', async () => {
    const dir = await makeTmpDir();
    await fs.mkdir(path.join(dir, '.ctxloom'));
    await fs.writeFile(path.join(dir, '.ctxloom', 'rules.yml'), 'version: 1\nrules: []\n');
    const result = await loadRulesConfig(dir);
    expect(result!.rules).toHaveLength(0);
  });

  it('throws RulesConfigError on invalid YAML', async () => {
    const dir = await makeTmpDir();
    await fs.mkdir(path.join(dir, '.ctxloom'));
    await fs.writeFile(path.join(dir, '.ctxloom', 'rules.yml'), 'key: [unclosed');
    await expect(loadRulesConfig(dir)).rejects.toBeInstanceOf(RulesConfigError);
  });

  it('throws RulesConfigError when version field is missing', async () => {
    const dir = await makeTmpDir();
    await fs.mkdir(path.join(dir, '.ctxloom'));
    await fs.writeFile(path.join(dir, '.ctxloom', 'rules.yml'), `
rules:
  - name: "no infra"
    type: no-import
    from: "src/**"
    to: "lib/**"
`);
    await expect(loadRulesConfig(dir)).rejects.toBeInstanceOf(RulesConfigError);
  });

  it('throws RulesConfigError when rule type is invalid', async () => {
    const dir = await makeTmpDir();
    await fs.mkdir(path.join(dir, '.ctxloom'));
    await fs.writeFile(path.join(dir, '.ctxloom', 'rules.yml'), `
version: 1
rules:
  - name: "bad type"
    type: must-import
    from: "src/**"
    to: "lib/**"
`);
    await expect(loadRulesConfig(dir)).rejects.toBeInstanceOf(RulesConfigError);
  });

  it('throws RulesConfigError when rule is missing required "from" field', async () => {
    const dir = await makeTmpDir();
    await fs.mkdir(path.join(dir, '.ctxloom'));
    await fs.writeFile(path.join(dir, '.ctxloom', 'rules.yml'), `
version: 1
rules:
  - name: "missing from"
    type: no-import
    to: "src/infra/**"
`);
    await expect(loadRulesConfig(dir)).rejects.toBeInstanceOf(RulesConfigError);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/RulesLoadConfig.test.ts
```

Expected: all tests FAIL with `Cannot find module '../src/rules/loadConfig.js'`.

- [ ] **Step 3: Implement `src/rules/loadConfig.ts`**

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import { RulesConfigError } from './types.js';
import type { RulesConfig } from './types.js';

const RuleSchema = z.object({
  name: z.string(),
  type: z.literal('no-import'),
  from: z.string(),
  to: z.string(),
  severity: z.enum(['error', 'warn']).optional(),
});

const RulesConfigSchema = z.object({
  version: z.literal(1),
  rules: z.array(RuleSchema).default([]),
});

export async function loadRulesConfig(rootDir: string): Promise<RulesConfig | null> {
  const filePath = path.join(rootDir, '.ctxloom', 'rules.yml');

  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new RulesConfigError(`Failed to read rules config: ${String(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err: unknown) {
    throw new RulesConfigError(`Invalid YAML in .ctxloom/rules.yml: ${String(err)}`);
  }

  const result = RulesConfigSchema.safeParse(parsed);
  if (!result.success) {
    const messages = result.error.errors
      .map(e => `  ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new RulesConfigError(`Invalid .ctxloom/rules.yml schema:\n${messages}`);
  }

  return result.data as RulesConfig;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/RulesLoadConfig.test.ts
```

Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rules/loadConfig.ts tests/RulesLoadConfig.test.ts
git commit -m "feat(rules): implement loadConfig with zod validation"
```

---

## Task 4: Implement RulesChecker (TDD)

**Files:**
- Create: `src/rules/RulesChecker.ts`
- Create: `tests/RulesChecker.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/RulesChecker.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { RulesChecker } from '../src/rules/RulesChecker.js';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import type { RulesConfig } from '../src/rules/types.js';

function makeGraph(edges: Array<[string, string]>): DependencyGraph {
  const graph = new DependencyGraph();
  for (const [from, to] of edges) {
    graph.addEdge(from, to);
  }
  return graph;
}

const baseConfig: RulesConfig = {
  version: 1,
  rules: [
    {
      name: 'no-infra-in-domain',
      type: 'no-import',
      from: 'src/domain/**',
      to: 'src/infra/**',
      severity: 'error',
    },
  ],
};

describe('RulesChecker', () => {
  it('detects a direct import violation', () => {
    const graph = makeGraph([['src/domain/user.ts', 'src/infra/db.ts']]);
    const result = new RulesChecker(graph, baseConfig).check();
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.fromFile).toBe('src/domain/user.ts');
    expect(result.violations[0]!.toFile).toBe('src/infra/db.ts');
    expect(result.violations[0]!.rule).toBe('no-infra-in-domain');
    expect(result.violations[0]!.severity).toBe('error');
    expect(result.violations[0]!.message).toContain('src/domain/user.ts');
    expect(result.violations[0]!.message).toContain('[no-infra-in-domain]');
  });

  it('does not flag an edge that does not match the rule', () => {
    const graph = makeGraph([['src/ui/page.ts', 'src/ui/component.ts']]);
    const result = new RulesChecker(graph, baseConfig).check();
    expect(result.violations).toHaveLength(0);
  });

  it('detects multiple violations for multiple matching edges', () => {
    const graph = makeGraph([
      ['src/domain/user.ts', 'src/infra/db.ts'],
      ['src/domain/order.ts', 'src/infra/cache.ts'],
    ]);
    const result = new RulesChecker(graph, baseConfig).check();
    expect(result.violations).toHaveLength(2);
  });

  it('emits two violations when two rules match the same edge', () => {
    const config: RulesConfig = {
      version: 1,
      rules: [
        { name: 'rule-a', type: 'no-import', from: 'src/domain/**', to: 'src/infra/**', severity: 'error' },
        { name: 'rule-b', type: 'no-import', from: 'src/**', to: 'src/infra/**', severity: 'warn' },
      ],
    };
    const graph = makeGraph([['src/domain/user.ts', 'src/infra/db.ts']]);
    const result = new RulesChecker(graph, config).check();
    expect(result.violations).toHaveLength(2);
    expect(result.violations.map(v => v.rule)).toContain('rule-a');
    expect(result.violations.map(v => v.rule)).toContain('rule-b');
  });

  it('emits a warning for a rule whose "from" glob matches 0 files', () => {
    const config: RulesConfig = {
      version: 1,
      rules: [{ name: 'ghost-rule', type: 'no-import', from: 'src/nonexistent/**', to: 'src/infra/**' }],
    };
    const graph = makeGraph([['src/domain/user.ts', 'src/infra/db.ts']]);
    const result = new RulesChecker(graph, config).check();
    expect(result.violations).toHaveLength(0);
    expect(result.warnings.some(w => w.includes('ghost-rule'))).toBe(true);
  });

  it('emits a warning for a rule whose "to" glob matches 0 files', () => {
    const config: RulesConfig = {
      version: 1,
      rules: [{ name: 'ghost-to', type: 'no-import', from: 'src/domain/**', to: 'src/nonexistent/**' }],
    };
    const graph = makeGraph([['src/domain/user.ts', 'src/infra/db.ts']]);
    const result = new RulesChecker(graph, config).check();
    expect(result.warnings.some(w => w.includes('ghost-to'))).toBe(true);
  });

  it('defaults severity to "error" when omitted in rule', () => {
    const config: RulesConfig = {
      version: 1,
      rules: [{ name: 'no-infra', type: 'no-import', from: 'src/domain/**', to: 'src/infra/**' }],
    };
    const graph = makeGraph([['src/domain/user.ts', 'src/infra/db.ts']]);
    const result = new RulesChecker(graph, config).check();
    expect(result.violations[0]!.severity).toBe('error');
  });

  it('handles an empty graph (no files)', () => {
    const graph = new DependencyGraph();
    const result = new RulesChecker(graph, baseConfig).check();
    expect(result.violations).toHaveLength(0);
    expect(result.filesChecked).toBe(0);
  });

  it('handles an empty rules config', () => {
    const config: RulesConfig = { version: 1, rules: [] };
    const graph = makeGraph([['src/domain/user.ts', 'src/infra/db.ts']]);
    const result = new RulesChecker(graph, config).check();
    expect(result.violations).toHaveLength(0);
    expect(result.rulesChecked).toBe(0);
  });

  it('matches deeply nested files with ** glob', () => {
    const graph = makeGraph([
      ['src/domain/orders/services/order.ts', 'src/infra/persistence/repos/order.ts'],
    ]);
    const result = new RulesChecker(graph, baseConfig).check();
    expect(result.violations).toHaveLength(1);
  });

  it('does not match a file in domain against a non-infra to target', () => {
    const graph = makeGraph([['src/domain/user.ts', 'src/domain/order.ts']]);
    const result = new RulesChecker(graph, baseConfig).check();
    expect(result.violations).toHaveLength(0);
  });

  it('reports correct filesChecked and rulesChecked counts', () => {
    const graph = makeGraph([
      ['src/domain/user.ts', 'src/infra/db.ts'],
      ['src/ui/page.ts', 'src/ui/component.ts'],
    ]);
    const result = new RulesChecker(graph, baseConfig).check();
    expect(result.rulesChecked).toBe(1);
    expect(result.filesChecked).toBe(4);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/RulesChecker.test.ts
```

Expected: all tests FAIL with `Cannot find module '../src/rules/RulesChecker.js'`.

- [ ] **Step 3: Implement `src/rules/RulesChecker.ts`**

```typescript
import picomatch from 'picomatch';
import type { DependencyGraph } from '../graph/DependencyGraph.js';
import type { RulesConfig, CheckResult, Violation } from './types.js';

export class RulesChecker {
  constructor(
    private readonly graph: DependencyGraph,
    private readonly config: RulesConfig,
  ) {}

  check(): CheckResult {
    const start = Date.now();
    const violations: Violation[] = [];
    const warnings: string[] = [];
    const allFiles = this.graph.allFiles();

    for (const rule of this.config.rules) {
      const fromMatcher = picomatch(rule.from, { dot: true });
      const toMatcher = picomatch(rule.to, { dot: true });

      const fromFiles = allFiles.filter(fromMatcher);
      const toFiles = new Set(allFiles.filter(toMatcher));

      if (fromFiles.length === 0 || toFiles.size === 0) {
        const side = fromFiles.length === 0 ? '"from"' : '"to"';
        warnings.push(`rule "${rule.name}" matched 0 files on ${side} — check your glob`);
        continue;
      }

      const severity = rule.severity ?? 'error';

      for (const fromFile of fromFiles) {
        for (const importedFile of this.graph.getImports(fromFile)) {
          if (toFiles.has(importedFile)) {
            violations.push({
              rule: rule.name,
              severity,
              fromFile,
              toFile: importedFile,
              message: `${fromFile} must not import ${importedFile}  [${rule.name}]`,
            });
          }
        }
      }
    }

    return {
      violations,
      warnings,
      rulesChecked: this.config.rules.length,
      filesChecked: allFiles.length,
      durationMs: Date.now() - start,
    };
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/RulesChecker.test.ts
```

Expected: all 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rules/RulesChecker.ts tests/RulesChecker.test.ts
git commit -m "feat(rules): implement RulesChecker with picomatch glob matching"
```

---

## Task 5: Implement reporter (TDD)

**Files:**
- Create: `src/rules/reporter.ts`
- Create: `tests/RulesReporter.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/RulesReporter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatText, formatJson } from '../src/rules/reporter.js';
import type { CheckResult } from '../src/rules/types.js';

const cleanResult: CheckResult = {
  violations: [],
  warnings: [],
  rulesChecked: 3,
  filesChecked: 42,
  durationMs: 12,
};

const violatingResult: CheckResult = {
  violations: [
    {
      rule: 'no-infra-in-domain',
      severity: 'error',
      fromFile: 'src/domain/user.ts',
      toFile: 'src/infra/db.ts',
      message: 'src/domain/user.ts must not import src/infra/db.ts  [no-infra-in-domain]',
    },
    {
      rule: 'no-services-in-ui',
      severity: 'warn',
      fromFile: 'src/ui/page.ts',
      toFile: 'src/services/auth.ts',
      message: 'src/ui/page.ts must not import src/services/auth.ts  [no-services-in-ui]',
    },
  ],
  warnings: ['rule "ghost-rule" matched 0 files on "from" — check your glob'],
  rulesChecked: 3,
  filesChecked: 42,
  durationMs: 8,
};

function makeManyViolations(count: number): CheckResult {
  return {
    ...violatingResult,
    violations: Array.from({ length: count }, (_, i) => ({
      rule: 'r',
      severity: 'error' as const,
      fromFile: `src/domain/file${i}.ts`,
      toFile: 'src/infra/db.ts',
      message: `src/domain/file${i}.ts must not import src/infra/db.ts  [r]`,
    })),
  };
}

describe('formatText', () => {
  it('reports 0 violations for a clean result', () => {
    const out = formatText(cleanResult);
    expect(out).toContain('0 violations');
  });

  it('includes rule count and file count in clean output', () => {
    const out = formatText(cleanResult);
    expect(out).toContain('3');
    expect(out).toContain('42');
  });

  it('lists violation message, from-file, and rule name', () => {
    const out = formatText(violatingResult);
    expect(out).toContain('src/domain/user.ts');
    expect(out).toContain('src/infra/db.ts');
    expect(out).toContain('[no-infra-in-domain]');
  });

  it('includes ERROR tag for error severity', () => {
    const out = formatText(violatingResult);
    expect(out).toContain('[ERROR]');
  });

  it('includes WARN tag for warn severity', () => {
    const out = formatText(violatingResult);
    expect(out).toContain('[WARN]');
  });

  it('shows warnings when present', () => {
    const out = formatText(violatingResult);
    expect(out).toContain('ghost-rule');
  });

  it('truncates at limit=50 and shows footer', () => {
    const out = formatText(makeManyViolations(60), 50);
    expect(out).toContain('and 10 more');
    expect(out).toContain('--json');
  });

  it('shows all violations when limit=0 (unlimited)', () => {
    const out = formatText(makeManyViolations(60), 0);
    expect(out).not.toContain('and 60 more');
    expect(out).not.toContain('more.');
  });

  it('uses default limit of 50 when limit arg is omitted', () => {
    const out = formatText(makeManyViolations(60));
    expect(out).toContain('and 10 more');
  });
});

describe('formatJson', () => {
  it('emits valid JSON', () => {
    expect(() => JSON.parse(formatJson(cleanResult))).not.toThrow();
  });

  it('injects schemaVersion: 1 (not on CheckResult type)', () => {
    const parsed = JSON.parse(formatJson(cleanResult));
    expect(parsed.schemaVersion).toBe(1);
  });

  it('includes all violations regardless of count (no truncation)', () => {
    const parsed = JSON.parse(formatJson(makeManyViolations(100)));
    expect(parsed.violations).toHaveLength(100);
  });

  it('includes warnings array', () => {
    const parsed = JSON.parse(formatJson(violatingResult));
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toContain('ghost-rule');
  });

  it('includes rulesChecked, filesChecked, durationMs', () => {
    const parsed = JSON.parse(formatJson(cleanResult));
    expect(parsed.rulesChecked).toBe(3);
    expect(parsed.filesChecked).toBe(42);
    expect(typeof parsed.durationMs).toBe('number');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/RulesReporter.test.ts
```

Expected: all tests FAIL with `Cannot find module '../src/rules/reporter.js'`.

- [ ] **Step 3: Implement `src/rules/reporter.ts`**

```typescript
import type { CheckResult } from './types.js';

export function formatText(result: CheckResult, limit = 50): string {
  const lines: string[] = [];

  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      lines.push(`  ⚠  ${w}`);
    }
    lines.push('');
  }

  const toShow = limit === 0 ? result.violations : result.violations.slice(0, limit);
  const hidden = result.violations.length - toShow.length;

  for (const v of toShow) {
    const tag = v.severity === 'warn' ? 'WARN ' : 'ERROR';
    lines.push(`  [${tag}] ${v.message}`);
  }

  if (hidden > 0) {
    lines.push(`\n  ... and ${hidden} more. Run with --json for full output.`);
  }

  if (result.violations.length === 0) {
    lines.push(
      `✓ ${result.rulesChecked} rules checked, 0 violations. (${result.filesChecked} files, ${result.durationMs}ms)`,
    );
  } else {
    lines.push(
      `\n${result.violations.length} violation(s) found. (${result.filesChecked} files, ${result.rulesChecked} rules, ${result.durationMs}ms)`,
    );
  }

  return lines.join('\n');
}

export function formatJson(result: CheckResult): string {
  return JSON.stringify({ schemaVersion: 1, ...result }, null, 2);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/RulesReporter.test.ts
```

Expected: all 13 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rules/reporter.ts tests/RulesReporter.test.ts
git commit -m "feat(rules): implement text and JSON reporters"
```

---

## Task 6: Create barrel export

**Files:**
- Create: `src/rules/index.ts`

- [ ] **Step 1: Create `src/rules/index.ts`**

```typescript
export type { Rule, RulesConfig, Violation, CheckResult } from './types.js';
export { RulesConfigError } from './types.js';
export { loadRulesConfig } from './loadConfig.js';
export { RulesChecker } from './RulesChecker.js';
export { formatText, formatJson } from './reporter.js';
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run all rules unit tests together**

```bash
npx vitest run tests/RulesLoadConfig.test.ts tests/RulesChecker.test.ts tests/RulesReporter.test.ts
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/rules/index.ts
git commit -m "feat(rules): add barrel export for rules module"
```

---

## Task 7: Create test fixtures

**Files:**
- Create: all files under `test/fixtures/rules/`

- [ ] **Step 1: Create clean-repo fixture**

```bash
mkdir -p test/fixtures/rules/clean-repo/.ctxloom
mkdir -p test/fixtures/rules/clean-repo/src/domain
mkdir -p test/fixtures/rules/clean-repo/src/infra
```

Create `test/fixtures/rules/clean-repo/.ctxloom/rules.yml`:
```yaml
version: 1
rules:
  - name: "domain must not import infra"
    type: no-import
    from: "src/domain/**"
    to: "src/infra/**"
    severity: error
```

Create `test/fixtures/rules/clean-repo/src/domain/user.ts`:
```typescript
// No infra imports — this file is clean
export const User = { name: 'Alice' };
```

Create `test/fixtures/rules/clean-repo/src/infra/db.ts`:
```typescript
export const db = { connect: () => {} };
```

- [ ] **Step 2: Create violating-repo fixture**

```bash
mkdir -p test/fixtures/rules/violating-repo/.ctxloom
mkdir -p test/fixtures/rules/violating-repo/src/domain
mkdir -p test/fixtures/rules/violating-repo/src/infra
```

Create `test/fixtures/rules/violating-repo/.ctxloom/rules.yml`:
```yaml
version: 1
rules:
  - name: "domain must not import infra"
    type: no-import
    from: "src/domain/**"
    to: "src/infra/**"
    severity: error
```

Create `test/fixtures/rules/violating-repo/src/domain/user.ts`:
```typescript
import { db } from '../infra/db.js';
export const User = { db };
```

Create `test/fixtures/rules/violating-repo/src/domain/order.ts`:
```typescript
import { cache } from '../infra/cache.js';
export const Order = { cache };
```

Create `test/fixtures/rules/violating-repo/src/infra/db.ts`:
```typescript
export const db = { connect: () => {} };
```

Create `test/fixtures/rules/violating-repo/src/infra/cache.ts`:
```typescript
export const cache = { get: (_k: string) => null };
```

- [ ] **Step 3: Create no-config fixture**

```bash
mkdir -p test/fixtures/rules/no-config/src/domain
```

Create `test/fixtures/rules/no-config/src/domain/user.ts`:
```typescript
export const User = { name: 'Alice' };
```

- [ ] **Step 4: Create bad-config fixture**

```bash
mkdir -p test/fixtures/rules/bad-config/.ctxloom
```

Create `test/fixtures/rules/bad-config/.ctxloom/rules.yml`:
```yaml
version: 1
rules: [unclosed bracket
```

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/rules/
git commit -m "test(rules): add fixture repos for CLI integration tests"
```

---

## Task 8: Implement the `rules check` CLI command

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add the `rules` case to `src/index.ts`**

Find the line (around line 118) that begins the `switch (command)` block. Add the `rules` case before the `default` case:

```typescript
case 'rules': {
  const subCommand = process.argv[3];
  if (subCommand !== 'check') {
    process.stderr.write('[ctxloom] Usage: ctxloom rules check [--json] [--use-snapshot] [--limit=N]\n');
    process.exit(2);
  }

  const root = process.cwd();
  const useSnapshot = hasFlag('--use-snapshot');
  const jsonMode = hasFlag('--json');
  const rawLimit = getFlagValue('--limit=');
  const limit = rawLimit !== undefined ? parseInt(rawLimit, 10) : 50;

  const { loadRulesConfig, RulesChecker, formatText, formatJson, RulesConfigError } = await import('./rules/index.js');

  let config;
  try {
    config = await loadRulesConfig(root);
  } catch (err) {
    if (err instanceof RulesConfigError) {
      process.stderr.write(`[ctxloom] Config error: ${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }

  if (config === null) {
    process.stderr.write(
      '[ctxloom] No .ctxloom/rules.yml found. Create one to define architecture rules.\n' +
      '  See: docs/rules-engine.md\n',
    );
    process.exit(0);
  }

  if (config.rules.length === 0) {
    console.log('[ctxloom] 0 rules configured. 0 violations.');
    process.exit(0);
  }

  let graph;
  if (useSnapshot) {
    const { DependencyGraph } = await import('./graph/DependencyGraph.js');
    graph = new DependencyGraph();
    try {
      // Access internal buildFromDirectory to attempt snapshot-only load
      await graph.buildFromDirectory(root);
    } catch {
      process.stderr.write('[ctxloom] --use-snapshot: no graph snapshot found. Run `ctxloom index` first.\n');
      process.exit(2);
    }
  } else {
    console.log('[ctxloom] Building dependency graph...');
    const { ASTParser } = await import('./ast/ASTParser.js');
    const { DependencyGraph } = await import('./graph/DependencyGraph.js');
    let parser;
    try {
      parser = new ASTParser();
      await parser.init();
      graph = new DependencyGraph();
      graph.setParser(parser);
      await graph.buildFromDirectory(root);
    } catch (err) {
      process.stderr.write(`[ctxloom] Failed to build dependency graph: ${String(err)}\n`);
      process.exit(2);
    }
  }

  const result = new RulesChecker(graph, config).check();

  if (jsonMode) {
    console.log(formatJson(result));
  } else {
    console.log(formatText(result, limit));
  }

  const hasErrorViolation = result.violations.some(v => v.severity === 'error');
  process.exit(hasErrorViolation ? 1 : 0);
}
```

Also add `rules check` to the `--help` output in the existing help case. Find the line:
```
  ctxloom review-suggest [files]   Suggest reviewers from ownership index
```
And add after it:
```
  ctxloom rules check              Check architecture rules (.ctxloom/rules.yml)
  ctxloom rules check --json       Output violations as JSON
  ctxloom rules check --use-snapshot  Fast mode: use existing graph snapshot
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Smoke-test against clean fixture**

```bash
cd test/fixtures/rules/clean-repo && npx tsx ../../../../src/index.ts rules check --use-snapshot; echo "Exit: $?"
```

Expected output contains `0 violations`, exit code `0`.

Note: Since no snapshot exists in the fixture, it will build fresh (the snapshot load falls through gracefully in `buildFromDirectory`). This is correct behaviour — `--use-snapshot` attempts snapshot load and falls back to a fresh build on the first run.

- [ ] **Step 4: Smoke-test against violating fixture**

```bash
cd test/fixtures/rules/violating-repo && npx tsx ../../../../src/index.ts rules check; echo "Exit: $?"
```

Expected: 2 violations listed, exit code `1`.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat(rules): add 'rules check' CLI command"
```

---

## Task 9: Implement the `ctx_rules_check` MCP tool

**Files:**
- Create: `src/tools/rules-check.ts`
- Modify: `src/tools/index.ts`

- [ ] **Step 1: Create `src/tools/rules-check.ts`**

```typescript
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { loadRulesConfig, RulesChecker, RulesConfigError } from '../rules/index.js';

export function registerRulesCheckTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_rules_check',
    {
      name: 'ctx_rules_check',
      description:
        'Check architecture rules defined in .ctxloom/rules.yml against the live dependency graph. ' +
        'Returns violations (forbidden imports) and dead-rule warnings. ' +
        'Only checks direct imports — transitive chains are not flagged.',
      inputSchema: { type: 'object', properties: {} },
    },
    async () => {
      let config;
      try {
        config = await loadRulesConfig(ctx.projectRoot);
      } catch (err) {
        if (err instanceof RulesConfigError) {
          return JSON.stringify({
            schemaVersion: 1,
            violations: [],
            warnings: [`Config error: ${err.message}`],
            rulesChecked: 0,
            filesChecked: 0,
            durationMs: 0,
          });
        }
        throw err;
      }

      if (config === null) {
        return JSON.stringify({
          schemaVersion: 1,
          violations: [],
          warnings: ['No .ctxloom/rules.yml found. Create one to define architecture rules.'],
          rulesChecked: 0,
          filesChecked: 0,
          durationMs: 0,
        });
      }

      const graph = await ctx.getGraph();
      const result = new RulesChecker(graph, config).check();
      return JSON.stringify({ schemaVersion: 1, ...result }, null, 2);
    },
  );
}
```

- [ ] **Step 2: Register the tool in `src/tools/index.ts`**

Add the import at the top of the imports block:
```typescript
import { registerRulesCheckTool } from './rules-check.js';
```

Add the registration call inside `createToolRegistry`, after `registerRulesTool(registry, ctx);`:
```typescript
registerRulesCheckTool(registry, ctx);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/tools/rules-check.ts src/tools/index.ts
git commit -m "feat(rules): add ctx_rules_check MCP tool"
```

---

## Task 10: Write CLI and MCP integration tests

**Files:**
- Create: `tests/RulesCLI.test.ts`
- Create: `tests/RulesMCP.test.ts`

- [ ] **Step 1: Create `tests/RulesCLI.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const indexTs = path.join(repoRoot, 'src', 'index.ts');
const fixturesDir = path.join(repoRoot, 'test', 'fixtures', 'rules');

async function runCheck(
  fixture: string,
  args: string[] = [],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execAsync(
      'node',
      ['--import', 'tsx/esm', indexTs, 'rules', 'check', ...args],
      { cwd: path.join(fixturesDir, fixture), env: { ...process.env, FORCE_COLOR: '0' } },
    );
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout: string; stderr: string; code: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode: e.code ?? 1 };
  }
}

describe('ctxloom rules check — CLI integration', () => {
  it('exits 0 with 0 violations on a clean repo', async () => {
    const { exitCode, stdout } = await runCheck('clean-repo');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('0 violations');
  }, 30_000);

  it('exits 1 with violations on a violating repo', async () => {
    const { exitCode, stdout } = await runCheck('violating-repo');
    expect(exitCode).toBe(1);
    expect(stdout).toContain('[ERROR]');
    expect(stdout).toContain('domain must not import infra');
  }, 30_000);

  it('exits 0 and emits hint to stderr when no config file exists', async () => {
    const { exitCode, stdout, stderr } = await runCheck('no-config');
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('');
    expect(stderr).toContain('.ctxloom/rules.yml');
  }, 30_000);

  it('exits 2 on malformed YAML config', async () => {
    const { exitCode, stderr } = await runCheck('bad-config');
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Config error');
  }, 30_000);

  it('emits valid JSON to stdout with --json flag, stderr is empty', async () => {
    const { exitCode, stdout, stderr } = await runCheck('violating-repo', ['--json']);
    expect(exitCode).toBe(1);
    expect(() => JSON.parse(stdout)).not.toThrow();
    const parsed = JSON.parse(stdout);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.violations.length).toBeGreaterThan(0);
    expect(stderr.trim()).toBe('');
  }, 30_000);

  it('--json emits full violation list regardless of count', async () => {
    const { stdout } = await runCheck('violating-repo', ['--json']);
    const parsed = JSON.parse(stdout);
    expect(parsed.violations).toHaveLength(2);
  }, 30_000);
});
```

- [ ] **Step 2: Create `tests/RulesMCP.test.ts`**

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerRulesCheckTool } from '../src/tools/rules-check.js';
import type { ServerContext } from '../src/tools/context.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function makeCtx(fixtureName: string, graph: DependencyGraph): ServerContext {
  const projectRoot = path.join(repoRoot, 'test', 'fixtures', 'rules', fixtureName);
  return {
    projectRoot,
    dbPath: '',
    getStore: () => { throw new Error('not used'); },
    getGraph: async () => graph,
    getParser: () => { throw new Error('not used'); },
    getSkeletonizer: () => { throw new Error('not used'); },
    getRuleManager: () => { throw new Error('not used'); },
    getPathValidator: () => { throw new Error('not used'); },
    isStoreInitialized: () => false,
    isGraphInitialized: () => true,
    isParserInitialized: () => false,
  };
}

describe('ctx_rules_check — MCP integration', () => {
  it('returns 0 violations for a clean graph', async () => {
    const graph = new DependencyGraph();
    graph.addEdge('src/domain/user.ts', 'src/domain/order.ts');

    const registry = new ToolRegistry();
    registerRulesCheckTool(registry, makeCtx('clean-repo', graph));

    const raw = await registry.dispatch('ctx_rules_check', {});
    const result = JSON.parse(raw);

    expect(result.schemaVersion).toBe(1);
    expect(result.violations).toHaveLength(0);
  });

  it('detects violations from the live graph', async () => {
    const graph = new DependencyGraph();
    graph.addEdge('src/domain/user.ts', 'src/infra/db.ts');
    graph.addEdge('src/domain/order.ts', 'src/infra/cache.ts');

    const registry = new ToolRegistry();
    registerRulesCheckTool(registry, makeCtx('violating-repo', graph));

    const raw = await registry.dispatch('ctx_rules_check', {});
    const result = JSON.parse(raw);

    expect(result.violations).toHaveLength(2);
    expect(result.violations[0].rule).toBe('domain must not import infra');
  });

  it('returns warning (not error) when no config file exists', async () => {
    const graph = new DependencyGraph();
    const registry = new ToolRegistry();
    registerRulesCheckTool(registry, makeCtx('no-config', graph));

    const raw = await registry.dispatch('ctx_rules_check', {});
    const result = JSON.parse(raw);

    expect(result.violations).toHaveLength(0);
    expect(result.warnings.some((w: string) => w.includes('rules.yml'))).toBe(true);
  });

  it('reflects a newly-added edge without restart', async () => {
    const graph = new DependencyGraph();
    const registry = new ToolRegistry();
    registerRulesCheckTool(registry, makeCtx('violating-repo', graph));

    const before = JSON.parse(await registry.dispatch('ctx_rules_check', {}));
    expect(before.violations).toHaveLength(0);

    // Simulate FileWatcher adding a new edge to the live graph
    graph.addEdge('src/domain/user.ts', 'src/infra/db.ts');

    const after = JSON.parse(await registry.dispatch('ctx_rules_check', {}));
    expect(after.violations).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run all integration tests**

```bash
npx vitest run tests/RulesCLI.test.ts tests/RulesMCP.test.ts
```

Expected: all tests PASS. CLI tests take ~5-10s each (graph build time).

- [ ] **Step 5: Commit**

```bash
git add tests/RulesCLI.test.ts tests/RulesMCP.test.ts
git commit -m "test(rules): add CLI and MCP integration tests"
```

---

## Task 11: Write user-facing docs

**Files:**
- Create: `docs/rules-engine.md`

- [ ] **Step 1: Create `docs/rules-engine.md`**

```markdown
# Architecture Rules Engine

Define forbidden import rules in `.ctxloom/rules.yml` and enforce them in CI or via your AI coding assistant.

## Quick Start

Create `.ctxloom/rules.yml` in your project root:

\`\`\`yaml
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
\`\`\`

Then run:

\`\`\`bash
ctxloom rules check
\`\`\`

## CLI Reference

\`\`\`
ctxloom rules check                   Check all rules (fresh graph build)
ctxloom rules check --json            Output violations as JSON
ctxloom rules check --use-snapshot    Fast mode: reuse last indexed graph
ctxloom rules check --limit=N         Show only first N violations in text mode (default: 50)
ctxloom rules check --limit=0         Show all violations (no truncation)
\`\`\`

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Clean — no violations, or only `warn` severity |
| 1 | Rule violations found (at least one `error` severity) |
| 2 | Configuration error or build failure |

## Rule Config Reference

\`\`\`yaml
version: 1   # required, must be 1

rules:
  - name: "human-readable rule name"  # required; appears in violation messages
    type: no-import                    # required; only supported type in v1
    from: "glob/**"                    # required; files that must not import...
    to: "glob/**"                      # required; ...these files
    severity: error                    # optional; "error" (default) or "warn"
\`\`\`

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

\`\`\`yaml
- name: Check architecture rules
  run: ctxloom rules check
\`\`\`

For JSON output (consumed by ctxloom-prbot or custom scripts):

\`\`\`yaml
- name: Check architecture rules (JSON)
  run: ctxloom rules check --json > violations.json
\`\`\`

## MCP Tool: `ctx_rules_check`

When ctxloom is running as an MCP server, AI assistants can query architecture rules directly:

> "Are there any architecture rule violations in this file?"

The tool reads `.ctxloom/rules.yml` and checks the live dependency graph (maintained by FileWatcher). Results reflect the current state of the code without requiring a rebuild.

## Known Limitations (v1)

- **Direct imports only.** `A → B → C` does not flag `A` for importing `C` transitively. Only direct edges are checked.
- **Supported languages.** The dependency graph covers TypeScript, JavaScript, Python, Go, Rust, Java, C#, Ruby, Kotlin, Swift, PHP, Dart, and Jupyter notebooks. Other file types have no edges and cannot be matched.
- **One pattern per rule.** `from` and `to` each take a single glob string. Write multiple rules for multiple source/target sets.
```

- [ ] **Step 2: Commit**

```bash
git add docs/rules-engine.md
git commit -m "docs(rules): add user-facing rules engine guide"
```

---

## Task 12: Run full test suite and verify coverage

- [ ] **Step 1: Run all tests**

```bash
npx vitest run
```

Expected: all tests pass, including new rules tests.

- [ ] **Step 2: Check coverage on `src/rules/**`**

```bash
npx vitest run --coverage 2>&1 | grep -A5 'src/rules'
```

Expected: lines ≥ 80%, branches ≥ 60%, functions ≥ 70% for `src/rules/**`.

- [ ] **Step 3: Verify `--help` output includes rules command**

```bash
npx tsx src/index.ts --help | grep rules
```

Expected output:
```
  ctxloom rules check              Check architecture rules (.ctxloom/rules.yml)
```

- [ ] **Step 4: Final commit if any fixups were needed**

```bash
git add -A
git commit -m "chore(rules): fixups from full test suite run"
```

---

## Self-Review Notes

- `RulesConfigError` is exported from `src/rules/types.ts` (not a separate file) — importers get it from `src/rules/index.ts`
- `ctx.projectRoot` is used throughout (not `ctx.getRoot()` — that method does not exist)
- `ctx.getGraph()` is `async` — always `await` it
- Tests live in `tests/` (not `src/**/__tests__/`) — matches vitest config `include: ['tests/**/*.test.ts']`
- `--use-snapshot` in CLI does not disable `buildFromDirectory`; it relies on the snapshot-load path inside `buildFromDirectory` — on first run it builds fresh, on subsequent runs it loads the snapshot
- `formatJson` injects `schemaVersion: 1` at serialization time — it is NOT a field on the `CheckResult` type
- `ToolRegistry.getHandler` is used in MCP tests — verify the method name against `src/tools/registry.ts` in Task 10 Step 3
