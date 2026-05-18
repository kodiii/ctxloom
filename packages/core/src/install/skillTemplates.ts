/**
 * skillTemplates.ts — canonical Claude Code skill content for Phase 3
 * of the agent-harness plan (docs/superpowers/plans/2026-05-18-agent-
 * harness.md). Each skill is a SKILL.md file written under
 * `.claude/skills/<name>/SKILL.md` during `ctxloom init`.
 *
 * Why prepackaged skills:
 *
 *   Code-review-graph's adoption model: the harness installs skills
 *   that orchestrate tool sequences for the agent, so the agent doesn't
 *   have to remember "for review tasks call X then Y then Z." User
 *   types `/ctxloom-review-pr 142` and the skill drives the workflow.
 *
 * Improvements over code-review-graph's skill set:
 *
 *   1. **Every skill starts with ctx_get_minimal_context** — the
 *      orientation anchor from Phase 1, so the skill inherits the
 *      task-aware suggested-first-tool routing
 *   2. **Skills budget themselves** — each prescribes a
 *      `max_response_tokens` ceiling per call so the tool sequence
 *      stays under the protocol target (≤8 calls, ≤2000 tokens)
 *   3. **Skills follow next_tool_suggestions** — agents are told to
 *      pick from meta.next_tool_suggestions rather than guess
 */

/**
 * Each skill = a directory under `.claude/skills/<name>/` with a
 * SKILL.md inside. The Claude Code slash command is `/<name>`.
 */
export interface SkillTemplate {
  /** Folder name under .claude/skills/. Also the slash-command name. */
  name: string;
  /** SKILL.md content, frontmatter + body. Canonical. */
  content: string;
}

// ─── /ctxloom-explore ────────────────────────────────────────────────

const EXPLORE_CONTENT = `---
name: ctxloom-explore
description: Orient yourself to an unfamiliar codebase using ctxloom's structural graph. Architecture overview + communities + top hubs in ≤5 tool calls.
---

# Explore Codebase

Use this when you need to understand a codebase you haven't worked in
before, or when re-orienting after time away.

## Steps

1. **Orientation anchor**: call \`ctx_get_minimal_context(task="explore this codebase")\`.
   The response includes graph stats, top hubs, and a
   \`suggested_first_tool\` — follow it (likely
   \`ctx_architecture_overview\`).

2. **Architecture overview**: call \`ctx_architecture_overview(max_response_tokens=2000)\`.
   Returns the community structure + hub nodes + cross-community bridges.

3. **Drill into the biggest communities**: from the overview's
   \`meta.next_tool_suggestions\`, call \`ctx_community_list\` for the
   top 1–2 communities. Skip communities labeled "tests" or
   "config" — they're usually peripheral.

4. **Investigate the architectural bridges**: call \`ctx_bridge_nodes\`.
   Bridge nodes are high-leverage — changing one affects multiple
   communities. Read these first to understand the codebase's
   coupling story.

5. **Tour the hubs**: call \`ctx_hub_nodes(limit=5, detail_level="minimal")\`.
   Top 5 most-depended-upon files. These are usually the heart of
   the codebase.

## Budget

- ≤5 ctxloom tool calls
- ≤2000 tokens total response budget
- Don't \`ctx_get_file\` anything during exploration — signatures are
  enough. Drop to file reads only if a specific symbol needs
  inspection (and only via \`ctx_get_definition\`, not raw read).

## Output

Summarize for the user:
- Main communities (3–5 named clusters)
- Top hubs by fan-in (the load-bearing files)
- Top bridges (the architectural seams)
- Recommended deep-dive starting points
`;

// ─── /ctxloom-blast ──────────────────────────────────────────────────

