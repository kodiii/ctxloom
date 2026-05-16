/**
 * Unit tests for the regex parsers in
 * `apps/pr-bot/scripts/extract-budget-telemetry.ts`.
 *
 * Closes the following findings from PR #114's dogfood review
 * (https://github.com/kodiii/ctxloom/pull/114#issuecomment-4466549414):
 *
 *   TEST-114-1 (high) — 7 regex parsers shipped with zero unit tests.
 *   TEST-114-3 (high) — 3 implementation-time bugs have zero
 *                       regression tests. The three are explicitly
 *                       pinned below as `regression:` test cases.
 *
 * Each parser is a pure function: string in → structured data out.
 * Table-driven fixtures cover happy paths and the historical bug
 * inputs that originally tripped each parser.
 */
import { describe, it, expect } from 'vitest';

import {
  parseTokenCell,
  extractSpecialistTokensFromTable,
  extractTotalFromTable,
  extractSpecialistTokensFromProse,
  extractVerdictAndSeverity,
  extractTierDistribution,
  extractMachineBlock,
} from '../scripts/extract-budget-telemetry.js';

describe('parseTokenCell', () => {
  it.each([
    ['63k', 63000],
    ['~218k', 218000],
    ['**43k**', 43000],
    ['  *51k* ', 51000],
    ['1.5k', 1500],
    ['12.3K', 12300],
    ['42', 42],
  ])('parses "%s" as %d', (input, expected) => {
    expect(parseTokenCell(input)).toBe(expected);
  });

  it.each([['', null], ['n/a', null], ['TBD', null], ['Δ', null], ['−27%', null]])(
    'returns null for non-token cell "%s"',
    (input, expected) => {
      expect(parseTokenCell(input)).toBe(expected);
    },
  );
});

describe('extractSpecialistTokensFromTable', () => {
  it('extracts all four specialists from a clean recent-format table', () => {
    const body = `
| | PR #110 | PR #111 | **PR #113** |
|---|---|---|---|
| 🔒 security | 51k | 43k | **49k** |
| 🏛 architecture | 55k | 47k | **48k** |
| 🧪 testing | 56k | 43k | **47k** |
| ⚡ performance | 40k | 42k | **41k** |
`;
    expect(extractSpecialistTokensFromTable(body)).toEqual({
      security: 49000,
      architecture: 48000,
      testing: 47000,
      performance: 41000,
    });
  });

  it('regression: tables with a trailing "Δ vs ..." percentage column (PR #108 dogfood bug)', () => {
    // The original implementation took cells[length-1], which on
    // PR #108-era tables was the "−27%" delta cell instead of the
    // per-PR token cell. The fix scans right-to-left for the first
    // cell that parses as a token. This test pins that behavior.
    const body = `
| | PR #102 | PR #104 | **PR #108** | Δ vs PR #104 |
|---|---|---|---|---|
| 🔒 security | 63k | 67k | **49k** | −27% |
| 🏛 architecture | 54k | 92k | **66k** | −28% |
| 🧪 testing | 56k | 48k | **50k** | +4% |
| ⚡ performance | 45k | 60k | **49k** | −18% |
`;
    expect(extractSpecialistTokensFromTable(body)).toEqual({
      security: 49000,
      architecture: 66000,
      testing: 50000,
      performance: 49000,
    });
  });

  it('returns nulls for specialists missing from the table', () => {
    const body = `
| 🔒 security | 50k |
`;
    expect(extractSpecialistTokensFromTable(body)).toEqual({
      security: 50000,
      architecture: null,
      testing: null,
      performance: null,
    });
  });

  it('returns all-nulls for a body with no recognized rows', () => {
    expect(extractSpecialistTokensFromTable('no table here')).toEqual({
      security: null,
      architecture: null,
      testing: null,
      performance: null,
    });
  });
});

describe('extractTotalFromTable', () => {
  it('extracts the **Total** row when per-specialist rows are absent', () => {
    const body = `
| | PR #110 | PR #111 | **PR #113** |
|---|---|---|---|
| **Total** | ~202k | ~175k | **~178k** |
`;
    expect(extractTotalFromTable(body)).toBe(178000);
  });

  it('extracts the **Specialists total** variant (PR #108-style)', () => {
    const body = `
| **Specialists total** | **~218k** | **~267k** | **~214k** | **−20%** |
`;
    expect(extractTotalFromTable(body)).toBe(214000);
  });

  it('returns null when no Total row exists', () => {
    expect(extractTotalFromTable('no table here')).toBeNull();
  });
});

