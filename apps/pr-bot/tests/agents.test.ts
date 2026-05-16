/**
 * Agent-spec validation tests.
 *
 * These tests guard the example `.claude/agents/*.md` files (plus the
 * user-facing AI-REVIEWS.md docs) that ship to end users. They caught
 * and prevent regressions of:
 *
 *  - ARCH-001 (PR #101 dogfood): agent specs referenced
 *    `ctx_find_callers`, a tool that does not exist in ctxloom's MCP
 *    surface. The actual tool is `ctx_get_call_graph` with
 *    `direction: "callers"`.
 *
 *  - ARCH-001 (PR #104 dogfood): same drift bug, but in the marketing
 *    copy at `AI-REVIEWS.md:245`. The agent-spec scanner missed it
 *    because it only walked the agents directory. Fixed here.
 *
 * Checks per agent file:
 *  1. Has valid YAML frontmatter
 *  2. Frontmatter `tools:` list references only real ctxloom MCP tools
 *  3. Body mentions of `mcp__ctxloom__ctx_*` resolve to real tools
 *  4. Body mentions of bare `ctx_*` tool names resolve to real tools
 *  5. Required tier-discipline sections present AND non-empty
 *  6. Required sections survive when code-block content is stripped
 *
 * Additional checks:
 *  - AI-REVIEWS.md references only real ctxloom MCP tools
 *  - Shared "Pre-fetched context" block is byte-identical across all
 *    four specialist specs (drift-detection per ARCH-003 in PR #104)
 *
 * Source of truth for the tool list: parsed from
 * `packages/core/src/tools/*.ts`. If the MCP tool surface changes,
 * this test fails loudly so we update agent specs in lockstep.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const AGENTS_DIR = join(__dirname, '..', 'examples', '.claude', 'agents');
const CORE_TOOLS_DIR = join(REPO_ROOT, 'packages', 'core', 'src', 'tools');
const AI_REVIEWS_DOC = join(__dirname, '..', 'AI-REVIEWS.md');

const SPECIALIST_FILES = [
  'security-reviewer.md',
  'architecture-reviewer.md',
  'testing-reviewer.md',
  'performance-reviewer.md',
];

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

/**
 * Strip fenced code blocks so a literal `## Foo` heading inside an
 * example code fence doesn't satisfy a section-presence assertion.
 * Per TEST-002 (PR #104 dogfood): the bare-ctx_* check already does
 * this; the section-presence check did not, creating a false-positive
 * vector. This unifies the two paths.
 */
function stripFencedCodeBlocks(src: string): string {
  return src.replace(/```[\s\S]*?```/g, '');
}

/**
 * Extract the body content between a section header and the next `##`
 * heading (or EOF). Used to assert that required sections are not just
 * present but non-empty — per TEST-001 (PR #104 dogfood).
 */
