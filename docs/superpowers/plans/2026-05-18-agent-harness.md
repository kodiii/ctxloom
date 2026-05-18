# Agent-First Harness Implementation Plan (v1.4.0 → v1.5.0)

> **For agentic workers:** This plan covers four phases across multiple
> releases. Phase 1 lands in v1.4.0; Phases 2–4 follow in subsequent
> minor versions. Each phase is independently shippable.

**Goal:** Close the gap between ctxloom and code-review-graph's
"forced-use" model — agents reach for ctxloom MCP tools as the default
*because the harness makes opting-out cost more than opting-in*, not
because they remember a rule.

**Background:** PR #135's dogfood and the Phase B A/B gate showed
ctxloom's primitives (skeleton-first response budgets, live graph,
PR-bot multi-agent reviews) are strong; what's missing is the
**delivery layer** — the install pipeline, self-guiding API surface,
and prepackaged workflows that make those primitives the *path of
least resistance* for any agent host.

**Comparative analysis** (code-review-graph's 5-layer model):

| Layer | code-review-graph | ctxloom today | Gap |
|---|---|---|---|
| 1 | `.mcp.json` shipped in repo | ✅ exists | parity |
| 2 | SessionStart hook | ✅ via `hooks/session-start.sh` | **MISSING** |
| 3 | PostToolUse auto-update hook | ✅ via `hooks.json` | ⚠️ partial (live watcher only) |
| 4 | Prepackaged Claude Code skills | ✅ 7 skills | **MISSING** |
| 5 | `get_minimal_context` + `next_tool_suggestions` API self-guidance | ✅ both | **MISSING** |
| — | Auto-installer (`ctxloom init`) | ❌ they templateize manually | **opportunity to lead** |
| — | Response budgets (skeleton-first) | ❌ | ✅ ctxloom advantage |
| — | PR-bot pipeline | ❌ | ✅ ctxloom advantage |
| — | Multi-project state | ❌ | ✅ ctxloom advantage |

---

## Phase 1 — Self-guiding API (target: v1.4.0)

**Why first:** highest-leverage, smallest-risk slice. Both features
are *additive* — no existing tool contract changes, no breaking
behavior. They become the foundation Phases 2–4 build on (the install
banner references `ctx_get_minimal_context`; the skills orchestrate via
the `next_tool_suggestions` field).

### 1a. `ctx_get_minimal_context` tool

**Purpose:** the mandatory first call. Returns ~100–200 tokens of
orientation: graph readiness, recent changes, top hubs, suggested first
tool. Anchors every workflow with a single low-cost call.

**Schema** (input):
```ts
{
  task?: string;                  // user's natural-language task description
  project_root?: string;          // multi-project routing
  max_response_tokens?: number;   // budget surface — default 200
}
```

**Schema** (output, wrapped in `{data, meta}` envelope when budget opted in):
```ts
{
  graph: {
    ready: boolean;
    nodes: number;
    edges: number;
    last_build_iso: string;
    staleness: 'fresh' | 'stale_minutes' | 'stale_hours' | 'unbuilt';
    languages: string[];
  };
  recent_changes: Array<{ file: string; status: 'M' | 'A' | 'D' | 'R' }>;
  top_hubs: Array<{ name: string; reason: 'fan_in' | 'fan_out' | 'bridge' }>;
  suggested_first_tool: {
    tool: string;
    args?: Record<string, unknown>;
    why: string;
    estimated_tokens: number;
  };
}
```

**Task-aware logic** (improvement over code-review-graph's static version):
- If `task` matches `/(review|audit|check)/i` AND working tree dirty → suggest `ctx_detect_changes`
- If `task` matches `/(rename|refactor|move)/i` → suggest `ctx_find_callers`
- If `task` matches `/(blast|impact|breaks?)/i` → suggest `ctx_blast_radius`
- If `task` matches `/(architect|overview|explore|onboard)/i` → suggest `ctx_architecture_overview`
- If no `task` or no match → suggest `ctx_detect_changes` if dirty, else `ctx_architecture_overview`

**Performance budget:**
- Target response time: **<50ms** (this is called at the start of every
  workflow; latency is felt directly)
- Avoid touching the vector store (lazy-loaded; would add 500ms+)
- Don't run `git log` — only `git status --porcelain` with 2s timeout
- Read precomputed top-hubs from graph metadata (already populated by
  the indexer); never recompute live
- **Cache the full response for 10 seconds** keyed on `(project_root, task)`
  — multiple agents asking in quick succession get cached answers
- Token cost ceiling: **200 tokens default**, hard-capped at 500. Skeleton
  if over by truncating `recent_changes` (most expandable section)

**Security checklist:**
- [ ] `task` field is user input — never echoed verbatim into response
  fields that are then logged. Truncate to 200 chars, strip control
  characters (already exists in `_sanitize_name()` equivalent)
- [ ] `project_root` goes through existing `PathValidator` — reject
  paths outside registered roots
- [ ] `recent_changes` lists relative file paths only, never absolute
- [ ] `top_hubs` names go through the existing sanitize helper (the
  graph node name field is user-controlled in the sense that file
  authors choose them)
- [ ] Telemetry: emit `ctx.minimal_context.used` event with `{task_kind, suggested_tool}`
  for the learned-workflows feature (Phase 4b) — NO `task` string in
  the event (privacy contract)

**Test plan:**
- Unit: each task-kind regex routes to the expected tool
- Unit: response respects `max_response_tokens` (skeleton via truncating
  `recent_changes`)
- Unit: cache hit returns identical response within 10s window
- Integration: live graph build → call tool → verify hub names are real graph nodes
- Integration: working-tree dirty → `recent_changes` populates; clean → empty array
- Privacy: emit telemetry, parse the event, assert no `task` string appears

**Files:**
- Create: `packages/core/src/tools/minimal-context.ts`
- Create: `tests/MinimalContext.test.ts`
- Modify: `src/server.ts` (register tool)
- Modify: `packages/core/src/index.ts` (export type)

---

### 1b. `next_tool_suggestions` field on every tool response

**Purpose:** the API itself leads the agent. Every tool response carries
1–3 follow-up suggestions with `why` reasoning and token cost estimate.

**Schema** (added to `BudgetMeta` or sibling `meta` field):
```ts
interface NextToolSuggestion {
  tool: string;
  args?: Record<string, unknown>;
  why: string;
  estimated_tokens?: number;
}

// Augmented BudgetMeta
interface BudgetMeta {
  // ... existing fields ...
  next_tool_suggestions?: NextToolSuggestion[];   // present when budget surface engaged
}
```

**Static rules** (used when telemetry insufficient or in unknown task context):
```ts
const NEXT_TOOL_RULES: Record<string, NextToolSuggestion[]> = {
  ctx_get_file: [
    { tool: 'ctx_find_callers', why: 'check who depends on this before modifying' },
    { tool: 'ctx_get_definition', why: 'cheaper view if you need a specific symbol' },
  ],
  ctx_get_definition: [
    { tool: 'ctx_find_callers', why: 'who calls this symbol?' },
    { tool: 'ctx_blast_radius', why: 'what would break if this changes?' },
  ],
  ctx_detect_changes: [
    { tool: 'ctx_get_review_context', why: 'pull source snippets for the risky files' },
    { tool: 'ctx_get_affected_flows', why: 'which execution paths are impacted?' },
  ],
  ctx_blast_radius: [
    { tool: 'ctx_get_affected_flows', why: 'execution flow analysis on impacted files' },
    { tool: 'ctx_query_graph', args: { pattern: 'tests_for' }, why: 'check test coverage' },
  ],
  // ... entry per registered tool, ~33 total
};
```

**Learned rules** (telemetry-derived, override static when present —
Phase 4b ships the learner; v1.4.0 ships only static):
- Read `~/.ctxloom/telemetry/budget-events-*.jsonl` files
- Build a (tool_a → tool_b) transition frequency matrix from time-sorted events
- For each tool, suggest top-3 follow-ups by frequency
- Refresh once per process at startup; cache 1h thereafter
- **Allowlist filter:** only suggest tools that exist in the registry
  (defense against poisoned telemetry — see security checklist)

**Performance budget:**
- Static rules: zero runtime cost — module-load constant
- Learned rules (Phase 4b): one-shot startup cost (~50ms for 14 days of
  events), zero per-call cost (in-memory map lookup)
- Wire-format cost: ≤3 suggestions × ~30 tokens each = **~90 tokens per response**
- When `max_response_tokens` budget is tight, drop `next_tool_suggestions`
  entirely before truncating `data` — suggestions are the cheapest cut

**Security checklist:**
- [ ] **Allowlist enforcement:** suggested `tool` names MUST be in the
  registered tool set. Reject anything else (defense against poisoned
  telemetry — even though privacy contract restricts payloads, malformed
  tool names could be injected via file corruption / manual edits)
- [ ] `args` in suggestions are author-defined static literals (no user
  input echoed) — never include `task` text, file paths, or query strings
- [ ] `why` strings are static template literals — no string interpolation
  of any user-controllable value
- [ ] If telemetry parsing fails, fall through to static rules — never
  surface raw file content to the agent
- [ ] `estimated_tokens` derived from telemetry MUST be sanity-checked
  (clamp to [0, 100000]) before being placed in response

**Test plan:**
- Unit: each registered tool has at least one static rule
- Unit: rules allowlist filters out unknown tool names
- Unit: budget-tight scenario drops suggestions before truncating data
- Integration: call `ctx_get_file` over budget → response includes
  `next_tool_suggestions` with allowlisted tools
- Privacy: feed corrupted telemetry → static rules fall through
- Drift: snapshot test that pins every tool name in `NEXT_TOOL_RULES`
  exists in the registered tool list (prevents typos)

**Files:**
- Create: `packages/core/src/budget/nextToolSuggestions.ts`
- Modify: `packages/core/src/budget/budget.ts` (extend `BudgetMeta`,
  enforceBudget calls `suggestNext()`)
- Create: `tests/NextToolSuggestions.test.ts`
- Modify: each tool that hits the budget surface — automatically picks up
  the new meta field, no per-tool changes needed

---

## Phase 2 — Auto-install harness (target: v1.4.x patch or v1.5.0)

### 2a. `ctxloom init` command

**Purpose:** zero-config integration. One command writes every file a
Claude Code / Gemini CLI / generic-agent host needs to use ctxloom.

**Command shape:**
```bash
ctxloom init [--host=claude|gemini|cursor|aider|all]
             [--force]              # overwrite existing files
             [--dry-run]            # print what would be written
             [--skip-build]         # don't build graph during init
```

**Files written** (relative to `cwd`):
| File | Purpose | Idempotent? |
|---|---|---|
| `.mcp.json` | Loads ctxloom MCP server | yes (merge with existing) |
| `.claude/hooks.json` | SessionStart + PostToolUse hooks | yes (merge by matcher) |
| `.claude/hooks/session-start.sh` | Banner + status check | yes (replace) |
| `.claude/CLAUDE.md` | Tool-usage rules (HMAC-signed block) | yes (replace block only) |
| `AGENTS.md` | Generic agent rules | yes (replace block only) |
| `GEMINI.md` | Gemini-specific block | yes (replace block only) |

**HMAC-signed templated blocks** (mirrors code-review-graph's
`<!-- BEGIN BEADS INTEGRATION v:1 hash:ca08a54f -->` pattern, but
**signed** instead of just versioned):

```markdown
<!-- BEGIN CTXLOOM-RULES v:1 hmac:sha256:abc123... -->
## MCP Tools: ctxloom

**ALWAYS use the ctxloom MCP tools BEFORE Grep/Glob/Read...**

[... canonical block content ...]
<!-- END CTXLOOM-RULES -->
```

**Why HMAC, not just hash:**
- Detect tampering (hand-edits) — drift tests fail CI if the block is
  modified outside `ctxloom init`
- Cross-host consistency — same block content + secret produces same
  HMAC across Claude/Gemini/Cursor, so the test verifies all three are
  in sync

**Drift detection** (tests/InstallTemplatePin.test.ts):
- For each templated file, recompute the HMAC and assert it matches
  the on-disk value
- Fails CI if any of the 6 files drifts → forces re-running `ctxloom init`
- Tracks code-review-graph's `<!-- BEGIN BEADS INTEGRATION hash:... -->`
  pattern but with stronger guarantees

**Performance budget:**
- `ctxloom init` runtime: **<3s** on first run (file writes + optional graph build deferred)
- Idempotency: re-running on a clean install is **<200ms** (HMAC compare, no writes)

**Security checklist:**
- [ ] **Never write outside `cwd`** — every output path validated through
  `PathValidator.validate(target).startsWith(resolve(cwd))`
- [ ] Existing files NOT overwritten without `--force` flag (unless only
  the templated block is replaced — outside the block stays intact)
- [ ] HMAC key derived from `process.env.CTXLOOM_INSTALL_KEY` if set,
  else a published "default" key (not actually secret — purpose is
  drift detection, not auth)
- [ ] `.mcp.json` merge logic preserves existing servers; only adds/updates
  the `ctxloom` entry
- [ ] Hook scripts run with **no shell elevation** — pure user-level
  commands
- [ ] Generated `session-start.sh` uses `[ -f file ]` POSIX-portable
  syntax, no bashisms that fail on /bin/sh
- [ ] Never embed secrets / API keys in generated files

**Files:**
- Create: `packages/core/src/install/installer.ts`
- Create: `packages/core/src/install/templates.ts` (canonical block content)
- Create: `packages/core/src/install/hmacBlock.ts` (block signing/verification)
- Create: `src/commands/init.ts` (CLI handler)
- Create: `tests/Installer.test.ts`
- Create: `tests/InstallTemplatePin.test.ts` (HMAC drift detection)
- Modify: `src/index.ts` (wire `case 'init':`)

---

### 2b. SessionStart hook content

**Purpose:** at every Claude Code session start, print agent-visible
guidance: graph status, prefer ctx_* tools, suggested first command.

**Content** (generated by `ctxloom init`):
```bash
#!/usr/bin/env bash
# .claude/hooks/session-start.sh
# Generated by ctxloom init — DO NOT EDIT (HMAC-pinned)

DB=".ctxloom/graph.db"

if [ -f "$DB" ]; then
  # Read graph stats from ctxloom cache (no MCP server call needed)
  STATS=$(ctxloom status --json 2>/dev/null)
  cat <<EOF
[ctxloom] Knowledge graph ready ($STATS).
For this codebase, prefer the ctx_* MCP tools over Grep/Glob/Read:
  - Start with ctx_get_minimal_context (~150 tokens of orientation).
  - Use ctx_detect_changes for code review.
  - Use ctx_find_callers / ctx_blast_radius before refactoring.
  - Fall back to Read/Grep only when the graph doesn't cover what you need.
EOF
else
  echo "[ctxloom] No graph yet. Run: ctxloom build  (then restart this session)"
fi
```

**Improvements over code-review-graph:**
- Conditional aggressiveness: if `ctxloom budget-stats` shows the user's
  recent sessions averaged >2k tokens per task, append: "Recent sessions
  averaged $TOK tokens — graph queries can cut this 5–10×."
- Banner content is **data-driven**, not static text

**Performance:**
- Hook timeout: **2 seconds** (set in `hooks.json`)
- `ctxloom status --json` must respond in **<500ms** (already exists)

**Security:**
- Hook script is HMAC-pinned; tampering caught by `InstallTemplatePin.test.ts`
- No env vars echoed, no file paths leaked (only counts/stats)

---

### 2c. PostToolUse hook content

```json
{
  "matcher": "Write|Edit",
  "hooks": [{
    "command": "ctxloom update --incremental --quiet",
    "timeout": 30
  }]
}
```

**Improvement over code-review-graph:** runs **alongside** ctxloom's
existing file watcher. If the watcher daemon dies, the hook still keeps
the graph fresh. Belt-and-suspenders redundancy → agents never see staleness.

**Performance:**
- `ctxloom update --incremental` must complete in **<10s** for typical
  single-file edits (the 30s timeout in `hooks.json` is a ceiling, not a target)
- Use the existing incremental indexer; no full rebuilds

**Security:**
- Same as 2b — script HMAC-pinned

---

## Phase 3 — Prepackaged skills (target: v1.5.0)

**Purpose:** user-facing slash commands that orchestrate ctxloom tool
sequences. Eliminates "which tool do I call?" friction.

**Skill structure** (each is a directory under `skills/`):
```
skills/
├── ctxloom-review-pr/
│   ├── SKILL.md          (Claude Code skill spec — frontmatter + prompt)
│   └── README.md         (human-facing docs)
├── ctxloom-explore/
├── ctxloom-refactor-safely/
├── ctxloom-blast/
├── ctxloom-coverage-gap/
└── ctxloom-budget-stats/
```

**Skills shipped in v1.5.0:**

| Skill | Slash command | What it does |
|---|---|---|
| `ctxloom-review-pr` | `/ctxloom:review-pr <pr>` | Multi-agent PR review (mirrors the bot) |
| `ctxloom-explore` | `/ctxloom:explore` | architecture_overview + community_list + hub_nodes orchestrated |
| `ctxloom-refactor-safely` | `/ctxloom:refactor-safely <symbol> <new_name>` | find_callers → refactor_preview → apply_refactor |
| `ctxloom-blast` | `/ctxloom:blast <symbol>` | blast_radius + affected_flows packaged |
| `ctxloom-coverage-gap` | `/ctxloom:coverage-gap` | tests_for + knowledge_gaps highlighting |
| `ctxloom-budget-stats` | `/ctxloom:budget-stats` | wraps the CLI in a Claude Code-friendly skill |

**Improvements over code-review-graph:**
- Skill outputs feed back to telemetry (`ctx.skill.used` event) so we can
  measure adoption and tune
- Skills use the budget surface — when user has a small token budget,
  skill auto-selects skeleton-mode responses (code-review-graph can't)
- Skill specs tested via `SHARED_BLOCKS` pattern (already exists in
  `tests/agents.test.ts`) — prevents drift between the docs and the
  actual prompt content

**Performance:**
- Each skill must complete its happy path in **≤5 tool calls** (mirrors
  code-review-graph's protocol target; we have telemetry to verify)
- `ctxloom-explore` is the heaviest — budget: 2000 tokens total response

**Security:**
- Skill prompts never contain user-injectable strings — they're static
  templates with placeholders for typed parameters
- `ctxloom-refactor-safely` requires user confirmation before
  `apply_refactor` (the destructive step)
- Skills run in the user's Claude Code session — no elevated permissions

---

## Phase 4 — Going beyond code-review-graph (target: v1.5.x → v1.6.0)

### 4a. Server-enforced graph-call budget

**The improvement:** code-review-graph's "≤5 tool calls / ≤800 tokens"
is *prose in CLAUDE.md*. Ours is **server-enforced** — we already have
`enforceBudget()`; extend it to track call count per task.

**Approach:**
- New env var `CTXLOOM_TASK_TOOL_BUDGET` (default: 8 calls)
- Heuristic for "same task": same MCP session ID within 90s of last call
- When budget hit, subsequent calls auto-default to `detail_level=minimal`
  and `response_format=skeleton`
- Hard enforcement (not prose) — agents can't ignore it

**Performance:**
- Per-call overhead: O(1) — counter increment in `ProjectStateManager`
- Reset on inactivity (90s gap) — no daemon needed

**Security:**
- Counter is per-session, not global — one chatty session can't
  starve another
- Override via `CTXLOOM_DISABLE_BUDGET=1` kill switch (already exists)

---

### 4b. Tool-sequence telemetry → learned workflows

**Purpose:** the `next_tool_suggestions` field becomes evidence-based,
not author-guessed.

**Approach:**
- Mine `~/.ctxloom/telemetry/budget-events-*.jsonl` for (tool_a → tool_b)
  transition pairs within the same session window
- Compute top-3 follow-ups per tool, weighted by recency (last 14 days)
- Compare against static rules; flag anti-patterns
  ("agents that call X before Y use 4× more tokens")
- Update `nextToolSuggestions.ts` at process startup, cached 1h

**Performance:**
- One-shot at startup: ~50ms for 14 days of events
- Zero per-call cost (in-memory lookup)

**Security:**
- Privacy contract upheld (PR #140 — events have no source content)
- Allowlist of registered tool names enforced when reading suggestions
- Telemetry corruption falls through to static rules

**Telemetry plan:**
- Emit `ctx.workflow.learned` event when learner runs (counts unique
  task types observed)
- Emit `ctx.suggestion.followed` event when an agent's next call
  matches our suggestion (measures effectiveness)

---

### 4c. PR-bot integration

**Purpose:** the existing PR-bot calls `ctx_*` tools but doesn't yet
use the new self-guiding API. Wire it up:

1. Call `ctx_get_minimal_context(task="review PR #N")` first
2. Use the suggested workflow from `next_tool_suggestions`
3. Emit `meta.next_tool_suggestions` in the review comment itself,
   giving the **PR author** the same next-step nudges agents get

**Improvement:** PR review comments become educational. Author sees
"if you want to dig deeper, try `ctx_blast_radius` on this file" —
turning code review into an onboarding moment.

---

### 4d. Cross-agent host matrix

**Purpose:** `ctxloom init --host=cursor|aider|copilot|windsurf` emits
the equivalent rules format for each host.

| Host | Rule file | Format |
|---|---|---|
| Claude Code | `.claude/CLAUDE.md` | Markdown with HMAC-pinned block |
| Gemini CLI | `GEMINI.md` | Markdown with HMAC-pinned block |
| Cursor | `.cursorrules` | YAML frontmatter + rules |
| Aider | `CONVENTIONS.md` | Markdown |
| Copilot | `.github/copilot-instructions.md` | Markdown |
| Windsurf | `.windsurfrules` | YAML |

**Performance:** one-shot install, no runtime cost.

**Security:**
- Each host's file goes through the same PathValidator-bounded write
- HMAC blocks per-host so drift in any single host is caught

---

## Open questions

1. **Tool registry as source of truth for the rule allowlist.** Do we
   accept the existing registry getter, or add a new "publish allowlist"
   API call? Argues for keeping it implicit (the registry already enforces
   uniqueness).

2. **Cache invalidation for `ctx_get_minimal_context`.** 10s TTL is the
   first guess. Should it be evicted on `Write|Edit` PostToolUse hook
   firing? Argues yes — keeps cache fresh after every agent edit.

3. **Learner ships in v1.4.0 or v1.5.0?** Static rules ship in v1.4.0
   regardless. The learner could ship behind a flag in v1.4.0 (low risk
   since fallthrough is static rules) or wait for v1.5.0 to harden.
   Lean: v1.5.0 — gives 2 weeks of usage telemetry to seed the learner.

4. **Drift-detection HMAC key — published or per-install?** Per-install
   would prevent "fake but signed" tampering, but breaks "test the install
   is correct" CI workflows. Lean: published, since the goal is drift
   detection (good-faith only), not auth.

5. **Skill testing strategy.** SHARED_BLOCKS pattern (from pr-bot agents)
   pins the prompt text. Should we also pin the *tool sequence* a skill
   produces? Lean: yes — add a test that runs each skill against a fixture
   repo and asserts the expected tools fire in the expected order.

---

## Performance budget (cross-cutting)

| Surface | Target | Hard ceiling |
|---|---|---|
| `ctx_get_minimal_context` response time | <50ms | 200ms |
| `ctx_get_minimal_context` response tokens | 150 | 500 |
| `next_tool_suggestions` per-call cost | ~0ns (static) | n/a |
| `ctxloom init` runtime | <3s first run, <200ms idempotent | 10s |
| SessionStart hook execution | <500ms | 2s |
| PostToolUse `ctxloom update --incremental` | <10s | 30s |
| Skill happy-path tool count | ≤5 | 8 |
| Skill happy-path total tokens | ≤2000 | 5000 |

---

## Security checklist (cross-cutting)

| Surface | Concern | Mitigation |
|---|---|---|
| All tools | Path traversal via `project_root` | `PathValidator` (existing) |
| All tools | Prompt injection via node names | `_sanitize_name()` (existing) |
| `next_tool_suggestions` | Poisoned telemetry → fake tool names | Registry allowlist |
| `ctxloom init` | Writes outside cwd | `PathValidator.validate(target).startsWith(resolve(cwd))` |
| `ctxloom init` | Existing-file clobber | Block-only replace; `--force` flag for full overwrite |
| HMAC blocks | Tampering | Drift-detection test in CI |
| SessionStart hook | Shell-injection from env vars | No user-controllable variables echoed |
| Skills | User-injected prompt | Static templates with typed parameters only |
| Learned workflows | PII leakage | Privacy contract upheld (PR #140); allowlist filter |

---

## Telemetry plan (cross-cutting)

Events emitted by this work (all subject to existing privacy contract —
no source content, no paths, no queries):

| Event | Fired when | Payload |
|---|---|---|
| `ctx.minimal_context.used` | Tool invoked | `task_kind`, `suggested_tool`, `cache_hit` |
| `ctx.suggestion.shown` | Suggestion attached to response | `from_tool`, `to_tool` |
| `ctx.suggestion.followed` | Next call matches a suggestion | `from_tool`, `to_tool` |
| `ctx.skill.used` | Skill invoked | `skill_name` |
| `ctx.install.completed` | `ctxloom init` runs | `host_matrix`, `files_written` |
| `ctx.workflow.learned` | Learner updates suggestions | `n_events`, `n_unique_pairs` |

---

## Sequencing (target releases)

| Phase | Release | Estimated days |
|---|---|---|
| 1a + 1b (self-guiding API) | v1.4.0 | 2 |
| 2a (`ctxloom init`) | v1.4.x | 2 |
| 2b + 2c (hooks) | v1.4.x | 1 |
| 3 (prepackaged skills) | v1.5.0 | 3 |
| 4a (server-enforced call budget) | v1.5.x | 2 |
| 4b (learned workflows) | v1.5.x or v1.6.0 | 3 |
| 4c (PR-bot integration) | v1.5.x | 1 |
| 4d (cross-agent matrix) | v1.6.0 | 2 |
| **Total** | | **~16 days** |