const BLAST_CONTENT = `---
name: ctxloom-blast
description: Compute blast radius + affected execution flows for a symbol or file before changing it. Pinpoints what will break.
argument-hint: "<symbol-name | file-path>"
---

# Blast Radius

Use this before any change to a public function, type, or file
where you're not sure who depends on it.

## Inputs

- \`$ARGUMENTS\` — the symbol name (e.g. \`emitTelemetry\`) or file
  path (e.g. \`src/server.ts\`) you're about to modify.

## Steps

1. **Orientation**: call \`ctx_get_minimal_context(task="blast radius for $ARGUMENTS")\`.

2. **Blast radius**: call \`ctx_blast_radius(target="$ARGUMENTS", max_response_tokens=1500)\`.
   Returns transitive dependents — every file (and indirectly,
   every flow) that would be affected by a breaking change.

3. **Caller graph**: call \`ctx_get_call_graph(symbol="$ARGUMENTS", direction="callers", depth=2)\`.
   Direct + grandparent callers. Pair with the blast radius
   to distinguish "many transitive deps" from "load-bearing
   direct API."

4. **Affected execution flows**: call \`ctx_get_affected_flows(target="$ARGUMENTS")\`.
   Maps the change to ordered execution sequences — useful for
   debugging "what user-facing path breaks?"

5. **Test coverage check**: call \`ctx_knowledge_gaps(scope="$ARGUMENTS")\`.
   Highlights affected files lacking test coverage — those are the
   real risk surface.

## Budget

- ≤5 ctxloom tool calls
- ≤2000 tokens total

## Output

Report to the user:
- Total transitive dependents (number + top 5 by depth)
- Direct callers (the API consumers)
- Affected execution flows (named user-facing paths)
- Coverage gaps on the affected files (the risk surface)
- Recommendation: "safe to change" / "review carefully" / "needs migration plan"
`;

// ─── /ctxloom-refactor-safely ────────────────────────────────────────

const REFACTOR_CONTENT = `---
name: ctxloom-refactor-safely
description: Plan and execute a rename or signature change with full caller-aware safety. Preview before applying.
argument-hint: "<old-name> <new-name>"
---

# Refactor Safely

Use this for renames, signature changes, or function moves. The
skill enforces preview-before-apply.

## Inputs

- \`$1\` — current symbol name (e.g. \`emitTelemetry\`)
- \`$2\` — target name (e.g. \`emitTelemetryEvent\`)

## Steps

1. **Orientation**: call \`ctx_get_minimal_context(task="refactor $1 to $2")\`.

2. **Surface every caller**: call \`ctx_get_call_graph(symbol="$1", direction="callers", depth=1)\`.
   The exhaustive caller list. Without this, a rename can break
   files you didn't notice depended on the symbol.

3. **Blast radius**: call \`ctx_blast_radius(target="$1")\`.
   Transitive impact — useful to gauge whether this should be a
   single PR or split with a deprecation period.

4. **Generate the refactor preview**: call \`ctx_refactor_preview(symbol="$1", new_name="$2")\`.
   Returns a diff preview WITHOUT writing anything. Inspect it.

5. **Confirm with the user**: show the preview summary
   (N files changed, M call sites updated). **DO NOT proceed to
   step 6 without explicit user confirmation.**

6. **Apply the refactor**: call \`ctx_apply_refactor(symbol="$1", new_name="$2")\`.
   This writes the changes to disk. Irreversible without a git
   reset.

7. **Verify**: call \`ctx_detect_changes\` and confirm the diff
   matches what the preview said. Surface any unexpected changes.

## Safety rails

- ALWAYS run step 4 (preview) before step 6 (apply)
- ALWAYS ask the user for confirmation between preview and apply
- If preview shows >50 files affected, recommend splitting into
  a deprecation-style migration instead of a single rename
- If the symbol is exported from a public API package, refuse to
  proceed and recommend the user open a tracked migration plan

## Budget

- ≤7 ctxloom tool calls
- ≤3000 tokens total (preview output can be larger than other skills)
`;

// ─── /ctxloom-coverage-gap ───────────────────────────────────────────

