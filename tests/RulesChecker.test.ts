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
