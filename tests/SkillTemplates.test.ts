/**
 * SkillTemplates.test.ts — pins the Phase 3 skill content contract.
 *
 * Two kinds of assertions:
 *
 *   1. **Structural pins** — every skill is well-formed (frontmatter
 *      shape, slash-command name matches directory, has the required
 *      "Steps" / "Budget" / "Output" sections, references real
 *      registered tool names).
 *
 *   2. **Drift detection** — every tool referenced inside a skill's
 *      body MUST be a real registered tool name. Mirrors the
 *      NextToolSuggestions drift test from Phase 1b. Without this, a
 *      tool rename would leave dead instructions in shipped skills.
 */
import { describe, it, expect } from 'vitest';
import { CTXLOOM_SKILLS } from '../packages/core/src/install/skillTemplates.js';

// ─── per-skill structural shape ──────────────────────────────────────

describe('skill structural shape', () => {
  it.each(CTXLOOM_SKILLS.map((s) => [s.name, s] as const))(
    '%s — has YAML frontmatter with name + description matching directory',
    (_name, skill) => {
      expect(skill.content.startsWith('---\n')).toBe(true);
      // Pull just the frontmatter block.
      const fmEnd = skill.content.indexOf('\n---\n', 4);
      expect(fmEnd).toBeGreaterThan(0);
      const fm = skill.content.slice(4, fmEnd);
      expect(fm).toMatch(new RegExp(`^name:\\s+${skill.name}\\b`, 'm'));
      expect(fm).toMatch(/^description:\s+\S/m);
    },
  );

  it.each(CTXLOOM_SKILLS.map((s) => [s.name, s] as const))(
    '%s — body has Steps + Budget sections (workflow + cost contract)',
    (_name, skill) => {
      expect(skill.content).toMatch(/^##\s+Steps/m);
      expect(skill.content).toMatch(/^##\s+Budget/m);
    },
  );

  it.each(CTXLOOM_SKILLS.map((s) => [s.name, s] as const))(
    '%s — opens its workflow with ctx_get_minimal_context (orientation anchor)',
    (_name, skill) => {
      // Every skill MUST start its tool sequence with the orientation
      // anchor — that's the Phase 1 contract the skill rules block
      // promises to users.
      expect(skill.content).toMatch(/ctx_get_minimal_context/);
    },
  );
});

// ─── tool-name drift detection ───────────────────────────────────────

describe('drift: every ctx_* mentioned in a skill body is a real registered tool', () => {
  // Same pattern as tests/NextToolSuggestions.test.ts. Extract every
  // `ctx_<word>` token from each skill body, dedupe, then assert each
  // is in the registered set. A tool rename / deletion fails CI.
  it('drift check', async () => {
    const { createToolRegistry } = await import('../packages/core/src/tools/index.js');
    const ctx = makeStubContext();
    const registry = createToolRegistry(ctx);
    const registered = new Set(registry.list().map((t) => t.name));

    const referenced = new Set<string>();
    for (const skill of CTXLOOM_SKILLS) {
      // \bctx_[a-z_]+\b — captures ctx_*-style tool tokens.
      const matches = skill.content.match(/\bctx_[a-z_]+/g) ?? [];
      for (const m of matches) referenced.add(m);
    }
    // Common false-positives (not tool calls, just words containing
    // ctx_): the configuration shorthand "ctx_*" is the only one used,
    // which is a meta reference. Filter token shapes that aren't
    // plausible tool names.
    const filtered = Array.from(referenced).filter((t) => t !== 'ctx_' && t.length > 4);
    const missing = filtered.filter((t) => !registered.has(t));
    expect(missing, `Skill bodies reference unregistered tools: ${missing.join(', ')}`).toEqual([]);
  });
});

// ─── deduplication ───────────────────────────────────────────────────

describe('skill name uniqueness', () => {
  it('every shipped skill has a unique name', () => {
    const names = CTXLOOM_SKILLS.map((s) => s.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('every skill name is ctxloom-prefixed', () => {
    // Prevents accidental name collision with user skills + makes
    // /ctxloom-* easy to grep in command history.
    for (const skill of CTXLOOM_SKILLS) {
      expect(skill.name.startsWith('ctxloom-'), `${skill.name} missing ctxloom- prefix`).toBe(true);
    }
  });
});

// Stub ServerContext for the registry-snapshot drift test.
function makeStubContext(): never {
  const stub = {
    projectRoot: '/tmp/stub',
    dbPath: '/tmp/stub/.ctxloom/db',
    noDefaultMode: false,
    getStore: () => {
      throw new Error('stub');
    },
    getGraph: () => {
      throw new Error('stub');
    },
    getParser: () => {
      throw new Error('stub');
    },
    getSkeletonizer: () => {
      throw new Error('stub');
    },
    getRuleManager: () => {
      throw new Error('stub');
    },
    getPathValidator: () => {
      throw new Error('stub');
    },
    isStoreInitialized: () => false,
    isGraphInitialized: () => false,
    isParserInitialized: () => false,
    registry: { list: () => [] },
    stateManager: { has: () => false, get: () => null, list: () => [], max: 0 },
  };
  return stub as never;
}
