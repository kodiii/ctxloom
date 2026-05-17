/**
 * Drift-detection test for the README's "Supported tools + default
 * budgets" table.
 *
 * Closes TEST-128-1 from the PR #128 dogfood
 * (https://github.com/kodiii/ctxloom/pull/128#issuecomment-4470738535).
 *
 * The Response Budgets section in README.md hand-maintains a table of
 * 12 per-tool default budgets that mirror the DEFAULT_MAX_RESPONSE_TOKENS
 * constants in packages/core/src/tools/*.ts. Today they match. A future
 * tuning PR (the planned "re-derive from real p75 telemetry" follow-up)
 * could silently bump a constant without updating the doc, leaving the
 * README stale with no CI signal.
 *
 * This test parses both sides and asserts they agree:
 *   - README: regex over the "Supported tools + default budgets" table
 *   - Source: regex over each tool file's `DEFAULT_MAX_RESPONSE_TOKENS = N;`
 *
 * Failure modes the test guards against:
 *   - README default changes without source change → loud failure
 *   - Source constant changes without README update → loud failure
 *   - Tool added to README table but no source constant → loud failure
 *   - Tool added to source but missing from README table → loud failure
 *
 * Self-enforcing consistency: any future B2.x tuning work must update
 * BOTH places, or this test goes red.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const README_PATH = path.join(REPO_ROOT, 'README.md');
const TOOLS_DIR = path.join(REPO_ROOT, 'packages', 'core', 'src', 'tools');

/**
 * Map from `ctx_*` tool name (as it appears in the README's first
 * column) to its source file under `packages/core/src/tools/`.
 * Hand-maintained, but only changes when a new source-returning tool
 * is added — at which point the table-row test below catches the gap
 * and forces the author to update both this map AND the README table.
 */
const TOOL_TO_SOURCE_FILE: Record<string, string> = {
  ctx_get_file: 'file.ts',
  ctx_get_context_packet: 'context-packet.ts',
  ctx_get_definition: 'definition.ts',
  ctx_git_diff_review: 'git-diff-review.ts',
  ctx_search: 'search.ts',
  ctx_full_text_search: 'full-text-search.ts',
  ctx_wiki_generate: 'wiki-generate.ts',
  ctx_find_large_functions: 'find-large-functions.ts',
  ctx_apply_refactor: 'apply-refactor.ts',
  ctx_refactor_preview: 'refactor-preview.ts',
  ctx_cross_repo_search: 'cross-repo-search.ts',
  ctx_execution_flow: 'execution-flow.ts',
};

interface TableRow {
  tool: string;
  defaultBudget: number;
}

/**
 * Parse the "Supported tools + default budgets" table from README.md.
 * Returns the (tool, default) pairs in declaration order.
 *
 * The table format is:
 *   | `ctx_get_file` | 8000 | <fallback description> |
 *
 * Resilient to whitespace, fallback-column content, and the header /
 * separator rows. Lines that don't match the `| \`ctx_\` | <int> |`
 * shape are silently skipped.
 *
 * @public Exported for direct unit testing of the parser logic.
 */
export function parseBudgetTable(markdown: string): TableRow[] {
  // The table lives between the "## Supported tools + default budgets"
  // heading (or its `### Supported tools` subheading) and the next blank
  // line that isn't followed by another `|` row. Easiest robust path:
  // match the row shape directly, anchored on the backticked tool name.
  const rowRe = /^\|\s*`(ctx_[a-z_]+)`\s*\|\s*(\d+)\s*\|/gm;
  const rows: TableRow[] = [];
  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(markdown)) !== null) {
    rows.push({ tool: match[1], defaultBudget: parseInt(match[2], 10) });
  }
  return rows;
}

/**
 * Read a tool's source file and extract its DEFAULT_MAX_RESPONSE_TOKENS
 * value. Returns null if the constant isn't declared (e.g. a tool that
 * predates the budget surface).
 *
 * @public Exported for direct unit testing.
 */