const COVERAGE_GAP_CONTENT = `---
name: ctxloom-coverage-gap
description: Identify code that lacks test coverage, prioritized by caller frequency and risk.
---

# Coverage Gap Analysis

Use this to find untested code that genuinely matters — the
intersection of "no tests" + "many callers" + "high risk score."

## Steps

1. **Orientation**: call \`ctx_get_minimal_context(task="check test coverage")\`.

2. **Knowledge gaps**: call \`ctx_knowledge_gaps(max_response_tokens=1200)\`.
   Lists every file lacking a \`tests_for\` graph edge. Raw list
   without prioritization.

3. **Score by impact**: for each gap, call
   \`ctx_get_call_graph(symbol=<gap_symbol>, direction="callers")\`
   to count callers. High caller-count + no tests = high priority.

4. **Cross-reference with churn**: call
   \`ctx_git_coupling(file=<gap_file>)\` for the top 5 gaps.
   Files churning often without tests are the urgent ones.

5. **Risk overlay**: call \`ctx_risk_overlay(scope=<top_gap_files>)\`.
   Combines churn + coupling into a single risk score.

## Output

Tabular report:

\`\`\`
| File / Symbol | Callers | Churn | Risk | Recommendation |
|---|---|---|---|---|
| ... | ... | ... | ... | ... |
\`\`\`

Recommendations should distinguish:
- "Add tests now" (high caller count + high churn)
- "Add tests during next change" (high caller count, low churn)
- "Acceptable gap" (low caller count, low churn)

## Budget

- ≤6 ctxloom tool calls
- ≤2500 tokens total
`;

// ─── /ctxloom-review-pr ──────────────────────────────────────────────

const REVIEW_PR_CONTENT = `---
name: ctxloom-review-pr
description: Multi-tier code review of a PR using ctxloom's structural graph. Risk-scored, blast-radius-aware, coverage-conscious.
argument-hint: "<PR number | branch name>"
---

# Review PR

Comprehensive PR review using ctxloom's graph. Mirrors the
multi-agent review the ctxloom-bot posts automatically — useful
when reviewing manually or when the bot isn't wired up.

## Inputs

- \`$ARGUMENTS\` — PR number (e.g. \`142\`) or branch name (e.g. \`feat/foo\`).
  Defaults to the current branch if unset.

## Steps

1. **Orientation**: call \`ctx_get_minimal_context(task="review PR $ARGUMENTS")\`.

2. **Detect changes**: call \`ctx_detect_changes(base="main")\`.
   Risk-scored per-file analysis. Take the top 5 highest-risk files.

3. **Pull source for the risky files**: call \`ctx_git_diff_review(base="main", max_response_tokens=4000)\`.
   Token-efficient diff packet covering the changed files.

4. **Blast radius per high-risk file**: for the top 3 risky files,
   call \`ctx_blast_radius(target=<file>)\`. Surfaces files that the
   change indirectly affects but don't appear in the diff.

5. **Affected flows**: call \`ctx_get_affected_flows(base="main")\`.
   Which execution paths the PR touches. Use to identify what
   integration tests should pass.

6. **Coverage check**: call \`ctx_knowledge_gaps(scope=<changed_files>)\`.
   Surface changed files lacking tests.

7. **Generate the review**: structured output with:
   - Risk summary (low/medium/high overall)
   - File-by-file findings (severity-ranked)
   - Coverage gaps that need addressing
   - Blast-radius observations the diff doesn't show

## Tier discipline

This skill is the agent-driven equivalent of the bot's
multi-specialist review. Use the same tier ladder:

- **T0 (structural)**: use the tools listed above — they're
  pre-fetched and cheap
- **T1 (skeleton)**: \`ctx_get_definition\` for individual symbols
- **T2 (full body)**: \`ctx_get_file\` only for files where the
  skeleton view is insufficient
- **T3 (raw read)**: avoid; if the graph can't answer the question,
  prefer \`ctx_git_diff_review\` (token-efficient diff packet) over
  raw \`Read\`

## Budget

- ≤8 ctxloom tool calls
- ≤5000 tokens total (review needs more headroom than other skills)

## Output format

\`\`\`
## PR Review: <title>

### Summary
<1–3 sentence overview>

### Risk Assessment
- Overall: Low / Medium / High
- Blast radius: X files, Y flows impacted
- Coverage: N changed symbols covered / M total

### Findings

#### <file_path>
- **Severity**: ...
- **Issue**: ...
- **Suggested fix**: ...

### Coverage Gaps

<table>

### Suggested follow-ups

<list>
\`\`\`
`;

