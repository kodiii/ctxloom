# ctxloom — Monetization Strategy

> Webpage-ready content blocks. Each section maps to a landing page / pricing page component.

---

## 1. Positioning Statement

> **ctxloom** gives engineering teams instant structural understanding of any codebase — powered by a persistent knowledge graph, git history intelligence, and an AI-native PR bot.
>
> Free at the core. One license unlocks everything when you need more.

---

## 2. Business Model

**Open core. Single bundle. Zero hosting.**

- Core product is **AGPL-3.0** — free, open source, self-hosted forever
- All Pro/Team features ship **inside the same `ctxloom` package** — no separate installs
- A license key activates the features already present in the binary
- Customers self-host everything — we never touch their servers
- Revenue comes entirely from license sales

**Why this works:**
- Free core = maximum distribution, no barrier to try
- Single package = zero install friction on upgrade — users just activate
- No addon sprawl to maintain or version-align
- Near 100% gross margin — no infra to run
- Similar to Zed, Ghostty, and Warp: one binary, features unlocked by license

---

## 3. Core vs Licensed Features

### Core — Free forever (AGPL-3.0)

`npm install -g ctxloom`

- Local graph indexing + CLI
- AST analysis + dependency graph
- Basic semantic search
- 1 repository
- Community support (GitHub Discussions)

Anyone can use, modify, and self-host. Modifications must be released under AGPL-3.0.

---

### Licensed Features (bundled in core binary)

All features below are **already inside `ctxloom`** — a license key unlocks them.

| Feature | What it does | Available in |
|---------|-------------|--------------|
| PR bot | GitHub PR bot with risk-scored reviews | Pro + Team |
| Git history | Full git history: churn, co-change, ownership maps | Pro + Team |
| Cross-repo analysis | Multi-repo graph + team dashboards | Team |
| IDE extension | VS Code + JetBrains integration | Team |
| Slack + Linear | Workflow integrations | Team |

---

## 4. Pricing Tiers

### Pro — €9.90 / month · €99 / year
_1 seat — save 2 months with annual_

- PR bot with risk-scored reviews on every PR
- Git history analysis: churn, co-change, ownership maps
- 90-day history window
- Unlimited repositories
- Email support

**CTA:** `Buy Pro license →`

---

### Team — €29.90 / month · €299 / year
_Up to 5 seats — save 2 months with annual_

- Everything in Pro
- Cross-repository analysis
- Team dashboards + ownership maps
- Full git history (no window limit)
- VS Code + JetBrains extension
- Slack + Linear integration
- Priority support (24h response)

**CTA:** `Buy Team license →`

---

### Enterprise — Custom pricing

- Air-gapped / offline license (72h validation cache)
- SSO / SAML
- On-premises vector store
- Custom data retention & compliance
- Dedicated SLA + support contract
- Perpetual license option
- Volume discounts at 25, 50, 100+ seats

**CTA:** `Contact us →`

---

## 5. Trial

**7-day free trial — no credit card required**

- Full Pro feature access during trial
- 1 repository limit
- Machine fingerprint limited (one trial per device)
- "Trial — X days remaining" shown in CLI
- Converts to paid on purchase — no reinstall needed

**Trial abuse prevention:**

| Signal | Method | Action |
|--------|--------|--------|
| Same machine | Hardware ID + hostname fingerprint | Hard block |
| Same email | Email deduplication in Creem | Hard block |
| IP pattern abuse | Rate-limit per /24 subnet | Require email verification |

---

## 6. How Licenses Work

### Purchase Flow

1. Customer installs: `npm install -g ctxloom`
2. Runs `ctxloom trial` → Creem issues 7-day trial key (email required, no card)
3. Trial expires → purchase via **Creem.io**
4. License key delivered instantly by email
5. Customer runs `ctxloom activate <LICENSE_KEY>` — done
6. Licensed features unlock automatically — same binary, no reinstall

### What the License Key Encodes

| Field | Description |
|-------|-------------|
| `seats` | Number of concurrent activations |
| `tier` | Features unlocked (`pro` / `team` / `enterprise`) |
| `expiry` | Renewal date |
| `fingerprint` | Machine binding (enterprise node-lock option) |

### Validation Behaviour

| Scenario | Behaviour |
|----------|-----------|
| Online, valid key | Full access |
| Online, expired key | Read-only mode + renewal prompt |
| Offline (air-gapped) | Valid for 72h, then read-only |
| Seat overage | Warning in dashboard, not hard lockout |

