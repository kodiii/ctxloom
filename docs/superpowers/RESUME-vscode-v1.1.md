# Resume VS Code extension v1.1 implementation

> Self-contained kickoff prompt for a fresh Claude Code session. Paste the entire body of this file (or the section between the `===` markers) as the first message of the new session.

==============================================================================

I'm resuming an in-progress implementation of the **ctxloom VS Code extension v1.1 — CLI lazy-download**. Context, plan, and methodology below — please pick up where the previous session left off.

## Repo & branch

- **Working dir:** `/Users/ricardoribeiro/GitHub/contextmesh`
- **Branch:** `feat/vscode-extension-v1.1-lazy-cli` (push to it; do NOT branch off again)
- **Base:** `main` at commit `5446242` (PR #13 merged — the v1 sideload-only ship)

Verify state with:
```bash
git -C /Users/ricardoribeiro/GitHub/contextmesh status --short
git -C /Users/ricardoribeiro/GitHub/contextmesh log --oneline main..HEAD | head
git -C /Users/ricardoribeiro/GitHub/contextmesh branch --show-current
```

You should be on `feat/vscode-extension-v1.1-lazy-cli` with two doc commits (spec + plan) on top of main. Ahead-of-main count tells you how many tasks have already been implemented:

- 0 ahead of docs (just spec + plan): start at Task 1
- N ahead: count Task implementation commits since `84c5a49` (the plan commit) and start at Task N+1

## Goal

Drop the v1 VSIX from 108 MB → ~5 MB by replacing the bundled `ctxloom-pro` with a first-run lazy-download from GitHub Releases. Unblocks Marketplace + OpenVSX publishing.

## Reference docs (read both before starting)

- **Spec:** `docs/superpowers/specs/2026-04-27-vscode-extension-v1.1-lazy-cli-design.md`
- **Plan:** `docs/superpowers/plans/2026-04-27-vscode-extension-v1.1-lazy-cli.md` (14 tasks, 5 phases — read this in full)

## Locked design decisions (from brainstorming, do not relitigate)

| Area | Decision |
|---|---|
| CLI source | GitHub Releases (free CDN, signed by GitHub) |
| Versioning | Pinned `ctxloomCliVersion` field in extension manifest; decoupled `cli-v*` and `vscode-v*` release tag families |
| Download UX | Blocking modal + `withProgress` notification (Cody/Copilot pattern) |
| Integrity | SHA-256 checksum sidecar |
| Platforms | darwin-arm64, darwin-x64, linux-x64, linux-arm64 (Windows in v1.2) |

## Methodology — subagent-driven-development

Use the `superpowers:subagent-driven-development` skill. The harness:

1. For each plan task: dispatch an implementer subagent with the full task text from the plan (don't ask the subagent to read the plan — paste the task verbatim).
2. After implementer reports DONE: dispatch a spec compliance reviewer (haiku is fine for mechanical TDD tasks).
3. After spec compliance ✅: dispatch a code quality reviewer (use `typescript-reviewer` subagent type with haiku).
4. If reviewers find issues: re-dispatch the implementer with the specific fixes, then re-review.
5. Mark task complete in TodoWrite. Move to next task.

**Model selection:** haiku for mechanical TDD tasks (most of them), sonnet for tasks involving real product judgment or multi-file integration (Tasks 7, 9, 13). The plan flags complexity per task.

**Batching:** Tasks 8+9 (status-bar + commands) and Tasks 11+12 (workflow files) can be batched into one dispatch each — they share file context and the implementer benefits from seeing both. v1 work proved this pattern reliable. Don't batch more than 2-3 closely-related tasks at once.

**Push checkpoint after each phase** so context loss / interruption doesn't lose progress:
```bash
git push origin feat/vscode-extension-v1.1-lazy-cli
```

## Patterns and gotchas learned in v1 (apply to v1.1)

These bit me in the v1 build, fixed in PR #13's later commits — heads-up:

1. **`@ctxloom/core` and `@ctxloom/mcp-client` are ESM-only.** The extension is CJS (`"type": "commonjs"`). Use `await import('@ctxloom/core')` (dynamic import), NOT static `import`. Both packages are in esbuild's `external` array (already configured in v1).

2. **VS Code extension `name` cannot have `@` or `/`.** The workspace package is named `ctxloom-vscode` (not `@ctxloom/vscode-extension`). Don't rename it.

3. **Vitest 3 + Node 20 + macOS CI** can flag rejection-handler timing as unhandled even when the test does handle the rejection. If a `Promise.race` + fake-timer test fails on macOS only with "Unhandled Rejection", attach the rejection assertion (`expect(promise).rejects.toThrow(...)`) BEFORE advancing fake timers. See PR #13 commit `96e1ead` for the exact pattern.

4. **`tsconfig.json` rootDir was removed in v1** to allow tests under `tests/` to type-check. Don't re-add `rootDir`.

5. **`tsc --outDir out --noEmit false --declaration false --declarationMap false`** is the integration-test compile step — it lives in the `test:integration` npm script. Don't change its flags.

6. **VS Code MCP API is feature-detected at runtime** in `src/providers/McpBridge.ts` — that pattern is unchanged for v1.1 but be aware.

7. **`startServer` failures must be non-fatal to activation** (PR #13 commit `a75aac9`). The plan's Task 7 already has try/catch around the spawn; preserve that. License commands and Settings panel must still register if the CLI download fails or is skipped.

8. **`@vscode/test-electron` runs from `out/` not `src/`** — when you reference paths in integration tests, remember they're compiled and run as JS, not TS.

9. **`prepare-bundle.mjs` (the no-op stub)** lives at `apps/vscode-extension/scripts/prepare-bundle.mjs`. Plan Task 10 deletes it — `git rm` instead of just rewriting.

10. **VSIX size warnings:** v1 produced a 108 MB VSIX; v1.1 should produce ~3 MB. If you see anything > 10 MB after Task 10, something's wrong — the `resources/ctxloom-cli/` directory or the `dist-cli/` artifacts may have leaked into the package.

## How to launch the first task

```text
Read the plan file:
- docs/superpowers/plans/2026-04-27-vscode-extension-v1.1-lazy-cli.md

Look up Task N (where N = ahead-of-main count − 2, since the first 2 commits are docs).

Dispatch the implementer subagent with the implementer-prompt.md template from
the superpowers:subagent-driven-development skill. The prompt should:
- Set the context: "You are implementing Task N of the v1.1 plan…"
- Paste the FULL Task N text from the plan (steps + code blocks verbatim)
- Reference the plan path so the subagent knows where to look if context expands
- State: "Work from /Users/ricardoribeiro/GitHub/contextmesh"
- Specify: "Strict TDD: write failing tests, confirm failures, implement,
  confirm passing, commit with the exact message specified."
- Set the report format: status / TDD evidence / commit SHA / concerns
```

After the implementer reports, run lint + tests yourself locally to verify:
```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npm run lint --workspace=ctxloom-vscode
cd /Users/ricardoribeiro/GitHub/contextmesh/apps/vscode-extension && npx vitest run tests/unit/
```

Then dispatch the spec compliance reviewer with the spec-reviewer-prompt.md
template, then the code quality reviewer with the typescript-reviewer subagent type.

## When all 14 tasks are complete

1. Push the branch: `git push origin feat/vscode-extension-v1.1-lazy-cli`
2. Open PR with title `feat: VS Code extension v1.1 — CLI lazy-download` (full body in plan's "Final verification" section)
3. Note: smoke test (Task 14) requires a `cli-v0.0.0-test` GitHub Release tag with a fixture tarball uploaded — that's a one-time release-prep step the user owns, not part of implementation. Smoke test will fail until that release exists.
4. After CI passes and PR is merged, advise the user that publishing flow is:
   - Tag `cli-v1.0.5` to publish per-platform tarballs to GitHub Releases
   - Tag `vscode-v1.1.0` to publish the small VSIX to Marketplace + OpenVSX

## What to NOT do

- Do not start work without reading the plan file in full.
- Do not deviate from the locked design decisions (top of this doc).
- Do not skip review steps even on small tasks — the cumulative cost of a review pass is small; the cost of a missed regression is large.
- Do not attempt the smoke test (Task 14) end-to-end unless the user has confirmed `cli-v0.0.0-test` is published. Implement it; don't expect it to pass.

==============================================================================
