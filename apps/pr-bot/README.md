# @ctxloom/pr-bot

A GitHub App that integrates ctxloom's code analysis engine directly into your pull request workflow. Every PR gets an automated, risk-scored review before a human ever looks at it.

## What it does

- Posts a **risk-scored summary comment** on every opened or synchronised PR, showing which files carry the highest blast radius and why
- Leaves **inline review comments** on individual diff hunks that exceed the configured risk threshold, so reviewers know exactly where to focus
- Suggests **reviewers** based on who has touched the highest-risk modules most recently
- Responds to **slash commands** in PR comments: `/ctxloom explain`, `/ctxloom ignore`, `/ctxloom refresh`
- Optionally creates a **Check Run** that blocks merge when the overall PR risk score is above threshold (opt-in via `.ctxloom.yml`)

---

## Install (GitHub Marketplace)

> Marketplace listing coming soon.

In the meantime, install the public app at:
**https://github.com/apps/ctxloom-pr-bot** _(placeholder — replace with your App slug)_

Required permissions when installing:

| Permission | Level |
|---|---|
| Contents | Read |
| Pull requests | Write |
| Checks | Write |
| Metadata | Read |

---

## Self-host

### Prerequisites

- Node.js 20 or Docker
- A GitHub App registered under your account or organisation

### Create your GitHub App

Follow the [GitHub docs — Creating a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app).

Required settings:

- **Webhook URL**: `https://<your-host>/`
- **Webhook secret**: any strong random string — you will use it as `WEBHOOK_SECRET`
- **Permissions** (same as above): Contents: Read, Pull requests: Write, Checks: Write, Metadata: Read
- **Subscribe to events**: Pull request, Issue comment

After creation, generate a private key and note your **App ID**.

### Configure secrets

Three environment variables are required at runtime:

| Variable | Description |
|---|---|
| `APP_ID` | Numeric App ID from the GitHub App settings page |
| `PRIVATE_KEY` | PEM private key (can be base64-encoded for convenience) |
| `WEBHOOK_SECRET` | Webhook secret configured in the GitHub App |

Optional:

| Variable | Description |
|---|---|
| `CTXLOOM_CACHE_DIR` | Override the default cache path (`/var/lib/ctxloom-bot`) |

### Run with Docker

Build the image from the **monorepo root** (the Dockerfile relies on the full workspace):

```bash
# From the repository root
docker build -f apps/pr-bot/Dockerfile -t ctxloom-pr-bot .
```

Run with your secrets passed as environment variables:

```bash
docker run -d \
  --name ctxloom-pr-bot \
  -p 3000:3000 \
  -v ctxloom_data:/var/lib/ctxloom-bot \
  -e APP_ID="<your-app-id>" \
  -e PRIVATE_KEY="<pem-contents-or-base64>" \
  -e WEBHOOK_SECRET="<your-webhook-secret>" \
  ctxloom-pr-bot
```

### Deploy to Fly.io

```bash
# 1. Launch the app (skip initial deploy)
fly launch --no-deploy --config apps/pr-bot/fly.toml

# 2. Set required secrets
fly secrets set \
  APP_ID="<your-app-id>" \
  PRIVATE_KEY="<pem-contents-or-base64>" \
  WEBHOOK_SECRET="<your-webhook-secret>" \
  --config apps/pr-bot/fly.toml

# 3. Deploy
fly deploy --config apps/pr-bot/fly.toml
```

A 10 GB persistent volume (`ctxloom_data`) is created automatically on first deploy and mounted at `/var/lib/ctxloom-bot`.

---

## Configure (`.ctxloom.yml`)

Place a `.ctxloom.yml` file in the root of any repository where the bot is installed to override defaults:

```yaml
# .ctxloom.yml — ctxloom pr-bot configuration
# All fields are optional. Shown values are defaults.

# Minimum risk score (0–1) that triggers inline comments or blocks the check run
risk_threshold: 0.7

# Post inline review comments on high-risk diff hunks
inline_comments: true

# Suggest reviewers based on ownership of high-risk modules
suggested_reviewers: true

# Create a GitHub Check Run (can block merge when risk_threshold is exceeded)
check_run: false

# Glob patterns for files the bot should never comment on
excluded_paths: []
# Example:
# excluded_paths:
#   - "**/*.lock"
#   - "docs/**"

# Maximum number of inline comments to post per PR (avoids comment spam)
max_inline_per_pr: 10
```

---

## Security and privacy

- **No source code leaves the bot host.** All analysis is performed locally by the ctxloom engine. Only file paths and risk scores are included in GitHub API calls.
- **LLM-powered explain** (`/ctxloom explain`) is opt-in and not available until v2. No LLM calls are made in v1.
- **`WEBHOOK_SECRET` is required.** The bot rejects any webhook payload whose signature does not match. Do not deploy without it.
- **Tokens are never logged.** The GitHub installation token used to post comments is redacted from all log output.

---

## Troubleshooting

**Bot fails to start with "missing required environment variable"**

`APP_ID`, `PRIVATE_KEY`, and `WEBHOOK_SECRET` must all be present at startup. Verify they are set in your container environment or Fly secrets (`fly secrets list`).

**Webhook deliveries show a non-2xx response in GitHub**

Open your GitHub App settings, go to **Advanced → Recent Deliveries**, and inspect the response body. A 400 usually means a signature mismatch — double-check that `WEBHOOK_SECRET` matches the value configured in the app. A 500 with a stack trace means an unhandled error; check the bot's logs.

**PR opened but no summary comment posted**

Confirm the bot installation has **Pull requests: Write** permission on the target repository. If the permission was added after installation, ask a repo admin to re-approve the app.

**Permission denied writing to `/var/lib/ctxloom-bot`**

The cache directory must be writable by the Node process. When running with Docker, ensure the volume is mounted with the correct ownership. On Fly.io this is handled automatically. For custom deployments, set `CTXLOOM_CACHE_DIR` to a path the process owns.
