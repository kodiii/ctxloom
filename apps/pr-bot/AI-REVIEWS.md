# AI-narrated PR reviews — Claude + ctxloom

The `apps/pr-bot/` Docker action gives you **deterministic structural
analysis** on every PR: blast radius, risk scores, reviewer
suggestions, co-change overlay. Zero LLM calls, zero external
services, $0/PR.

This guide adds an **optional narrative layer** on top: four
specialist Claude subagents (security, architecture, testing,
performance) that run **in parallel**, call ctxloom MCP tools to gather
structural evidence, and post a single consolidated review comment.

You can run them three ways — pick whichever matches how you already
use Claude:

1. **Locally** in Claude Desktop / Codex / Claude Code CLI — uses your
   existing logged-in session, **no API key**, no GitHub Action, no
   secrets to manage. *Recommended for most users.*
2. **In CI with your Claude subscription** — the official
   `claude-code-action` with `CLAUDE_CODE_OAUTH_TOKEN` (from the
   Claude Code GitHub App) draws from your Max/Pro/Team seat. **No API
   key.**
3. **In CI with `ANTHROPIC_API_KEY`** — pay-per-token, for teams
   without a Claude subscription.

In CI modes, the review is gated:
- Auto-runs only when the deterministic ctxloom-review flagged
  **medium/high/critical** risk, OR
- Someone comments **`@claude review`** on the PR

This keeps token / quota spend proportional to actual risk.

## Architecture

The structural analysis runs the same way regardless of where Claude
sits. The four specialist agents call ctxloom MCP tools, the
orchestrator aggregates, and a single comment lands on the PR.

```
                   ┌──────────────────────────────────────┐
                   │  review-orchestrator                  │
                   │  ↳ validates + calibrates + dedupes   │
                   │  ↳ posts single self-updating comment │
                   └──────────────┬───────────────────────┘
                                  │ dispatches in parallel via Task
       ┌────────────┬─────────────┼─────────────┬────────────┐
       ▼            ▼             ▼             ▼            ▼
  security    architecture     testing     performance      (your custom
  reviewer       reviewer     reviewer       reviewer        specialist)
       │            │             │             │
       └────────────┴─────┬───────┴─────────────┘
                          ▼
                ┌─────────────────────┐
                │ ctxloom MCP (33     │
                │ tools — graph,      │
                │ git overlay, risk)  │
                └─────────────────────┘

Run it in any of these three places:

  Mode 1 (local)   Claude Desktop / Codex / Claude Code CLI
                   ↳ uses your logged-in session — no key needed

  Mode 2 (CI)      .github/workflows/claude-review.yml
                   anthropics/claude-code-action + CLAUDE_CODE_OAUTH_TOKEN
                   ↳ uses your subscription seat — no API key needed

  Mode 3 (CI)      .github/workflows/claude-review.yml
                   anthropics/claude-code-action + ANTHROPIC_API_KEY
                   ↳ pay-per-token
```

In CI modes, the deterministic `ctxloom-review.yml` Docker action also
runs (free, $0/PR, always). The Claude review layers narrative on top —
gated to medium+ risk PRs or `@claude review` mentions, so it never
runs on trivial diffs.

The specialists communicate with each other **only through the
orchestrator** — they don't share state mid-run. This is exactly the
multi-agent pattern Anthropic ships in Claude Code: parallel agents,
fresh context each, structured outputs aggregated by an orchestrator.

## Why this design (and not "Claude reviews the diff")

Naive LLM PR reviewers send the entire diff (and often the whole repo)
to the model. Three problems with that:

1. **Privacy** — your code goes to the LLM provider.
2. **Hallucination** — the model invents structure it can't see (`UserService` doesn't really call `BillingService`, but the LLM is confident it does).
3. **Token cost** — a 50-file PR review burns ~$0.30 of Sonnet on the diff alone.

ctxloom flips this. The agents get the **structured graph** instead of
raw source:

- They call `ctx_blast_radius` to learn that `auth/controller.ts` has 14 importers.
- They call `ctx_find_callers` with `depth: 6` to trace a SQL pattern back to `POST /api/users` (no auth middleware) — confirmed reachable.
- They call `ctx_graph_diff` to see exactly which new edges this PR introduces, including any that cross community boundaries.
- They call `ctx_get_context_packet` to pull a precise, token-efficient slice of just the relevant code.

