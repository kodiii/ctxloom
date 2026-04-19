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
  warnings: ['rule "ghost-rule" matched 0 files on from/to — check glob'],
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
