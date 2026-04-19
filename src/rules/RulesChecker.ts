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

      const fromFiles = allFiles.filter(f => fromMatcher(f));
      const toFiles = new Set(allFiles.filter(f => toMatcher(f)));

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