The LLM never sees the diff blindly — it pulls only what its analysis
demands. Typical token usage drops by 60–80% vs. dump-the-diff
reviewers, and findings cite specific MCP tool calls as evidence
(making hallucinations easy to catch in review).

## Three deployment modes

Pick the one that matches how you already use Claude. **All three are
first-class.** They differ only in *where* Claude runs and *how* it's
authenticated.

| Mode | Where Claude runs | Auth | Cost | Setup time |
|---|---|---|---|---|
| **1. Local — Claude Desktop / Codex / CLI** | Your machine | Your existing login session | ✅ Included in your subscription | 30 seconds |
| **2. CI with subscription (OAuth)** | GitHub Actions | Claude Code GitHub App seat | ✅ Included in your subscription | ~5 min one-time |
| **3. CI with API key** | GitHub Actions | `ANTHROPIC_API_KEY` | 💳 Pay-per-token (~$0.10/PR) | ~5 min one-time |

If you have a **Claude Max / Pro / Team subscription**, use Mode 1 or
Mode 2. **You don't need an API key for either.** Mode 3 only exists
for teams without a Claude subscription who want to pay per token.

---

### Mode 1 — Local (Claude Desktop / Codex / Claude Code CLI)

**Zero CI, zero secrets, uses your existing logged-in Claude session.**
The agents live in your home directory; ask Claude to review any PR
from any repo and it dispatches them.

**Prereqs**
- Claude Desktop / Codex / Claude Code CLI installed and logged in.
- ctxloom MCP configured in that app (run `ctxloom setup` once).
- `gh` CLI installed and authenticated (Claude uses it to post the
  comment).

**Install (one command)**

Clone the ctxloom repo somewhere (or `cd` into your existing clone), then
run the installer from `apps/pr-bot/examples/`:

```bash
git clone https://github.com/kodiii/ctxloom.git
cd ctxloom/apps/pr-bot/examples
./setup-local.sh                  # copies agents to ~/.claude/agents/
```

Or for a single project only — run from inside the project root:

```bash
cd /path/to/your/project
/path/to/ctxloom/apps/pr-bot/examples/setup-local.sh --project
# copies to ./.claude/agents/
```

**Use it**

Open Claude Desktop (or Codex / Claude Code CLI). With your repo open
and the ctxloom MCP connected, ask:

> Review PR #42 in this repo using the **review-orchestrator** agent.
> Dispatch the four specialist subagents (security, architecture,
> testing, performance) in parallel via the ctxloom MCP tools and post
> a consolidated comment using gh CLI.

Claude routes to the orchestrator agent, which fires off the four
specialists in parallel, aggregates their findings, and posts the
review on the PR.

**This is the simplest path and recommended for most users.** No
secrets to manage, no workflow file to commit, no GitHub App to
install. You're paying for your Claude subscription anyway — make it
do PR reviews too.

---

### Mode 2 — CI with subscription (OAuth, recommended for teams)

If you want reviews **automatic on every risky PR** without anyone
having to invoke Claude manually, run them in GitHub Actions but bill
against your Claude seat instead of an API key.

**Setup**

1. Install the official **[Claude Code GitHub App](https://github.com/apps/claude)** on your repo.
   It auto-creates a `CLAUDE_CODE_OAUTH_TOKEN` repo secret that draws
   from your Max/Pro/Team seat — no API key, no per-token billing.
2. Copy the workflow + agents into your repo. Run these commands from
   **your project's root** (clone ctxloom first if you haven't already):
   ```bash
   # From your project root, with ctxloom cloned somewhere accessible:
   CTXLOOM_REPO=/path/to/cloned/ctxloom
   mkdir -p .github/workflows
   cp -R "$CTXLOOM_REPO/apps/pr-bot/examples/.claude" .claude
   cp "$CTXLOOM_REPO/apps/pr-bot/examples/.github/workflows/claude-review.yml" \
      .github/workflows/
   ```
3. Add **`CTXLOOM_LICENSE_KEY`** to your repo secrets (ctxloom MCP
   needs this to start in CI).
4. Commit and push.

That's it. The workflow's `with:` block already points at
`secrets.CLAUDE_CODE_OAUTH_TOKEN`. Open a PR, comment `@claude review`,
or wait for the auto-trigger when ctxloom-review flags risk.

---

### Mode 3 — CI with API key (pay-per-token)