describe('extractSpecialistTokensFromProse', () => {
  it('extracts inline-prose token mentions in early reviews', () => {
    const body = `
- security: 63k
- architecture: 54k
- testing: 56k
- performance: 45k
`;
    expect(extractSpecialistTokensFromProse(body)).toEqual({
      security: 63000,
      architecture: 54000,
      testing: 56000,
      performance: 45000,
    });
  });

  it('handles emoji prefix variants', () => {
    const body = `
🔒 security: 67k
🏛 architecture: 92k
`;
    const result = extractSpecialistTokensFromProse(body);
    expect(result.security).toBe(67000);
    expect(result.architecture).toBe(92000);
  });
});

describe('extractVerdictAndSeverity', () => {
  it('parses approve with severity counts', () => {
    const body = `**Verdict: 🟡 Approve with nits — 1 medium, 4 low, 6 info**`;
    const result = extractVerdictAndSeverity(body);
    expect(result.verdict).toBe('approve_with_nits');
    expect(result.severity_counts).toEqual({ critical: 0, high: 0, medium: 1, low: 4, info: 6 });
  });

  it('parses needs_changes with full severity profile', () => {
    const body = `**Verdict: 🔴 Needs changes — 1 critical / 3 high / 7 medium / 7 low**`;
    const result = extractVerdictAndSeverity(body);
    expect(result.verdict).toBe('needs_changes');
    expect(result.severity_counts).toEqual({ critical: 1, high: 3, medium: 7, low: 7, info: 0 });
  });

  it('regression: "no blockers" is a POSITIVE signal, not negative (PR #114 dogfood bug)', () => {
    // The original implementation checked for substring "block" in
    // the verdict line, which incorrectly matched "no blockers" and
    // classified the review as needs_changes. The fix uses \b word
    // boundaries plus an explicit "no blocker" override. This test
    // pins that the positive phrasing maps to approve.
    const body = `**Verdict: 🟢 Approve — no blockers**`;
    expect(extractVerdictAndSeverity(body).verdict).toBe('approve');
  });

  it('returns unknown when no verdict line is present', () => {
    const body = 'just some prose, no verdict here';
    const result = extractVerdictAndSeverity(body);
    expect(result.verdict).toBe('unknown');
    expect(result.severity_counts).toEqual({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });
  });

  it('parses "Approve with one architectural concern" as approve_with_nits', () => {
    const body = `**Verdict: 🟡 Approve with one architectural concern — 1 medium, 3 low, 7 info**`;
    expect(extractVerdictAndSeverity(body).verdict).toBe('approve_with_nits');
  });
});

describe('extractTierDistribution', () => {
  it('extracts T0-T3 call counts from bullet list', () => {
    const body = `
- T0 structural: 5 calls
- T1 skeleton: 0 calls
- T2 definition: 0 calls
- T3 full file: 1 call
- **Full-file reads:** 1
`;
    const result = extractTierDistribution(body);
    expect(result.dist).toEqual({ T0: 5, T1: 0, T2: 0, T3: 1 });
    expect(result.full_file_reads).toBe(1);
  });

  it('returns null distribution when no tier bullets exist', () => {
    const result = extractTierDistribution('no tiers here');
    expect(result.dist).toBeNull();
    expect(result.full_file_reads).toBeNull();
  });
});

describe('extractMachineBlock', () => {
  it('parses a well-formed JSON block', () => {
    const body = `body prefix
<!-- ctxloom-telemetry: {"pr":104,"verdict":"approve_with_nits"} -->
body suffix`;
    expect(extractMachineBlock(body)).toEqual({ pr: 104, verdict: 'approve_with_nits' });
  });

  it('returns null when no telemetry block is present', () => {
    expect(extractMachineBlock('no telemetry block')).toBeNull();
  });

  it('returns null when the block is malformed JSON', () => {
    const body = `<!-- ctxloom-telemetry: {not json} -->`;
    expect(extractMachineBlock(body)).toBeNull();
  });

  it('regression: takes the LAST block, not the first (ARCH-114-2 from PR #114 dogfood)', () => {
    // The original implementation used `body.match(...)` which
    // returns the FIRST match. If the orchestrator re-runs and emits
    // a second block, the stale first block would win. The fix uses
    // matchAll().at(-1) to take the most recent block.
    const body = `prefix
<!-- ctxloom-telemetry: {"pr":102,"verdict":"approve","total_specialist_tokens":99999} -->
some content between blocks
<!-- ctxloom-telemetry: {"pr":102,"verdict":"approve","total_specialist_tokens":200000} -->
suffix`;
    expect(extractMachineBlock(body)).toEqual({
      pr: 102,
      verdict: 'approve',
      total_specialist_tokens: 200000,
    });
  });
});