---

## 7. Licensing Model

### Core — GNU AGPL-3.0

- Free to use, modify, and self-host
- Modifications must be open-sourced under AGPL-3.0
- Companies embedding ctxloom in a **closed-source product** must contact us for a **commercial license**

### Licensed Features — Proprietary (source-available gating)

- Feature code ships inside the AGPL package but is **license-gated at runtime**
- No separate packages to distribute or version
- Creem.io handles payment + license key generation

### Commercial License (for core)

Companies whose legal team blocks AGPL, or who need to embed the core in a closed-source product, can purchase a commercial license.

- Contact: codzign@gmail.com
- Grants: use without AGPL obligations
- Priced per organisation, not per seat

---

## 8. Distribution Channels

### 8a. Direct via Creem.io (Primary)

- Self-serve for Pro and Team
- Handles global VAT automatically
- Instant license key delivery via email
- Enterprise via contact form → manual quote → Creem invoice

### 8b. GitHub Marketplace (Secondary)

- PR bot feature listed as a paid GitHub App entry point
- 75% revenue share (GitHub keeps 25%)
- Good for top-of-funnel acquisition, lower margin

> **Strategy:** GitHub Marketplace for discovery. Creem.io direct for full license sales.

---

## 9. Unit Economics

### Cost Baseline (monthly)

| Component | Tool | Cost |
|-----------|------|------|
| Payments + licensing | Creem.io | ~$0 fixed + 1–3% txn |
| License delivery email | Resend | $20 |
| Error monitoring | Sentry | $26 |
| Analytics | PostHog | $0–20 |
| Domain + CDN | Cloudflare | ~$2 |
| **Total fixed** | | **~$50–70/mo** |

### Margin per Tier

| Tier | Monthly | Annual | Our cost | Gross margin |
|------|---------|--------|----------|-------------|
| Pro | €9.90/seat | €99/seat | ~€0.30 | ~97% |
| Team | €29.90/mo | €299/mo | ~€0.30 | ~99% |
| Enterprise | Custom | Custom | ~€0 | ~100% |

---

## 10. MRR Model (2% free → paid conversion)

_Assumes 60% buy annual (counted as MRR equivalent), 40% monthly. Team = flat €29.90/mo per account up to 5 seats._

| Free MAU | Paid Users | Pro (80%) | Team (20%) | Est. MRR | vs. Break-even (€70) |
|----------|-----------|-----------|------------|---------|----------------------|
| 200 | 4 | 3 × €9.90 | 1 × €29.90 | ~€60 | -€10 |
| 400 | 8 | 6 × €9.90 | 2 × €29.90 | ~€119 | **+€49 ✓** |
| 1,000 | 20 | 16 × €9.90 | 4 × €29.90 | ~€278 | +€208 |
| 5,000 | 100 | 80 × €9.90 | 20 × €29.90 | ~€1,390 | +€1,320 |
| 20,000 | 400 | 320 × €9.90 | 80 × €29.90 | ~€5,560 | +€5,490 |

> **First milestone: 400 free MAU.** Break-even at ~8 paying users — very achievable.

---

## 11. Additional Revenue Streams (later stage)

| Stream | Description | When to pursue |
|--------|-------------|----------------|
| **API access (usage-based)** | Graph API sold to AI tools, linters, CI systems | After product-market fit |
| **Consulting / onboarding** | $2k–10k setup fee for enterprise | Immediately, on request |
| **Training data licensing** | Anonymised coupling + ownership patterns (opt-in) | At scale, with legal review |

---

## 12. Implementation Stack

| Need | Tool | Why |
|------|------|-----|
| Payments + license issuance | [Creem.io](https://creem.io) | Handles VAT, generates license keys automatically |
| Transactional email | [Resend](https://resend.com) | Key delivery, trial expiry, renewal reminders |
| npm distribution | Public `ctxloom` package | Single binary, features gated by license at runtime |
| Analytics | [PostHog](https://posthog.com) | Funnel + conversion tracking |

---

## 13. Domain & Brand

| Asset | Value |
|-------|-------|
| Primary domain | `ctxloom.com` |
| Developer alias | `ctxloom.dev` (redirects to .com) |
| npm package | `ctxloom` (public, single package) |
| GitHub org | `github.com/ctxloom` |

---

*Last updated: 2026-04-20*
