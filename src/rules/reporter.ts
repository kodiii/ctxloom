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
    const tag = v.severity === 'warn' ? 'WARN' : 'ERROR';
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
