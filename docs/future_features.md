# ctxloom — Future Paid Addons

> Brainstorm backlog. Each item is a candidate paid addon to develop and sell alongside the AGPL core.

---

## Tier 1 — High impact, builds directly on existing graph + git data

| Addon | What it solves | Why people pay |
|-------|---------------|----------------|
| **Web Dashboard** | Visual UI for churn heatmaps, ownership maps, coupling graphs, debt trends over time | Managers + leads need this — they don't use CLI |
| **IDE Extension** (VS Code + JetBrains) | Inline risk scores, ownership, blast radius while coding — before the PR | Devs want context without leaving the editor |
| **Architecture Rules Engine** | Define rules ("module A must not import B"), get CI alerts on violations | Like ArchUnit but for any language — compliance teams love this |
| **Auto Reviewer Assignment** | Replace static CODEOWNERS with dynamic assignment from ownership index | Every team with 5+ devs has this problem |

---

## Tier 2 — High value, slightly more build effort

| Addon | What it solves | Why people pay |
|-------|---------------|----------------|
| **Release Risk Scorer** | Given a list of PRs in a release, score combined blast radius + churn risk | Engineering managers before every deploy |
| **Incident Response Tool** | Paste a failing file → instantly get owners, recent changers, co-changed files | On-call engineers at 2am |
| **Onboarding Assistant** | Auto-generate "new hire guide" — which files to read first, who to ask | Eng managers onboarding new hires |
| **Slack / Linear / Jira Integration** | Push risk alerts and ownership context into where teams already work | Removes the "check another tool" friction |

---

## Tier 3 — Longer term, high ceiling

| Addon | What it solves |
|-------|---------------|
| **Microservices Mapper** | Cross-repo visual dependency map for distributed teams |
| **Dependency Bump Risk Scorer** | When upgrading a library, show affected files + their risk scores |
| **AI-grounded Code Review** | LLM reviews grounded in actual graph context, not just file diffs |

---

## Priority picks (revisit when ready to build)

1. **Web Dashboard** — biggest unlock for non-CLI users, massive perceived value
2. **IDE Extension** — daily driver, highest retention, hard to churn from
3. **Architecture Rules Engine** — enterprise buyers love compliance tooling, easy to charge more

---

*Last updated: 2026-04-18*