export function readSourceDefault(toolFileName: string): number | null {
  const src = fs.readFileSync(path.join(TOOLS_DIR, toolFileName), 'utf8');
  // Match: `const DEFAULT_MAX_RESPONSE_TOKENS = 8000;` allowing
  // arbitrary whitespace + optional `export` prefix.
  const m = src.match(/(?:export\s+)?const\s+DEFAULT_MAX_RESPONSE_TOKENS\s*=\s*(\d+)\s*;/);
  return m ? parseInt(m[1], 10) : null;
}

describe('README "Supported tools + default budgets" table drift detection', () => {
  const readme = fs.readFileSync(README_PATH, 'utf8');
  const tableRows = parseBudgetTable(readme);

  it('parses 12 rows from the README table (one per source-returning tool)', () => {
    // Pinned exactly: if a new tool is added, the count must change
    // intentionally (and TOOL_TO_SOURCE_FILE must be extended too).
    expect(tableRows.length).toBe(12);
  });

  it('every README row has a known source file mapping', () => {
    // Catches the case where a tool name in the README has no entry
    // in TOOL_TO_SOURCE_FILE — most likely a typo or a new tool that
    // wasn't added to the test map.
    for (const row of tableRows) {
      expect(
        TOOL_TO_SOURCE_FILE[row.tool],
        `README references tool '${row.tool}' but no source file mapping exists in TOOL_TO_SOURCE_FILE — add it to tests/ReadmeBudgetDefaults.test.ts`,
      ).toBeDefined();
    }
  });

  it.each(Object.entries(TOOL_TO_SOURCE_FILE))(
    '%s — README default matches DEFAULT_MAX_RESPONSE_TOKENS in source',
    (tool, sourceFile) => {
      const readmeRow = tableRows.find((r) => r.tool === tool);
      expect(
        readmeRow,
        `Tool '${tool}' has a source file (${sourceFile}) but is missing from the README "Supported tools + default budgets" table — add a row.`,
      ).toBeDefined();

      const sourceDefault = readSourceDefault(sourceFile);
      expect(
        sourceDefault,
        `Source file packages/core/src/tools/${sourceFile} is missing a DEFAULT_MAX_RESPONSE_TOKENS constant`,
      ).not.toBeNull();

      expect(
        readmeRow!.defaultBudget,
        `Drift detected: README says ${tool} default is ${readmeRow!.defaultBudget} but ${sourceFile} declares ${sourceDefault}. Update the README table (or the source constant) so they agree.`,
      ).toBe(sourceDefault);
    },
  );
});

// ─── Self-tests for the parser helpers ──────────────────────────────

describe('parseBudgetTable (parser self-test)', () => {
  it('extracts (tool, default) pairs from a minimal table fragment', () => {
    const md = [
      '| Tool | Default | Skeleton fallback |',
      '|---|---:|---|',
      '| `ctx_get_file` | 8000 | Skeletonizer view |',
      '| `ctx_search` | 4000 | Drop snippets |',
    ].join('\n');
    expect(parseBudgetTable(md)).toEqual([
      { tool: 'ctx_get_file', defaultBudget: 8000 },
      { tool: 'ctx_search', defaultBudget: 4000 },
    ]);
  });

  it('ignores rows that do not match the `| `ctx_*` | <int> |` shape', () => {
    const md = [
      '| Tool | Default | Skeleton fallback |',
      '|---|---:|---|',                          // separator row — must not match
      '| `ctx_get_file` | 8000 | ... |',         // real row
      '| not_a_tool | 99 | ... |',               // no backticks → must not match
      '| `ctx_search` | abc | ... |',            // non-numeric → must not match
    ].join('\n');
    expect(parseBudgetTable(md)).toEqual([
      { tool: 'ctx_get_file', defaultBudget: 8000 },
    ]);
  });

  it('returns empty array when no rows are present', () => {
    expect(parseBudgetTable('plain text with no table')).toEqual([]);
  });
});

describe('readSourceDefault (helper self-test)', () => {
  it('reads the constant from a real tool file (sanity check)', () => {
    // file.ts has DEFAULT_MAX_RESPONSE_TOKENS = 8000 per the #106
    // provisional table.
    expect(readSourceDefault('file.ts')).toBe(8000);
  });
});
