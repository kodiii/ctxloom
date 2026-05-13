# Telemetry & Privacy

ctxloom collects **anonymous, opt-out telemetry** to understand which
commands and features are useful, and to catch crashes that would
otherwise go unreported. This document is the source of truth for what
is and isn't transmitted, and how to turn it off.

## TL;DR

- **You can opt out at any time.** Set `CTXLOOM_NO_TELEMETRY=1` or the
  cross-tool `DO_NOT_TRACK=1`. Both completely silence the CLI and the
  dashboard server.
- **No file contents, paths, project names, or aliases are ever sent.**
  Project identifiers are SHA-256 hashes of the absolute path —
  irreversible.
- **No personally identifiable information.** The `distinct_id` is a
  random UUID created on first run and stored at `~/.ctxloom/distinct_id`
  (mode `0o600`). It is **not** tied to your email, hostname, IP, or
  license key.
- **Local-first stays local.** Telemetry only describes *which features
  you used*, not *what you used them on*. Your code, queries, and
  results never leave your machine.

## How to control telemetry

### Disable everything

```bash
export CTXLOOM_NO_TELEMETRY=1   # ctxloom-specific
# or
export DO_NOT_TRACK=1           # standard cross-tool env var
```

### Granular: errors only, no usage analytics

```bash
export CTXLOOM_TELEMETRY_LEVEL=error
```

In `error` mode, crash reports still flow to Sentry (so we can fix bugs
that hit you) but no PostHog events are sent. Choose this if you want to
help with stability but not usage analytics.

### Explicitly set "all" (default)

```bash
export CTXLOOM_TELEMETRY_LEVEL=all   # same as the default
```

### Levels summary

| Level   | PostHog events | Sentry errors | Equivalent to                |
| ------- | -------------- | ------------- | ---------------------------- |
| `all`   | ✅              | ✅             | default                      |
| `error` | ❌              | ✅             | —                            |
| `off`   | ❌              | ❌             | `CTXLOOM_NO_TELEMETRY=1`     |

Verify your current setting:

```bash
env | grep -E "CTXLOOM_NO_TELEMETRY|CTXLOOM_TELEMETRY_LEVEL|DO_NOT_TRACK"
```

## What we collect

### Identity

- **`distinct_id`**: a random UUID generated on your first invocation
  and persisted at `~/.ctxloom/distinct_id`. Used by PostHog to
  deduplicate events from the same machine. Replace by deleting the
  file (a fresh UUID is created on next run).
- **`release`**: the ctxloom version (e.g. `1.2.0`) — derived from
  `package.json` at build time.

That's it. No email, no IP-based fingerprinting beyond what PostHog's
backend infers from request headers (and that data is only used for
high-level geo-aggregation, not individual user tracking).

### CLI events (`$lib: 'ctxloom-cli'`)

| Event                       | Fires when                                                      |
| --------------------------- | --------------------------------------------------------------- |
| `trial_started`             | `ctxloom trial` succeeds                                        |
| `license_activated`         | `ctxloom activate <key>` succeeds                               |
| `license_deactivated`       | `ctxloom deactivate` succeeds                                   |
| `license_expired`           | Cached license is past `expiresAt`                              |
| `license_gate_hit`          | A paid command is blocked because there's no active license     |
| `license_revoked`           | Server tells us a previously-valid license has been revoked     |
| `project_resolved`          | A tool dispatch successfully maps `project_root` to a project   |
| `project_first_touch`       | A project is touched for the first time in this CLI process     |
| `project_evicted`           | LRU evicts a project (cap: 5, override via `CTXLOOM_MAX_PROJECTS`) |
| `alias_registered`          | `ctxloom register --alias <name> <path>` succeeds               |
| `multi_project_active`      | ≥2 projects are active in the same CLI process                  |
| `kill_switch_active`        | `CTXLOOM_DISABLE_MULTIPROJECT=1` is set                         |
| `project_resolution_failed` | A tool dispatch's `project_root` can't be resolved              |
| `tool_dispatched`           | A tool is dispatched (**25% sampled** to limit volume)          |

### Dashboard events (`surface: 'dashboard'`)

| Event                   | Fires when                                            |
| ----------------------- | ----------------------------------------------------- |
| `dashboard_loaded`      | Dashboard React app mounts (once per session)         |
| `dashboard_page_viewed` | User navigates to a different route in the dashboard  |

Browser events are POSTed to the local dashboard server's
`/api/telemetry/event` endpoint, which validates them against a hardcoded
2-event allowlist before forwarding to PostHog. The browser never sees
the PostHog write-key and cannot forge `license_*` or `project_*` events.

## What we DON'T collect

- ❌ File contents, source code, search queries, prompts
- ❌ File paths or directory names (in either project or alias form)
- ❌ Project aliases (only their **length**)
- ❌ Git repository URLs or commit messages
- ❌ Your name, email, license key, or hostname
- ❌ Anything from `process.env` beyond the explicit opt-out flags

## How project privacy works

When a multi-project event needs to identify a project, ctxloom hashes
the absolute path:

```
project_id = sha256("/Users/alice/work/secret-project").slice(0, 16)
           → "a3f7b9c2d8e1f042"
```

The result is a 16-character hex string. SHA-256 is one-way: from
`a3f7b9c2d8e1f042` we can't recover `/Users/alice/work/secret-project`,
not even by brute force.

Aliases are similarly opaque — events carry only `alias_length`, never
the alias itself.

## Stack frame scrubbing (Sentry)

Before any stack trace is sent to Sentry, file path prefixes are
replaced:

| Original prefix       | Scrubbed to    |
| --------------------- | -------------- |
| `/Users/<name>/`      | `~/`           |
| `/home/<name>/`       | `~/`           |
| `C:\Users\<name>\`    | `C:\Users\~\`  |

This means a Sentry crash from your machine reads as `~/.../dist/index.js:42`
rather than leaking your username or home layout.

## Backends

We use two backends, both configured to EU regions where applicable:

- **PostHog Cloud (EU)** — `eu.i.posthog.com` — usage analytics
- **Sentry** — error reporting + sourcemap-resolved stack traces

The credentials (PostHog write-key, Sentry DSN) are baked into the
published npm bundle at build time. The open-source repo itself
contains **empty fallbacks**, so building from source produces a
zero-telemetry binary unless you set `CTXLOOM_BUILD_POSTHOG_KEY` and
`CTXLOOM_BUILD_SENTRY_DSN` yourself.

## First-run notice

The very first time you run any ctxloom CLI command, you'll see a short
notice on stderr explaining that telemetry is enabled and how to disable
it. After the first run, a marker is written to
`~/.ctxloom/telemetry_notice_shown` and the notice never appears again.

Delete the marker to re-enable the one-time notice on next run.

## Questions or concerns

Open an issue at <https://github.com/kodiii/ctxloom/issues> tagged
`telemetry` and we'll respond. If you spot a privacy regression — an
event leaking a path, a missing scrub, anything — file it as a bug,
not a feature request.
