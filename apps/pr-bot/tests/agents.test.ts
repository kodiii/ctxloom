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
 *    because it only walked the agents directory.
 *
 *  - ARCH-003 / TEST-004 (PR #104 + #108 dogfood): shared blocks
 *    across the four specialist specs could drift independently
 *    (silently or coordinated-but-broken). Now caught by the
 *    SHARED_BLOCKS table with byte-equality + per-invariant checks.
 *
 *  - TEST-109-1 (PR #109 dogfood): semantic invariants previously
 *    pinned one specific sentence ("flavor text") rather than the
 *    load-bearing policy tokens. Now each block declares an ARRAY of
 *    invariants targeting the actual policy content.
 *
 *  - SEC-109-1 / TEST-109-2 (PR #109 dogfood): the marker-substring
 *    extractor used unanchored `indexOf`, so a future bullet quoting
 *    the marker in prose could shift extraction silently. Now uses an
 *    anchored regex (`/^❌ Calling .../m`).
 *
 *  - ARCH-109-1 (PR #109 dogfood): adding a new shared block
 *    previously required a bespoke extractor function. The
 *    `SharedBlock` interface is now data-only (declarative `source`),
 *    dispatched through a single generic `extractFromSpec`.
 *
 *  - ARCH-109-2 (PR #109 dogfood): orchestrator exclusion was
 *    string-coupled to the filename. Now derived from frontmatter
 *    shape (specialists have `tools:`, orchestrator doesn't) and
 *    self-heals if the orchestrator file is renamed.
 *
 *  - TEST-109-3 (PR #109 dogfood): helper unit tests appeared LAST,
 *    so a helper regression cascaded as confusing integration-test
 *    failures. Helper describes now run BEFORE integration tests so
 *    root cause surfaces first.
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

/**
 * Minimum acceptable body length (in chars) for a required spec section.
 * Set well above any plausible bullshit-pass length (a one-line directive)
 * but well below any real section's actual body. Today's shortest required
 * section ("Pre-fetched context") is ~280 chars, so the floor has 5x
 * headroom. Hoisted to a named constant so future bumps are obvious.
 */
const MIN_SECTION_BODY_CHARS = 50;

/** Parse the canonical MCP tool list from packages/core source. */
function loadCanonicalTools(): Set<string> {
  // .sort() for deterministic iteration order across filesystems
  // (ext4 returns insertion order, APFS returns sorted — closes
  // TEST-110-6 from PR #110 dogfood).
  const files = readdirSync(CORE_TOOLS_DIR).filter((f) => f.endsWith('.ts')).sort();
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

/**
 * Declarative source descriptor for a shared spec block. Two kinds:
 *
 *   { kind: 'section', header }
 *     Extract everything between the header and the next `## ` heading.
 *
 *   { kind: 'section-from', header, startMarker }
 *     Extract from the first occurrence of an ANCHORED `startMarker`
 *     regex (must be `^...` /m) within the section body. Anchoring on
 *     bullet-line start prevents prose-quoted marker text from
 *     shifting the extraction (per SEC-109-1 / TEST-109-2).
 *
 * REGEX HYGIENE (SEC-110-2 reminder): both `header` and `startMarker`
 * should be ANCHORED (start with `^.../m`) and free of catastrophic
 * backtracking patterns (no nested quantifiers like `(a+)+`, no
 * unbounded `.*` followed by required characters that may be absent).
 * The current literals are linear and bounded; future entries should
 * stay that way to keep the test suite ReDoS-safe even as
 * `SHARED_BLOCKS` grows.
 */
type SharedBlockSource =
  | { kind: 'section'; header: RegExp }
  | { kind: 'section-from'; header: RegExp; startMarker: RegExp };

/**
 * Generic extractor — consumes a `SharedBlockSource` descriptor.
 * Replaces the bespoke per-block extractor functions used in PR #108
 * (closes ARCH-109-1).
 *
 * The `switch` + `default: never` arm guarantees compile-time
 * exhaustiveness (closes converged-medium finding from PR #110
 * dogfood): adding a third union member to `SharedBlockSource`
 * without handling it here is now a TypeScript error, not a silent
 * runtime fall-through to `undefined.match`.
 */
function extractFromSpec(src: string, source: SharedBlockSource): string {
  const sectionBody = extractSectionBody(src, source.header);
  if (!sectionBody) return '';
  switch (source.kind) {
    case 'section':
      return sectionBody;
    case 'section-from': {
      const m = sectionBody.match(source.startMarker);
      if (!m || m.index === undefined) return '';
      return sectionBody.slice(m.index).trim();
    }
    default: {
      const _exhaustive: never = source;
      throw new Error(`Unhandled SharedBlockSource kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

const CANONICAL = loadCanonicalTools();

// ────────────────────────────────────────────────────────────────────
// Helper unit tests run FIRST (per TEST-109-3): a regression in the
// helpers below should surface as a focused helper failure, not as a
// misleading cascade of integration-test failures downstream.
// ────────────────────────────────────────────────────────────────────

describe('helper: stripFencedCodeBlocks', () => {
  it('removes a single fenced code block', () => {
    const src = 'before\n```\ncode\n```\nafter';
    expect(stripFencedCodeBlocks(src)).toBe('before\n\nafter');
  });

  it('removes multiple fenced code blocks', () => {
    const src = 'a\n```\nx\n```\nb\n```ts\ny\n```\nc';
    expect(stripFencedCodeBlocks(src)).toBe('a\n\nb\n\nc');
  });

  it('leaves an unclosed fence as-is (consumes to EOF — no infinite loop)', () => {
    const src = 'before\n```\nunclosed';
    // Non-greedy regex with no closing fence does NOT match — passes through.
    expect(stripFencedCodeBlocks(src)).toBe(src);
  });

  it('does not strip inline backticks', () => {
    const src = 'use `foo` and `bar`';
    expect(stripFencedCodeBlocks(src)).toBe(src);
  });

  it('handles empty input', () => {
    expect(stripFencedCodeBlocks('')).toBe('');
  });
});

describe('helper: extractSectionBody', () => {
  it('extracts body between header and next section', () => {
    const src = '## A\nbody A\nmore A\n## B\nbody B';
    expect(extractSectionBody(src, /^## A/m)).toBe('body A\nmore A');
  });

  it('extracts to EOF when section is the last one', () => {
    const src = '## A\nbody A\n## B\nbody B\nlast line';
    expect(extractSectionBody(src, /^## B/m)).toBe('body B\nlast line');
  });

  it('returns empty string when section header is immediately followed by next header (zero body)', () => {
    const src = '## A\n## B\nbody B';
    expect(extractSectionBody(src, /^## A/m)).toBe('');
  });

  it('returns empty string when header is missing', () => {
    const src = '## A\nbody A';
    expect(extractSectionBody(src, /^## NotPresent/m)).toBe('');
  });

  it('strips fenced code blocks before extraction (so a `## X` inside a fence is not treated as a section)', () => {
    const src = '## A\nbody\n```\n## NotARealHeader\n```\nmore body\n## B\nbody B';
    expect(extractSectionBody(src, /^## A/m)).toBe('body\n\nmore body');
  });

  it('handles header at the very end of file with no body', () => {
    const src = '## A\nbody\n## B';
    expect(extractSectionBody(src, /^## B/m)).toBe('');
  });
});

describe('helper: extractFromSpec', () => {
  describe("source kind: 'section'", () => {
    it('returns the full body between header and next section', () => {
      const src = '## A\nbody line 1\nbody line 2\n## B\nother';
      const out = extractFromSpec(src, { kind: 'section', header: /^## A/m });
      expect(out).toBe('body line 1\nbody line 2');
    });

    it('returns empty string when the section is missing', () => {
      const src = '## B\nbody';
      const out = extractFromSpec(src, { kind: 'section', header: /^## NotPresent/m });
      expect(out).toBe('');
    });
  });

  describe("source kind: 'section-from'", () => {
    const source = {
      kind: 'section-from' as const,
      header: /^## Anti-patterns/m,
      startMarker: /^❌ Calling `gh pr diff`/m,
    };

    it('returns substring starting at anchored startMarker', () => {
      const src = `## Anti-patterns

❌ Specialist-specific bullet here.
❌ Calling \`gh pr diff\`, etc.
❌ Trailing bullet 2.

## Final checks
`;
      const out = extractFromSpec(src, source);
      expect(out).toMatch(/^❌ Calling `gh pr diff`/);
      expect(out).toMatch(/Trailing bullet 2/);
      expect(out).not.toMatch(/Specialist-specific bullet/);
    });

    it('IGNORES marker text appearing in prose before the real bullet (TEST-109-2 regression guard)', () => {
      // Realistic adversarial fixture: a specialist-specific bullet
      // legitimately quotes the shared marker in prose. Old indexOf-
      // based extractor would start at the prose mention and slice
      // the wrong region; anchored regex requires bullet-line start.
      const src = `## Anti-patterns

❌ Re-flagging warnings about \`❌ Calling \`gh pr diff\`\` issues.
❌ Specialist-specific bullet 2.
❌ Calling \`gh pr diff\`, etc.
❌ Trailing bullet 2.

## Final checks
`;
      const out = extractFromSpec(src, source);
      // Must start at the REAL bullet, not the prose mention
      const lines = out.split('\n');
      expect(lines[0]).toBe('❌ Calling `gh pr diff`, etc.');
      expect(out).not.toMatch(/Re-flagging warnings/);
      expect(out).not.toMatch(/Specialist-specific bullet 2/);
    });

    it('returns empty string when startMarker is missing', () => {
      const src = '## Anti-patterns\n\n❌ Some other bullet.\n\n## Final checks';
      expect(extractFromSpec(src, source)).toBe('');
    });

    it('returns empty string when the section itself is missing', () => {
      const src = '## Other section\nbody';
      expect(extractFromSpec(src, source)).toBe('');
    });
  });
});

// ────────────────────────────────────────────────────────────────────
// Integration tests (canonical surface, agent specs, AI-REVIEWS.md,
// shared-block drift) — start after helper unit tests.
// ────────────────────────────────────────────────────────────────────

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

// .sort() ensures vitest emits per-spec test results in a stable
// order regardless of filesystem (closes TEST-110-6 from PR #110
// dogfood — ext4 returns insertion order, APFS returns sorted, which
// produced flaky-looking diffs in CI logs across runners).
const agentFiles = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md')).sort();

/**
 * Specialist spec files, derived from the auto-discovered agent set
 * via FRONTMATTER `name:` rather than filename equality (closes
 * ARCH-109-2).
 *
 * The orchestrator's `name:` is `review-orchestrator`; every
 * specialist's `name:` ends in `-reviewer`. Both have `tools:`
 * frontmatter (so we can't discriminate on that alone). Filtering on
 * the role-identifier embedded in the spec is self-healing if the
 * orchestrator file is ever renamed — the prior
 * `f !== 'review-orchestrator.md'` filter would silently include it
 * as a specialist and produce confusing "drifted" failure messages
 * instead of "misconfigured".
 *
 * IMPORTANT (closes converged-high finding from PR #110 dogfood):
 * `parseFrontmatter` is allowed to throw here. A spec with malformed
 * frontmatter MUST fail the suite loudly — not silently disappear
 * from `SPECIALIST_FILES`, which would shrink the drift cohort to
 * 3 specs and quietly degrade coverage. The downstream
 * `agent spec: %s > has valid YAML frontmatter` test surfaces the
 * actual cause cleanly when this throws.
 */
const SPECIALIST_FILES = agentFiles.filter((f) => {
  const { fm } = parseFrontmatter(readFileSync(join(AGENTS_DIR, f), 'utf8'));
  return fm.name !== 'review-orchestrator';
});

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
  const isSpecialist = SPECIALIST_FILES.includes(file);

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

  if (isSpecialist) {
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
        expect(
          body.length,
          `${file}: section ${pattern} has too-short body (${body.length} chars, floor ${MIN_SECTION_BODY_CHARS}): "${body.slice(0, 80)}…"`,
        ).toBeGreaterThan(MIN_SECTION_BODY_CHARS);
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
 * Shared blocks across the four specialist specs.
 *
 * Each entry declares:
 *   - `name`: human-readable label
 *   - `source`: declarative descriptor (closes ARCH-109-1 — no
 *     bespoke per-block extractor functions)
 *   - `semanticInvariants`: ARRAY of regexes targeting the LOAD-BEARING
 *     policy tokens (closes TEST-109-1 — replaces single-sentence
 *     "flavor text" pinning)
 *
 * Two checks run per block per spec:
 *   1. Byte-equality across all four specialists (catches drift —
 *      one spec edited and the others not, per ARCH-003 in PR #104)
 *   2. Each invariant regex matches the extracted body in EVERY spec
 *      independently (catches "equal-but-broken" coordinated
 *      regression where all four specs converge on a value that
 *      satisfies neither the policy nor the invariant, per TEST-004
 *      in PR #108 + TEST-109-1 in PR #109)
 *
 * The tier ladders and per-question playbooks legitimately differ
 * by specialist domain, so they're NOT in this set.
 */
interface SharedBlock {
  /** Human-readable label for failure messages. */
  name: string;
  /** Declarative source descriptor — see SharedBlockSource above. */
  source: SharedBlockSource;
  /**
   * All regexes must match the extracted body. Each pins one
   * load-bearing policy token (a tool name, a directive verb, a
   * structural marker), NOT a specific sentence.
   */
  semanticInvariants: RegExp[];
}

const SHARED_BLOCKS: SharedBlock[] = [
  {
    name: 'Pre-fetched context body',
    source: {
      kind: 'section',
      header: /^## Pre-fetched context \(do not re-fetch\)/m,
    },
    // The policy: orchestrator pre-fetches PR meta + diff +
    // ctx_detect_changes + ctx_risk_overlay; specialists must NOT
    // re-fetch any of them. Each invariant pins one load-bearing
    // token; no flavor-text pinning (closes TEST-109-1).
    semanticInvariants: [
      /Do NOT call/i,
      /ctx_detect_changes/,
      /ctx_risk_overlay/,
      /`<pr_context>`/,
    ],
  },
  {
    name: 'Anti-patterns shared trailing bullets',
    source: {
      kind: 'section-from',
      header: /^## Anti-patterns/m,
      // Anchored on bullet-line start — prose-quoted marker text
      // earlier in the section cannot shift the extraction (closes
      // SEC-109-1 / TEST-109-2).
      startMarker: /^❌ Calling `gh pr diff`/m,
    },
    // Three trailing bullets, each with its own load-bearing policy
    // token. The Anti-patterns section actually has FOUR bullets in
    // total, but the first one ("❌ Calling `Read` or `ctx_get_file`
    // (Tier 3)...") is intentionally specialist-specific (security &
    // testing & performance say "before trying T0/T1/T2 — every
    // evidence item must declare its `tier`", architecture says "for
    // an architectural question — almost always wrong tier for this
    // specialist"). The `startMarker` above excludes that first
    // bullet from extraction; only the three SHARED bullets are
    // pinned here. Closes TEST-110-2 from PR #110 dogfood
    // (the previous comment said "four trailing bullets" while
    // listing three invariants — confusing future maintainers).
    semanticInvariants: [
      /❌ Calling `gh pr diff`/,
      /❌ Using `Bash\(grep\|rg\|find\)`/,
      /❌ Calling `ctx_get_definition` 3\+ times/,
    ],
  },
];

describe('shared block drift detection', () => {
  describe.each(SHARED_BLOCKS)('$name', (block) => {
    const bodies = SPECIALIST_FILES.map((f) => {
      const src = readFileSync(join(AGENTS_DIR, f), 'utf8');
      return { file: f, body: extractFromSpec(src, block.source) };
    });

    it('is byte-identical across all 4 specialist specs', () => {
      const reference = bodies[0];
      expect(
        reference.body.length,
        `${reference.file}: ${block.name} is empty — extractor returned ''`,
      ).toBeGreaterThan(0);
      for (let i = 1; i < bodies.length; i++) {
        expect(
          bodies[i].body,
          `${block.name} in ${bodies[i].file} has drifted from ${reference.file}. Re-sync verbatim.`,
        ).toBe(reference.body);
      }
    });

    // One sub-test per (spec × invariant) combination so failure
    // messages name BOTH which spec and which load-bearing token is
    // missing. Beats a single combined check that bails on first
    // failure.
    describe('semantic invariants (no equal-but-broken regression)', () => {
      for (const { file, body } of bodies) {
        it.each(block.semanticInvariants)(`${file} matches %s`, (invariant) => {
          expect(
            body,
            `${block.name} in ${file} is missing required policy content matching ${invariant}. ` +
              `Even if all 4 specs agree, the agreed wording must still satisfy this invariant.`,
          ).toMatch(invariant);
        });
      }
    });
  });
});