function extractSectionBody(src: string, headerPattern: RegExp): string {
  const stripped = stripFencedCodeBlocks(src);
  const headerMatch = stripped.match(headerPattern);
  if (!headerMatch || headerMatch.index === undefined) return '';
  const afterHeader = stripped.slice(headerMatch.index + headerMatch[0].length);
  const nextSectionIdx = afterHeader.search(/^## /m);
  const body = nextSectionIdx === -1 ? afterHeader : afterHeader.slice(0, nextSectionIdx);
  // Skip the trailing newline of the header line itself.
  return body.replace(/^\n/, '').trim();
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
 * Sections every specialist spec (NOT the orchestrator) must contain
 * AND must have a non-empty body. These exist to enforce the
 * skeleton-first token-discipline policy added in PR #104 — see
 * `docs/skeleton-first.md` once it ships.
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
      'specialist spec contains required section header (outside code fences): %s',
      (pattern) => {
        const stripped = stripFencedCodeBlocks(src);
        expect(stripped, `${file}: missing required section matching ${pattern}`).toMatch(pattern);
      },
    );

    it.each(REQUIRED_SPECIALIST_SECTIONS)(
      'specialist spec section has non-empty body: %s',
      (pattern) => {
        const body = extractSectionBody(src, pattern);
        // A meaningful section body is more than a single line of prose
        // (we set the threshold low to avoid bikeshedding length, but
        // 50 chars rules out blank-section regressions).
        expect(
          body.length,
          `${file}: section ${pattern} has too-short body (${body.length} chars): "${body.slice(0, 80)}…"`,
        ).toBeGreaterThan(50);
      },
    );
  } else {
    it.each(REQUIRED_ORCHESTRATOR_PATTERNS)(
      'orchestrator spec contains required directive: %s',
      (pattern) => {
        const stripped = stripFencedCodeBlocks(src);
        expect(stripped, `${file}: missing required directive matching ${pattern}`).toMatch(pattern);
      },
    );
  }

  it('body references only real ctxloom MCP tools (bare ctx_* form)', () => {
    const { body } = parseFrontmatter(src);
    // Strip code blocks first to avoid matching e.g. JSON keys that intentionally
    // reference removed/renamed tools in comments. We still want to catch
    // prose like "use `ctx_foo`".
    const stripped = stripFencedCodeBlocks(body);
    const matches = stripped.matchAll(/`(ctx_[a-z_]+)`/g);
    for (const m of matches) {
      expect(CANONICAL.has(m[1]), `${file}: unknown tool "${m[1]}" in prose`).toBe(true);
    }
  });
});

/**
 * ARCH-001 (PR #104 dogfood): the public AI-REVIEWS.md is the
 * marketing surface and must reference only real MCP tools. Walking
 * agent specs alone missed a stale `ctx_find_callers` reference here.
 */
describe('user-facing docs: AI-REVIEWS.md', () => {
  const src = readFileSync(AI_REVIEWS_DOC, 'utf8');

  it('references only real ctxloom MCP tools (bare ctx_* form)', () => {
    const stripped = stripFencedCodeBlocks(src);
    const matches = stripped.matchAll(/`(ctx_[a-z_]+)`/g);
    for (const m of matches) {
      expect(CANONICAL.has(m[1]), `AI-REVIEWS.md: unknown tool "${m[1]}" in prose`).toBe(true);
    }
  });

  it('references only real ctxloom MCP tools (mcp__ctxloom__* form)', () => {
    const matches = src.matchAll(/mcp__ctxloom__(ctx_[a-z_]+)/g);
    for (const m of matches) {
      expect(CANONICAL.has(m[1]), `AI-REVIEWS.md: unknown tool "${m[1]}"`).toBe(true);
    }
  });
});

/**
 * ARCH-003 (PR #104 dogfood): the "Pre-fetched context (do not
 * re-fetch)" block is copy-pasted across all four specialist specs.
 * Future edits must touch four files; drift is a matter of when, not
 * if. This test detects drift the moment one spec diverges.
 *
 * The tier ladders and per-question playbooks legitimately differ by
 * specialist domain, so we don't byte-equality-check those. The
 * "Pre-fetched context" block is the only one that should be
 * literally identical.
 */
describe('shared block drift detection', () => {
  it('Pre-fetched context body is byte-identical across all 4 specialist specs', () => {
    const headerPattern = /^## Pre-fetched context \(do not re-fetch\)/m;
    const bodies = SPECIALIST_FILES.map((f) => {
      const src = readFileSync(join(AGENTS_DIR, f), 'utf8');
      return { file: f, body: extractSectionBody(src, headerPattern) };
    });

    const reference = bodies[0];
    for (let i = 1; i < bodies.length; i++) {
      expect(
        bodies[i].body,
        `Pre-fetched context block in ${bodies[i].file} has drifted from ${reference.file}. Re-sync verbatim.`,
      ).toBe(reference.body);
    }
  });
});
