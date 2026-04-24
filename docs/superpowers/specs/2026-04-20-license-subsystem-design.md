# ctxloom License Subsystem — Design

**Status:** Draft for review
**Author:** Ricardo Ribeiro + Claude
**Date:** 2026-04-20
**Scope:** Subsystem B of the monetization rollout (License CLI + Feature Gating + Backend Proxy)

---

## 1. Overview & Goals

Build a license subsystem inside `@codzign/ctxloom` that gates the entire CLI behind a 7-day trial or a paid license purchased via Creem.io. No free tier — the CLI is unusable without an active trial or paid license.

### Success criteria

- First-run UX: install → prompted to start trial → enter email → 7 days of full access
- Post-trial: `ctxloom activate <KEY>` from purchase email → full access restored, same binary, no reinstall
- Offline tolerance: 72h grace after last successful validation, then hard block
- Seat enforcement happens **server-side** in Creem (Pro = 1 machine, Team = 3 machines per key)
- One architectural check in code — `license.isActive()` — works for every command, existing and future

### Non-goals for v1

- No read-only grace mode (add later if enterprise asks)
- No per-feature capability matrix (one gate, not many)
- No offline activation flow (online-required for initial activation)
- No license management dashboard in the CLI (Creem handles billing portal)
- No team invitation flow (teammates share the key manually in v1)
- No SSO / SAML (enterprise-tier v2)

### Prerequisite (tracked separately, not blocking the code work)

Migrate the `ctxloom` package from `AGPL-3.0` to a proprietary/source-available license before public launch. The current AGPL grant legally permits free use by anyone who complies with its terms.

---

## 2. Architecture

Two deliverables:

- **B1 — `api.ctxloom.com` Cloudflare Worker.** ~150 lines, new repo `github.com/codzign/ctxloom-api`. Stateless except a KV namespace for trial dedup. Holds the Creem merchant API key as a Worker secret.
- **B2 — `src/license/` in the CLI.** License module inside the existing `@codzign/ctxloom` package.

### Why the Worker exists

Creem's license API requires `x-api-key` auth with the **merchant secret**. Shipping that key inside the CLI binary would let anyone extract it and issue themselves free licenses or refund transactions. The Worker holds the secret server-side and exposes unauthenticated public endpoints (license key itself serves as the credential on validate/activate).

### Module layout — new code under `src/license/` in the CLI

```
src/license/
  index.ts              # public API: isActive, requireActive, activate, startTrial, deactivate, status
  LicenseStore.ts       # read/write ~/.ctxloom/license.json
  ApiClient.ts          # HTTPS calls to api.ctxloom.com (activate, validate, trial, deactivate)
  Fingerprint.ts        # stable machine hash (hostname + machine-id + OS user)
  TrialManager.ts       # trial issuance + expiry logic
  ExpiryWarning.ts      # 7/3-day banner printer
  errors.ts             # LicenseRequiredError, SeatLimitError, NetworkError, InvalidKeyError
  types.ts              # License, TrialState, ValidationResult
```

### Data flow — activation

```
CLI (B2)                        Worker (B1)                   Creem
  ctxloom activate <KEY>
    ↓
  Fingerprint.compute()
    ↓
  ApiClient.activate()  ─POST /v1/license/activate→
                                     ↓
                             x-api-key: CREEM_KEY (secret)
                          ──POST /v1/licenses/activate→
                                     ↓
                          ←──── license payload ─────────
                                     ↓
  ←──── normalized response ────
    ↓
  LicenseStore.write()
```

### Runtime flow (every CLI invocation)

```
src/index.ts entry
    ↓
license.requireActive()
    ├── reads ~/.ctxloom/license.json
    ├── if valid + within revalidation window (7 days) → pass
    ├── if valid + expired cache → ApiClient.validate() → refresh → pass
    ├── if network fails + within 72h grace → pass with warning
    ├── if expired/missing/grace-exhausted → throw LicenseRequiredError
    └── on success: ExpiryWarning.maybePrint() (7/3-day banners)
    ↓
command handler runs (index, setup, rules, etc.)
```

### Design principles

- **One facade**: the rest of the CLI only imports from `src/license/index.ts`. Everything else is internal.
- **One grep tells you the gate**: `requireActive` / `isActive` is the only way to check licensing.
- **All network code isolated** in `ApiClient.ts` — one file to mock in tests, one file to swap if we change backend shape.
- **`Fingerprint` is its own module** because it's the trickiest cross-platform piece and deserves focused testing.
- **No global singleton** — facade reads from disk on demand (~1ms). Tests don't need state reset.

---

## 3. License File Format & Validation State

### File

**Path:** `~/.ctxloom/license.json`
**Permissions:** `0600` on Unix (owner read/write only)

