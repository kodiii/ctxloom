/**
 * suggestedNextSteps.ts — Phase 4c of the agent-harness plan.
 *
 * Builds a "Suggested next steps" section attached to every pr-bot
 * review comment. The section turns the bot's pre-computed risk +
 * impact data into **actionable agent prompts** the PR author can
 * paste into their local Claude Code session.
 *
 * Why this matters: the bot already does the structural pre-fetch
 * (detect_changes / blast_radius / coverage gap analysis). Pre-Phase-4c,
 * that analysis terminated in the review comment — the author saw
 * the findings but had to figure out their own next-step query.
 * Phase 4c closes that gap: every review comment ends in author-
 * specific slash-command suggestions.
 *
 * Recommendation logic (risk-tiered):
 *
 *   - **Always**: `/ctxloom-review-pr <N>` for a local second-opinion review
 *   - **High/medium risk + concrete top file**: `/ctxloom-blast <file>` to
 *     surface transitive dependents the diff doesn't show
 *   - **Untested changes**: `/ctxloom-coverage-gap` scoped to the changed
 *     files to triage missing tests
 *   - **Large diffs** (≥10 files): `/ctxloom-explore` for orientation
 *     before deep-diving
 *
 * Security: every recommendation is built from author-controlled
 * static templates + PR metadata (number, file paths). No user input
 * from the diff itself is echoed. File paths are extracted from
 * `changedFiles` which already passed through the bot's earlier
 * validation pipeline.
 */
import type { ReviewPayload } from './types.js';

/**
 * Single suggested step shown to the PR author. Each renders as a
 * Markdown bullet with the slash command in a code block + a one-line
 * rationale.
 *
 * @public
 */
export interface SuggestedStep {
  /** The slash command, e.g. `/ctxloom-blast packages/core/foo.ts`. */
  command: string;
  /** Short rationale (≤ ~80 chars). Shown after the command. */
  rationale: string;
}

/**
 * Compute the ordered list of next-step suggestions for the PR author.
 * Most-actionable first. Empty array is allowed (no suggestions to
 * make), in which case the section is omitted entirely.
 *
 * @public
 */
export function computeSuggestedSteps(payload: ReviewPayload): SuggestedStep[] {
  const steps: SuggestedStep[] = [];

  // Always: re-review locally. Cheap to suggest; agents take this if
  // they want a second opinion or have time to drill in.
  steps.push({
    command: `/ctxloom-review-pr ${payload.pr.number}`,
    rationale: 'Run the same multi-tier review locally for a second opinion.',
  });

  // Risk-tiered: high/medium with a concrete top file → blast-radius drill.
  const topRiskFile = pickTopRiskFile(payload);
  if (topRiskFile && (payload.riskLabel === 'high' || payload.riskLabel === 'medium')) {
    steps.push({
      command: `/ctxloom-blast ${topRiskFile}`,
      rationale: `Surface transitive dependents of the highest-risk file (${payload.impact.totalImpacted} files in blast radius).`,
    });
  }

  // Coverage gap: if any changed file lacks visible test coverage
  // (importerCount=0 OR a tests_for edge missing). For Phase 4c we
  // approximate "needs coverage check" by checking whether the PR
  // touches multiple files + risk is non-low (proxy: bigger PRs in
  // risky areas tend to be where coverage gaps matter).
  if (payload.changedFiles.length >= 3 && payload.riskLabel !== 'low') {
    steps.push({
      command: '/ctxloom-coverage-gap',
      rationale: 'Triage test-coverage gaps on the changed files (callers + churn-scored).',
    });
  }

  // Large diff: ≥10 files → orient yourself before reviewing each
  // file in detail.
  if (payload.changedFiles.length >= 10) {
    steps.push({
      command: '/ctxloom-explore',
      rationale: 'Architecture overview + communities — orient before reviewing this large diff file-by-file.',
    });
  }

  return steps;
}

/**
 * Choose the changed file most worth a `/ctxloom-blast` drill-down.
 *
 * Heuristic: highest `importerCount` (fan-in) among the changed
 * files. A file many others import is the highest-leverage target
 * for blast-radius analysis. Ties broken by alphabetical order for
 * deterministic output.
 *
 * Returns null when there's no clear "top" file (changedFiles empty
 * or every file has 0 importers).
 */
function pickTopRiskFile(payload: ReviewPayload): string | null {
  if (payload.changedFiles.length === 0) return null;
  const ranked = [...payload.changedFiles].sort((a, b) => {
    const ai = a.importerCount ?? 0;
    const bi = b.importerCount ?? 0;
    if (bi !== ai) return bi - ai;
    // Defensive against test fixtures that omit `path` — also the
    // bot's own ChangedFile shape is structurally typed and we
    // shouldn't crash on a sparsely-populated mock.
    return (a.path ?? '').localeCompare(b.path ?? '');
  });
  const top = ranked[0];
  if (!top.path) return null;
  if ((top.importerCount ?? 0) === 0) return null;
  // v1.5.0 dogfood M1 fix: PR filenames are USER INPUT — a malicious
  // PR can use backticks / angle brackets / newlines in filenames to
  // escape the inline-code span + the wrapping <details> block,
  // injecting arbitrary Markdown/HTML into every review comment. The
  // allowlist regex rejects anything outside a safe charset; this is
  // the cheapest defense vs. trying to escape Markdown perfectly.
  // Git allows broader filenames, but EVERY reasonable PR uses
  // strict-ASCII paths, so the false-positive cost is near zero.
  if (!isSafePathForMarkdown(top.path)) return null;
  return top.path;
}

/**
 * Allowlist regex for file paths safe to interpolate into the Markdown
 * suggested-steps section. Permits ASCII alphanumerics, dot, slash,
 * dash, underscore, plus sign. Rejects:
 *
 *   - Backticks (would break out of inline-code spans)
 *   - Angle brackets (HTML tag injection — \<details\> escape)
 *   - Newlines / carriage returns (would break out of <details>)
 *   - Pipe (Markdown table cell escape)
 *   - Backslash (Markdown escape introducer)
 *   - Whitespace anywhere (paths-with-spaces are rare in ctxloom-relevant repos)
 *
 * Closes M1 from the v1.5.0 dogfood security review.
 *
 * @internal — exported for unit tests
 */
export function isSafePathForMarkdown(p: string): boolean {
  if (typeof p !== 'string' || p.length === 0 || p.length > 500) return false;
  if (!/^[A-Za-z0-9._/\-+]+$/.test(p)) return false;
  // Defense in depth: reject `..` segments. The bot doesn't read the
  // file, so a traversal-shaped path can't open `/etc/passwd` here —
  // but echoing one into a public review comment is still confusing
  // for the user. Reject as a hygiene measure.
  if (p.split('/').includes('..')) return false;
  return true;
}

/**
 * Render the suggested-steps section as a Markdown block. Returns
 * empty string when there are no suggestions (caller omits the
 * section entirely).
 *
 * The output is wrapped in a `<details>` block — non-intrusive when
 * collapsed, full guidance when expanded.
 *
 * @public
 */
export function renderSuggestedStepsSection(steps: ReadonlyArray<SuggestedStep>): string {
  if (steps.length === 0) return '';

  const bullets = steps
    .map((s) => `  - \`${s.command}\` — ${s.rationale}`)
    .join('\n');

  return (
    '\n\n<details>\n<summary>💡 Suggested next steps (paste into your local Claude Code)</summary>\n\n' +
    bullets +
    '\n\n_These slash commands are installed by `ctxloom init`. ' +
    'Each opens a guided workflow that orchestrates the ctxloom MCP tools for you._\n' +
    '</details>'
  );
}