// ─── /ctxloom-budget-stats ───────────────────────────────────────────

const BUDGET_STATS_CONTENT = `---
name: ctxloom-budget-stats
description: Inspect ctxloom's per-tool budget telemetry — fallback distribution + original-token p50/p75/p95 — to tune defaults from real usage.
---

# Budget Stats

Wrapper around \`ctxloom budget-stats\` for inline use inside a
Claude Code session. Useful when:

- Tuning per-tool \`DEFAULT_MAX_RESPONSE_TOKENS\` from real usage
  (the Phase B follow-up)
- Diagnosing why a tool keeps falling back to skeleton mode
- Understanding which tools dominate the user's token budget

## Steps

1. **Orientation**: call \`ctx_get_minimal_context(task="inspect budget telemetry")\`.
   Cheap (~150 tokens). Confirms the graph is wired up — if it's
   not, the user's MCP server probably can't emit budget events
   either, and the stats will be empty.

3. **Window selection**: ask the user how far back to look
   (default: 14d). Accept \`1d\`, \`7d\`, \`14d\`, \`30d\`.

4. **Optional tool filter**: ask if they want stats for a specific
   tool (e.g. \`ctx_get_file\`) or all tools.

5. **Run the CLI**: \`Bash\`-tool execute:
   \`ctxloom budget-stats --window=<N>d [--tool=<name>]\`

6. **Parse + summarize the output**:
   - Top 3 tools by breach count → these are the candidates for
     budget tuning
   - For each top tool, the p75 column is the suggested next
     \`DEFAULT_MAX_RESPONSE_TOKENS\` value (rationale: 75% of
     real-world calls fit under p75; the rest fall back gracefully
     to skeletons)

7. **Suggest concrete edits**: for each top tool, point to the
   source file (\`packages/core/src/tools/<tool>.ts\`) and the
   current constant. Don't apply edits without user confirmation.

## Budget

- ≤2 ctxloom tool calls (this skill is mostly Bash + parsing)
- ≤1500 tokens response total

## Output

\`\`\`
## Budget stats — <window>

### Top tools by breach count
1. <tool>: N breaches, skeleton%, p75=<tokens>
2. ...

### Suggested DEFAULT_MAX_RESPONSE_TOKENS tuning
- packages/core/src/tools/<tool>.ts: <current> → <suggested-p75>
  (rationale: ...)
\`\`\`
`;

/**
 * All ctxloom-prefixed skills shipped by Phase 3. Order matters for
 * the install summary output and for the drift test's expected file
 * list.
 */
export const CTXLOOM_SKILLS: SkillTemplate[] = [
  { name: 'ctxloom-explore', content: EXPLORE_CONTENT },
  { name: 'ctxloom-blast', content: BLAST_CONTENT },
  { name: 'ctxloom-refactor-safely', content: REFACTOR_CONTENT },
  { name: 'ctxloom-coverage-gap', content: COVERAGE_GAP_CONTENT },
  { name: 'ctxloom-review-pr', content: REVIEW_PR_CONTENT },
  { name: 'ctxloom-budget-stats', content: BUDGET_STATS_CONTENT },
];

/**
 * Map skill name → expected on-disk file path (relative to project
 * root). Used by the drift test to verify every shipped skill landed
 * in the right place.
 */
export function skillFilePath(name: string): string {
  return `.claude/skills/${name}/SKILL.md`;
}