```json
{
  "schemaVersion": 1,
  "key": "ctxl_live_abc123...",
  "tier": "pro" | "team" | "enterprise" | "trial",
  "status": "active" | "trialing" | "expired",
  "email": "user@example.com",
  "fingerprint": "sha256:3f2a...",
  "seats": 1,
  "issuedAt": "2026-04-20T12:00:00Z",
  "expiresAt": "2027-04-20T12:00:00Z",
  "lastValidatedAt": "2026-04-20T12:00:00Z",
  "creemLicenseId": "lic_xyz789",
  "creemInstanceId": "inst_abc"
}
```

A Zod schema validates every read. Corrupted or tampered files are rejected and trigger a re-activation prompt rather than crashing.

### Validation state machine

`license.isActive()` returns `true` iff:

| Condition | Result |
|-----------|--------|
| File missing | `false` — prompt trial or activate |
| File invalid/corrupt | `false` — same prompt |
| `expiresAt` in the past | `false` — expired prompt |
| `lastValidatedAt` within 7 days | `true` — fast path, no network |
| `lastValidatedAt` > 7 days, network OK, backend confirms | `true` — refresh `lastValidatedAt` |
| `lastValidatedAt` > 7 days, network fails, within 72h grace | `true` + warning banner |
| `lastValidatedAt` > 7 days + 72h grace exhausted | `false` — "reconnect to validate" |
| Backend returns `license_revoked` or `seat_limit_exceeded` | `false` — specific error |

### Two time windows

- **Revalidation interval: 7 days.** How often the CLI checks in with the backend. Keeps the CLI fast (no network on every command) while catching revoked/cancelled licenses within a week.
- **Offline grace: 72h past revalidation.** If the backend is unreachable after the 7-day mark, user keeps working for 3 more days with a warning. After that, hard block until network returns.

**Combined quiet window: ~10 days** — covers reasonable offline travel without punishing legitimate use.

### Banner cadence (independent of validation)

- `expiresAt - 7d` → yellow warning on every command
- `expiresAt - 3d` → red warning
- `expiresAt` passed → hard block

---

## 4. ctxloom Worker API (B1)

**Base URL:** `https://api.ctxloom.com/v1`
**Auth:** none. The license key itself is the credential on validate/activate/deactivate. Trial endpoint is rate-limited per IP via Cloudflare-native rate limiting.

### 4.1 `POST /license/activate`

```json
Request:
{
  "key": "ctxl_live_abc123",
  "fingerprint": "sha256:3f2a...",
  "hostname": "rrs-macbook",
  "platform": "darwin-arm64"
}

Response 200:
{
  "license_id": "lic_xyz",
  "tier": "pro",
  "seats_used": 1,
  "seats_total": 1,
  "expires_at": "2027-04-20T12:00:00Z",
  "instance_id": "inst_abc"
}

Response 409:
{ "error": "seat_limit_exceeded" }
{ "error": "invalid_key" }
{ "error": "license_revoked" }
```

**Worker internally:** `POST https://api.creem.io/v1/licenses/activate` with `instance_name = fingerprint`. Creem's `activation_limit` enforces the seat cap server-side.

### 4.2 `POST /license/validate`

Called at 7-day revalidation and by CI env var flow.

```json
Request:  { "key": "ctxl_live_abc", "instance_id": "inst_abc" }
Response 200: { "status": "active" | "expired" | "revoked", "expires_at": "..." }
```

**Worker internally:** `POST https://api.creem.io/v1/licenses/validate`.

### 4.3 `POST /license/deactivate`

```json
Request:  { "key": "ctxl_live_abc", "instance_id": "inst_abc" }
Response 200: { "status": "deactivated" }
```

**Worker internally:** `POST https://api.creem.io/v1/licenses/deactivate`.

### 4.4 `POST /trial/start`

```json
Request:
{ "email": "user@example.com", "fingerprint": "sha256:..." }

Response 200:
{
  "key": "ctxl_trial_abc",
  "expires_at": "2026-04-27T12:00:00Z",
  "instance_id": "inst_trial_xyz"
}

Response 409:
{ "error": "fingerprint_already_used" }
{ "error": "email_already_used" }
```

**Worker internally:**

