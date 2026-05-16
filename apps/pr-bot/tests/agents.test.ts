/**
 * Agent-spec validation tests.
 *
 * These tests guard the example `.claude/agents/*.md` files that ship to
 * end users. They caught (and prevent regressions of) ARCH-001 from the
 * PR #101 dogfood review: agent specs were referencing
 * `mcp__ctxloom__ctx_find_callers`, a tool that does not exist in
 * ctxloom's MCP surface. The actual tool is `mcp__ctxloom__ctx_get_call_graph`
 * with `direction: "callers"`.
 *
 * Checks per agent file:
 *  1. Has valid YAML frontmatter
 *  2. Frontmatter `tools:` list references only real ctxloom MCP tools
 *  3. Body mentions of `mcp__ctxloom__ctx_*` resolve to real tools
 *  4. Body mentions of bare `ctx_*` tool names resolve to real tools
 *
 * Source of truth: parsed from `packages/core/src/tools/*.ts`. If the MCP
 * tool surface changes, this test fails loudly so we update agent specs
 * in lockstep.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const AGENTS_DIR = join(__dirname, '..', 'examples', '.claude', 'agents');
const CORE_TOOLS_DIR = join(REPO_ROOT, 'packages', 'core', 'src', 'tools');

/** Parse the canonical MCP tool list from packages/core source. */
function loadCanonicalTools(): Set<string> {
  const files = readdirSync(CORE_TOOLS_DIR).filter((f) => f.endsWith('.ts'));
  const names = new Set<string>();
  const re = /name:\s*['"](ctx_[a-z_]+)['"]/g;
  for (const f of files) {
    const src = readFileSync(join(CORE_TOOLS_DIR, f), 'utf8');
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) names.add(m[1]);
  }
  return names;
}

/** Trivial frontmatter extractor: --- ... --- at top of file. */
function parseFrontmatter(src: string): { fm: Record<string, string>; body: string } {
  const m = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('missing frontmatter');
  const fm: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (mm) fm[mm[1]] = mm[2];
  }
  return { fm, body: m[2] };
}

const CANONICAL = loadCanonicalTools();

describe('canonical MCP tool surface', () => {
  // Floor instead of exact match: legitimate tool additions should not
  // fail this test in an unrelated package. The real bug-catching signal
  // lives in the must-have / must-not-have canaries below.
  it('parses at least 30 ctx_* tools from packages/core', () => {
    expect(CANONICAL.size).toBeGreaterThanOrEqual(30);
  });

  it('includes ctx_get_call_graph (not ctx_find_callers)', () => {
    expect(CANONICAL.has('ctx_get_call_graph')).toBe(true);
    expect(CANONICAL.has('ctx_find_callers')).toBe(false);
  });

  // Known-good canaries: if the regex ever breaks (e.g. core switches to
  // template literals or imports tool names from a constants module),
  // these fail loudly instead of silently shrinking the canonical set.
  it.each([
    'ctx_status',
    'ctx_detect_changes',
    'ctx_get_call_graph',
    'ctx_get_context_packet',
    'ctx_blast_radius',
    'ctx_risk_overlay',
  ])('canary: %s is present', (name) => {
    expect(CANONICAL.has(name)).toBe(true);
  });
});

const agentFiles = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md'));

/**
 * Sections every specialist spec (NOT the orchestrator) must contain.
 * These exist to enforce the skeleton-first token-discipline policy
 * added in PR #104 — see `docs/skeleton-first.md` once it ships. If
 * any of these are missing, the agent will skip the ladder and revert
 * to expensive full-file reads.
 */
const REQUIRED_SPECIALIST_SECTIONS = [
  /^## Token discipline — tool tier ladder/m,
  /^## Pre-fetched context \(do not re-fetch\)/m,
  /^## Per-question playbook/m,
];

/**
 * The orchestrator spec has its own discipline requirements: it must
 * tell us how it pre-fetches PR context once, and it must include the
 * tier-aware calibration rule.
 */
const REQUIRED_ORCHESTRATOR_PATTERNS = [
  /Token discipline is a first-class concern/,
  /<pr_context>/,
  /Tier discipline:/,
];


describe.each(agentFiles)('agent spec: %s', (file) => {
  const src = readFileSync(join(AGENTS_DIR, file), 'utf8');

  it('has valid YAML frontmatter with name + description', () => {
    const { fm } = parseFrontmatter(src);
    expect(fm.name).toBeTruthy();
    expect(fm.description).toBeTruthy();
  });

  it('frontmatter tools: list references only real ctxloom MCP tools', () => {
    const { fm } = parseFrontmatter(src);
    if (!fm.tools) return; // orchestrator has no tools: list
    const referenced = fm.tools
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.startsWith('mcp__ctxloom__'))
      .map((s) => s.replace(/^mcp__ctxloom__/, ''));
    for (const tool of referenced) {
      expect(CANONICAL.has(tool), `${file}: unknown tool "${tool}" in frontmatter`).toBe(true);
    }
  });

  it('body references only real ctxloom MCP tools (mcp__ctxloom__* form)', () => {
    const { body } = parseFrontmatter(src);
    const matches = body.matchAll(/mcp__ctxloom__(ctx_[a-z_]+)/g);
    for (const m of matches) {
      expect(CANONICAL.has(m[1]), `${file}: unknown tool "${m[1]}" in body`).toBe(true);
    }
  });

  if (file !== 'review-orchestrator.md') {
    it.each(REQUIRED_SPECIALIST_SECTIONS)(
      'specialist spec contains required section: %s',
      (pattern) => {
        expect(src, `${file}: missing required section matching ${pattern}`).toMatch(pattern);
      },
    );
  } else {
    it.each(REQUIRED_ORCHESTRATOR_PATTERNS)(
      'orchestrator spec contains required directive: %s',
      (pattern) => {
        expect(src, `${file}: missing required directive matching ${pattern}`).toMatch(pattern);
      },
    );
  }

  it('body references only real ctxloom MCP tools (bare ctx_* form)', () => {
    const { body } = parseFrontmatter(src);
    // Strip code blocks first to avoid matching e.g. JSON keys that intentionally
    // reference removed/renamed tools in comments. We still want to catch
    // prose like "use `ctx_foo`".
    const stripped = body.replace(/```[\s\S]*?```/g, '');
    const matches = stripped.matchAll(/`(ctx_[a-z_]+)`/g);
    for (const m of matches) {
      // Skip the literal token "ctx_find_callers" appearing only inside this
      // explanatory test — if it appears anywhere in an agent spec, fail.
      expect(CANONICAL.has(m[1]), `${file}: unknown tool "${m[1]}" in prose`).toBe(true);
    }
  });
});