Use this **only** if you don't have a Claude subscription and want to
pay per token instead.

**Setup**

1. Same workflow + agents copy as Mode 2.
2. Add **`ANTHROPIC_API_KEY`** to your repo secrets (from
   https://console.anthropic.com/).
3. Open `.github/workflows/claude-review.yml` and:
   - Comment out the `claude_code_oauth_token:` line.
   - Uncomment the `anthropic_api_key:` line.
4. Add `CTXLOOM_LICENSE_KEY` to repo secrets.
5. Commit, push, comment `@claude review` on any PR.

Expected cost is documented below.

## The four specialists

Each specialist is defined in `.claude/agents/` as a Markdown file with
YAML frontmatter. The orchestrator dispatches them via Claude Code's
built-in `Task` tool, which gives each one fresh context. None of them
sees the orchestrator's prompt or any other specialist's output —
**that's the point**.

### 🔒 security-reviewer

Audits for OWASP-class vulnerabilities introduced or made newly
reachable by the diff. Maximizes:

- `ctx_full_text_search` for injection / secret / crypto patterns
- `ctx_find_callers` with depth 6 to confirm **reachability** from
  unauthenticated entry points (this is what makes findings actionable
  vs. noise)
- `ctx_get_context_packet` to assess whether input validation
  middleware neutralizes the pattern
- `ctx_git_coupling` to flag when security-sensitive files
  historically moved together but only one is in this PR

Output is severity-tagged with OWASP / CWE references and a
`reachability` field that the orchestrator uses to calibrate.

### 🏛 architecture-reviewer

Detects layering violations, cycles, hub overload, new bridge nodes,
and parallel implementations. Heavy on **graph diff** analysis:

- `ctx_graph_diff` is the single most important call — every new edge
  is classified (intra-community, clean boundary, layering concern, or
  cycle)
- `ctx_hub_nodes` / `ctx_bridge_nodes` are compared **before and
  after** to flag regressions, not just absolute states
- `ctx_similar_files` catches parallel implementations of existing
  patterns
- `ctx_surprising_connections` surfaces graph-theory-detected unusual
  relationships involving this PR's files
- `ctx_rules_check` enforces `.ctxloom/rules.yml` violations

### 🧪 testing-reviewer

Two distinct concerns:

1. **Coverage** — does the changed code have test reachability? Uses
   `ctx_get_call_graph` to find test-file callers, weights by
   `ctx_blast_radius` + `ctx_risk_overlay` (a 5-line untested helper
   reaching a payment flow is `high`; the same helper in a CLI tool is
   `low`).
2. **Test quality** — for newly added/modified test files, scans for
   mock-only assertions, snapshot abuse, `.only` / `.skip`,
   non-deterministic patterns, isolation issues.

Won't flag pre-existing test debt — only what this PR introduces.

### ⚡ performance-reviewer

Pattern-matches N+1, sync I/O on hot paths, unbounded fetches,
quadratic algorithms, event-loop blockers, regex DoS, resource leaks.
**Crucial difference vs. generic perf linters:** every `high+` finding
must prove the hot path via `ctx_execution_flow` from a HOT entry
point (HTTP route, queue consumer, etc.). Cold-path inefficiencies are
`info` at worst. This eliminates ~80% of perf-noise findings.

### 🎼 review-orchestrator

Coordinates the above:

- **Gates** the run on the diff being non-trivial AND the
  `ctx_risk_overlay` max score ≥ 0.25 (saves tokens on safe PRs).
- **Dispatches** all four specialists in parallel via a single
  multi-tool-use message.
- **Validates** each agent's JSON output, retrying once on schema
  failure, dropping the agent on second failure (degraded mode).
- **Calibrates** severities: downgrades findings with weak evidence,
  upgrades findings flagged by ≥ 2 specialists on the same file.
- **Deduplicates** by file:line.
- **Posts a single comment** that updates on subsequent runs (same
  comment marker `🧵 ctxloom AI review`, edited in place rather than
  spamming new comments).

## Cost expectations

### Modes 1 & 2 (subscription)

**$0 marginal cost per PR.** Reviews count against your existing
Claude Max / Pro / Team quota. Practical limits:
- Max plan: 200+ reviews/day comfortably
- Pro plan: 30–50 reviews/day
- Team plan: scales per seat

Exceeding the rolling 5-hour quota window pauses Claude until the
window resets — no surprise charges.

### Mode 3 (pay-per-token API)

Per PR (Sonnet 4.6 pricing):

| PR size | Specialists run | Approx cost |
|---|---|---|
| Docs only | 0 (auto-skip) | $0 |
| Trivial (< 50 LOC, risk < 0.25) | 0 (gated out) | $0 |
| Small refactor (~ 200 LOC) | 4 in parallel | $0.03–$0.08 |
| Feature PR (~ 1000 LOC) | 4 in parallel | $0.10–$0.25 |
| Large refactor (~ 5000 LOC) | 4 in parallel | $0.40–$0.80 |

Costs are dramatically lower than the typical "send the whole diff to
the LLM" pattern because ctxloom MCP tool calls return structured
slices rather than raw source.

To cut further: switch to Haiku 4.5 in `claude-review.yml` (good
quality for security + perf, marginally weaker on architecture). Or
disable the auto-trigger and require `@claude review` for every run.

## Customizing the agents

Each agent definition is plain Markdown in your repo — edit freely.
Common tweaks:

- **Add domain checks**: append your own pattern queries to the
  security-reviewer's Step 3 sweep (e.g., your custom auth helpers).
- **Tune severity calibration**: adjust the orchestrator's
  downgrade/upgrade rules to your team's noise tolerance.
- **Add specialists**: drop a fifth file in `.claude/agents/` (e.g.,
  `accessibility-reviewer.md`, `db-migration-reviewer.md`) and add a
  `Task` call to the orchestrator's Step 3.
- **Disable specialists**: comment out a `Task` call in the
  orchestrator and the corresponding render section in Step 7.

Because Claude Code reloads agent definitions on each run, edits take
effect on the next `@claude review` — no redeploy needed.

## Comparing to the deterministic pr-bot

| Aspect | ctxloom-pr-bot (Docker action) | ctxloom AI review (this) |
|---|---|---|
| Cost per PR | $0 | $0 (Modes 1 & 2 — subscription) / ~$0.10 typical (Mode 3 — API) |
| Runs on | Every PR | Risk-gated or on-demand |
| Output | Risk score, blast radius, reviewer suggestions | Multi-perspective narrative + specific findings with fixes |
| Uses LLM | No | Yes (your session / your seat / your key) |
| Sees code | Yes (in your runner, never leaves) | Yes (via MCP, in your runner or local machine, never leaves) |
| Hallucination risk | None (deterministic) | Mitigated via MCP tool evidence requirements |
| When to use | Always | When you want narrative + multi-specialist analysis |

**They are complementary, not redundant.** The deterministic review
answers *what* changed and *how risky* it is. The AI review answers
*why* and *what to do about it*.

## Troubleshooting

**The orchestrator posts "ctxloom AI review aborted: license required"**
The CI runner needs a valid `CTXLOOM_LICENSE_KEY` secret. The CLI
validates per-invocation in CI mode; no `activate` call is required.
Start a trial via `ctxloom trial` locally and add the resulting key as
a secret.

**Specialists return JSON but the orchestrator says "validation
failed"**
Most common cause: the specialist's output contains commentary
**before** the JSON block. The orchestrator's parser expects a single
```json fenced block. Edit the relevant `.claude/agents/<name>.md` to
strengthen the closing instruction "Output ONLY the JSON block.
Nothing else."

**Auto-trigger from workflow_run never fires**
Check that your deterministic `ctxloom-review.yml` workflow is named
exactly `ctxloom review` (the value of `name:` in the workflow file).
The `claude-review.yml` `workflow_run.workflows` filter must match by
name, not file path.

**Tokens used per run are higher than the table above**
The orchestrator may be falling through to per-file scans without
tier-gating. Open `.claude/agents/security-reviewer.md` and confirm
Step 2 (triage matrix) is being executed — without it, the security
agent re-scans every file as T0.

## Privacy summary

- Your code stays in your CI runner.
- ctxloom MCP runs locally inside the same runner.
- Claude Code Action sends the LLM **only** the tool-call request/response payloads it explicitly asks for — never the full diff or repo.
- Anthropic's data-handling policy applies to the API key you use; see https://www.anthropic.com/api for current terms.

You can pin a specific model version (e.g., `claude-sonnet-4-6`) in
the workflow to guarantee deterministic behavior across runs.