1. Check KV: `fp:<fingerprint>` and `em:<email>` — return 409 if either exists
2. Call Creem to create a license for the "Trial" product SKU with `expires_at = now + 7d`, `activation_limit = 1`
3. Activate it immediately with `instance_name = fingerprint`
4. Write `fp:<fingerprint> = { email, expires_at }` and `em:<email> = { fingerprint, expires_at }` to KV with TTL of 30 days (users can't re-trial immediately after expiry)
5. Send the trial key via Resend
6. Return the key to the CLI

### 4.5 `GET /healthz`

Unauthenticated health check. Returns `200 { ok: true }`. Pinged once on CLI install; if 503, CLI shows "license system unavailable, please try later" rather than crashing.

### Worker implementation

- Hono framework, TypeScript
- `wrangler deploy` to `api.ctxloom.com`
- Secrets set via `wrangler secret put CREEM_API_KEY` and `wrangler secret put RESEND_API_KEY`
- KV namespace `TRIAL_DEDUP` bound via `wrangler.toml`
- Zod schema validation at every endpoint
- Structured logs to Cloudflare's default sink

### Failure modes

| Scenario | Worker behavior | CLI behavior |
|----------|----------------|--------------|
| Creem 5xx | Retry 2× with backoff, else return 503 | Retry then hit offline grace path |
| Creem 4xx | Pass through normalized error | Show user-actionable message |
| Worker itself down | — | CLI falls into 72h grace window using cached license |
| CLI network fails | — | Same 72h grace |

---

## 5. CLI Commands & UX

Three new commands, one modified entry path.

### 5.1 `ctxloom trial`

```
$ ctxloom trial
Start your 7-day free trial — no credit card required.
Email: user@example.com
⏳ Requesting trial key...
✓ Trial active until 2026-04-27 (7 days remaining)
  Your trial key has been emailed to user@example.com for your records.
  Run `ctxloom status` anytime to check.
```

Failure cases:

```
✗ A trial has already been used on this machine.
  Purchase a license at https://ctxloom.com/pricing
```
```
✗ A trial has already been used for this email address.
  Purchase a license at https://ctxloom.com/pricing
```

### 5.2 `ctxloom activate <KEY>`

```
$ ctxloom activate ctxl_live_abc123
⏳ Activating on this machine...
✓ ctxloom Pro activated (1 of 1 seats used)
  Expires: 2027-04-20
```

Failure cases:

```
✗ Seat limit reached (1 of 1 used).
  Deactivate another machine: https://ctxloom.com/account/licenses
  Or upgrade to Team: https://ctxloom.com/pricing
```
```
✗ Invalid license key. Double-check the key from your purchase email.
```

### 5.3 `ctxloom deactivate`

```
$ ctxloom deactivate
⏳ Releasing this seat...
✓ Deactivated. Run `ctxloom activate <KEY>` on a new machine.
```

Hits `POST /license/deactivate` on the Worker, clears `~/.ctxloom/license.json`.

### 5.4 `ctxloom status`

```
$ ctxloom status
Tier:       Pro
Status:     Active
Email:      user@example.com
Expires:    2027-04-20 (in 365 days)
Machine:    rrs-macbook (darwin-arm64)
Last check: 2 hours ago
```

Trial:

```
$ ctxloom status
Tier:       Trial
Status:     Trialing
Expires:    2026-04-27 (⚠ in 3 days)
```

### 5.5 Modified: all existing commands

Every command enters through `license.requireActive()` first. If no license:

```
$ ctxloom index
ctxloom requires an active license.

  Start a free 7-day trial:   ctxloom trial
  Activate a purchased key:   ctxloom activate <KEY>
  Buy a license:              https://ctxloom.com/pricing
```

Exit code `2` (distinguishes license gate from general errors exit `1`).

### 5.6 Warning banner integration

Printed to **stderr** before the command runs, when inside the warning window:

```
⚠ Your ctxloom license expires in 3 days (2026-04-23).
  Renew: https://ctxloom.com/account/renew

[normal command output follows on stdout]
```

stderr keeps stdout clean for piping (`ctxloom index | jq ...` still works).

### 5.7 Commands that bypass the gate

Only four commands run without requiring an active license:

- `ctxloom trial`
- `ctxloom activate`
- `ctxloom status`
- `ctxloom --help` / `-h`

Everything else — `index`, `setup`, `rules`, MCP `server` default — goes through the gate.

### 5.8 First-run UX

When a user installs and runs anything before activating:

```
$ ctxloom index
Welcome to ctxloom! You don't have an active license yet.

Start a free 7-day trial (no credit card):
  ctxloom trial

Already purchased? Activate your key:
  ctxloom activate <KEY>
```

We do not auto-prompt for trial email on first run — that is a bad UX for scripted/CI contexts where stdin is not a TTY. Users explicitly run `ctxloom trial` when ready.

### 5.9 CI env var

```bash
CTXLOOM_LICENSE_KEY=ctxl_live_abc123 ctxloom index
```

When `CTXLOOM_LICENSE_KEY` is set:

- Skip `~/.ctxloom/license.json` entirely
- Call `POST /license/validate` with `{ key, instance_id: "ci-ephemeral" }` on every invocation (CLI is short-lived; no in-process cache meaningful)
- Rate-limited per license on the Worker side (60 validations/hour per key — enough for CI, not enough for mass abuse)
- No machine fingerprint, no local storage, stateless by design

### 5.10 Emergency bypass

`CTXLOOM_LICENSE_BYPASS=1` disables all license checks. Compiled into the binary but **not documented publicly** — only for our own support use when something breaks catastrophically. Removable after the first three months if no incidents.

---

## 6. Testing Strategy

### 6.1 Unit tests (Vitest, in-process) — `src/license/`

- `Fingerprint.ts` — stable across runs, different across machines (mock `os.hostname`, `os.userInfo`, `/etc/machine-id`)
- `LicenseStore.ts` — read/write round-trip, corrupt file rejection, missing file handling, file perms 600 on Unix
- `TrialManager.ts` — expiry math, timezone handling, revalidation window calc
- `ExpiryWarning.ts` — banner triggers at day -7, -3, not outside window
- **Central state machine table test** — every row in the `isActive()` table gets one test case. Highest-value test file; regressions here equal revenue loss.

### 6.2 Integration tests — `tests/license/`

- `ApiClient` against a mocked Worker (MSW or nock). Cover: 200 happy path, 409 seat limit, 409 invalid key, 5xx retry, network timeout, 72h grace path.
- CLI command wiring by spawning `node dist/index.js <cmd>` in a tmpdir with `HOME` pointed at the tmpdir — tests the real entry flow end-to-end.

### 6.3 Worker tests (separate repo `ctxloom-api`)

- Unit tests with `@cloudflare/vitest-pool-workers` for all 4 endpoints + `/healthz`
- Integration test hitting Creem's sandbox (`https://test-api.creem.io`) with a test API key in CI secrets
- KV dedup logic: same fingerprint → 409, same email → 409, TTL expiry → allows re-trial

### 6.4 Manual QA checklist (pre-launch)

- [ ] Install on fresh machine → `ctxloom trial` → works for 7 days → expires → hard block
- [ ] `ctxloom activate` with real Creem key → works → `ctxloom deactivate` → re-activates on 2nd machine
- [ ] Pro key on 2nd machine without deactivating → seat limit error
- [ ] Airplane mode for 70h → still works; airplane mode for 80h → hard block
- [ ] CI env var on GitHub Actions runner → validates correctly
- [ ] Corrupt license file → re-activation prompt, no crash

---

## 7. Implementation Phases

### Phase 1 — Worker (B1), ~1 day

1. New repo `github.com/codzign/ctxloom-api`
2. Hono + Wrangler + Zod + Creem SDK + Resend
3. Four endpoints (activate, validate, deactivate, trial/start) + `/healthz`
4. KV namespace for trial dedup
5. `wrangler deploy` to `api.ctxloom.com`
6. Integration test against Creem sandbox

**Acceptance:** `curl`-able endpoints return expected shapes. Trial email lands in inbox.

### Phase 2 — CLI license module (B2), ~2 days

1. `src/license/` scaffolded — types, store, fingerprint, API client
2. Unit tests for store, fingerprint, state machine
3. `requireActive()` facade
4. Zod schema for license file

**Acceptance:** `license.isActive()` returns correct booleans across all state-machine rows.

### Phase 3 — CLI commands, ~1 day

1. Wire `trial`, `activate`, `deactivate`, `status` commands into `src/index.ts`
2. Gate all existing commands with `requireActive()`
3. Warning banner on stderr
4. Exit code 2 for license gate failures
5. CI env var path

**Acceptance:** manual QA checklist passes.

### Phase 4 — Production hardening, ~1 day

1. AGPL → proprietary license change on `package.json` + `LICENSE` file
2. Sentry integration for Worker + CLI license errors
3. README "Getting started" rewrite
4. Monetization doc correction (Team = 3 machines, single-tier gating already captured)
5. Analytics: PostHog events on trial start, activate, expire

**Acceptance:** ready to publish to npm + flip DNS on `api.ctxloom.com`.

**Total: ~5 days of focused work.**

---

## 8. Rollout & Kill Switches

- **Feature flag before launch:** Worker `/healthz` endpoint. CLI pings it once on install. If Worker 503s, CLI degrades gracefully rather than crashing during postinstall.
- **Revocation path:** Creem dashboard → mark license revoked → next CLI validation returns `revoked` → hard block. Time-to-kill: ≤7 days (revalidation interval) or instant if user runs `ctxloom status`.
- **Emergency bypass env var:** `CTXLOOM_LICENSE_BYPASS=1` compiled in but undocumented. Internal support use only.

---

## 9. Open Follow-ups (explicit, not blocking v1)

- Update `docs/monetization.md` to correct Team seat count from 5 → 3 and re-confirm single-tier gating (addressed at spec commit time).
- AGPL → proprietary license migration (Phase 4).
- Decide on read-only grace mode if enterprise customers request it.
- Offline activation for air-gapped enterprise (signed license file flow).
- Team invitation flow — automated teammate onboarding vs manual key sharing.
- PostHog event schema — define event names and properties for funnel tracking.

---

*Last updated: 2026-04-20*
