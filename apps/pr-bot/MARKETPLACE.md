# Marketplace listing — one-time setup

The `ctxloom-pr-bot` GitHub Action is developed in this monorepo at
`apps/pr-bot/`, but consumed by external users (and listed on the GitHub
Marketplace) from a thin **public mirror repo**: `kodiii/ctxloom-pr-bot`.

This split exists because:

- The main `kodiii/ctxloom` repo is private — `uses: kodiii/ctxloom/...`
  cannot resolve from external workflows.
- GitHub Marketplace requires `action.yml` to live at the **root** of the
  source repo, but ours lives at `apps/pr-bot/action.yml` for monorepo
  hygiene.

The mirror is regenerated on every tag by
[`.github/workflows/pr-bot-mirror-release.yml`](../../.github/workflows/pr-bot-mirror-release.yml).
Once the one-time setup below is done, every `v*` tag pushed to the
monorepo automatically:

1. Builds & pushes the Docker image to `ghcr.io/kodiii/ctxloom-pr-bot`
   (handled by [`pr-bot-publish-image.yml`](../../.github/workflows/pr-bot-publish-image.yml)).
2. Copies `action.yml`, `README.md`, and `LICENSE` to
   `kodiii/ctxloom-pr-bot`.
3. Force-pushes the version tag and the floating major (`v1`) tag.
4. Cuts a GitHub Release on the mirror.

## One-time setup

### 1. Create the empty public mirror repo

```bash
gh repo create kodiii/ctxloom-pr-bot \
  --public \
  --description "Risk-scored PR review GitHub Action — local-first, no LLM calls." \
  --homepage "https://ctxloom.com"
```

Initialise it with a single empty commit so the mirror workflow has a
branch to push to:

```bash
git clone https://github.com/kodiii/ctxloom-pr-bot
cd ctxloom-pr-bot
git commit --allow-empty -m "init: mirror placeholder"
git push origin main
cd .. && rm -rf ctxloom-pr-bot
```

### 2. Generate a Personal Access Token for the mirror

The mirror workflow needs write access to a *different* repo than the
one it runs in, so the default `GITHUB_TOKEN` won't work — we need a
PAT.

- Go to <https://github.com/settings/tokens/new>
- **Note:** `ctxloom-pr-bot mirror push`
- **Expiration:** 1 year (renew before expiry)
- **Scope:** `repo` (full control of private repositories — needed to
  push tags and cut releases on the mirror)

Copy the generated token.

### 3. Add the PAT as a secret on the monorepo

- Open <https://github.com/kodiii/ctxloom/settings/secrets/actions>
- Click **New repository secret**
- **Name:** `PR_BOT_MIRROR_TOKEN`
- **Secret:** paste the PAT from step 2
- Save.

### 4. Trigger the first mirror run

Either push a `v*` tag (normal release flow) or fire the workflow
manually:

```bash
gh workflow run pr-bot-mirror-release.yml \
  --repo kodiii/ctxloom \
  --field tag=v1.2.5
```

Watch the run; verify the mirror repo now has `action.yml` + `README.md`
+ a release tagged `v1.2.5` and a floating `v1`.

### 5. List on the GitHub Marketplace

Once the mirror has a release with `action.yml` at its root:

- Open the latest release on `kodiii/ctxloom-pr-bot`.
- Click **Edit** → tick **Publish this Action to the GitHub Marketplace**.
- Accept the Marketplace terms.
- Choose a primary category (**Continuous integration**) and a secondary
  (**Code quality**).
- Save.

The listing will appear at `https://github.com/marketplace/actions/ctxloom-pr-review`.

## Reverting the redirect

Once the Marketplace listing is live, the `uses:` ref in
[`src/setup/install-pr-bot.ts`](../../src/setup/install-pr-bot.ts) and
[`README.md`](./README.md) should be updated from
`kodiii/ctxloom/apps/pr-bot@v1` → `kodiii/ctxloom-pr-bot@v1` so that
freshly-installed workflows resolve against the public mirror.

That's a separate code change (and a coordinated `ctxloom-pro` minor
bump on npm), not part of the mirror infrastructure itself — defer
until after step 5 above is confirmed working.

## Token rotation

`PR_BOT_MIRROR_TOKEN` expires in 1 year. The mirror workflow will fail
loudly (job exits with `::error::PR_BOT_MIRROR_TOKEN secret is not set`)
once that happens. Regenerate the PAT (step 2), update the secret
(step 3) — no other changes needed.
