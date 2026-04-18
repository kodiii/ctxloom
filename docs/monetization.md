# ctxloom — Monetization Strategy

> Webpage-ready content blocks. Each section maps to a landing page / pricing page component.

---

## 1. Positioning Statement

> **ctxloom** gives engineering teams instant structural understanding of any codebase — powered by a persistent knowledge graph, git history intelligence, and an AI-native PR bot.
>
> Free and open-source at the core. Powerful paid addons when you need more.

---

## 2. Business Model

**Open core. Addon-based revenue. Zero hosting.**

- Core product is **AGPL-3.0** — free, open source, self-hosted forever
- Paid **addons** are closed source, sold as separate npm packages
- Addons integrate with the core but are independent products — AGPL does not infect them
- Customers self-host everything — we never touch their servers
- Revenue comes entirely from addon license sales

**Why this works:**
- Free core = maximum distribution, no barrier to try
- Addons = natural upgrade path once users see value
- Each addon priced and iterated independently
- Near 100% gross margin — no infra to run
- Same model as Sentry, GitLab, Metabase, and PostHog

---

## 3. Core vs Addons

### Core — Free forever (AGPL-3.0)

`npm install ctxloom`

- Local graph indexing + CLI
- AST analysis + dependency graph
- Basic semantic search
- 1 repository
- Community support (GitHub Discussions)

Anyone can use, modify, and self-host. Modifications must be released under AGPL-3.0.

---

### Paid Addons (Closed Source)

Each addon is a separate npm package, activated by a license key via Keygen.sh.

| Addon | What it does | Price |
|-------|-------------|-------|
| `ctxloom-prbot` | GitHub PR bot with risk-scored reviews | included in Pro |
| `ctxloom-history` | Full git history: churn, co-change, ownership maps | included in Pro |
| `ctxloom-teams` | Cross-repo analysis + team dashboards | included in Team |
| `ctxloom-ide` | VS Code + JetBrains extension | included in Team |
| `ctxloom-integrations` | Slack + Linear integration | included in Team |

---

## 4. Bundled Pricing Tiers

Addons can also be purchased as bundles for convenience:

### Pro — $9.90 / month · $99 / year
_1 seat — save 2 months with annual_

Includes: `ctxloom-prbot` + `ctxloom-history`

- PR bot with risk-scored reviews on every PR
- Git history analysis: churn, co-change, ownership maps
- 90-day history window
- Unlimited repositories
- Email support

**CTA:** `Buy Pro license →`

---

### Team — $19.90 / month · $199 / year
_Up to 5 seats — save 2 months with annual_

Includes: all Pro addons + `ctxloom-teams` + `ctxloom-ide` + `ctxloom-integrations`

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

Includes: all addons + enterprise features

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

- Full addon access during trial
- 1 repository limit
- Machine fingerprint limited (one trial per device)
- "Trial — X days remaining" shown in CLI
- Converts to paid on purchase — no reinstall needed

**Trial abuse prevention:**

| Signal | Method | Action |
|--------|--------|--------|
| Same machine | Hardware ID + hostname fingerprint | Hard block |
| Same email | Email deduplication in Keygen | Hard block |
| IP pattern abuse | Rate-limit per /24 subnet | Require email verification |

---

## 6. How Licenses Work

### Purchase Flow

1. Customer installs core: `npm install ctxloom`
2. Runs `ctxloom trial` → Keygen issues 7-day trial key (email required, no card)
3. Trial expires → purchase via **LemonSqueezy**
4. License key delivered instantly by email
5. Customer runs `ctxloom activate <LICENSE_KEY>` — done
6. Addon packages unlock automatically

### What the License Key Encodes

| Field | Description |
|-------|-------------|
| `seats` | Number of concurrent activations |
| `tier` | Addons unlocked (pro / team / enterprise) |
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

### Addons — Proprietary

- Closed source, distributed as compiled binaries
- Sold via LemonSqueezy + activated via Keygen.sh
- AGPL does not apply — addons are separate products

### Commercial License (for core)

Companies whose legal team blocks AGPL, or who need to embed the core in a closed-source product, can purchase a commercial license.

- Contact: codzign@gmail.com
- Grants: use without AGPL obligations
- Priced per organisation, not per seat

---

## 8. Distribution Channels

### 8a. Direct via LemonSqueezy (Primary)

- Self-serve for Pro and Team bundles
- Handles global VAT automatically
- Instant license key delivery
- Enterprise via contact form → manual quote → LemonSqueezy invoice

### 8b. GitHub Marketplace (Secondary)

- `ctxloom-prbot` listed as a paid GitHub App
- 75% revenue share (GitHub keeps 25%)
- Good for top-of-funnel acquisition, lower margin

> **Strategy:** GitHub Marketplace for discovery. LemonSqueezy direct for full bundle sales.

---

## 9. Unit Economics

### Cost Baseline (monthly)

| Component | Tool | Cost |
|-----------|------|------|
| Payments + licensing | LemonSqueezy + Keygen.sh | ~$30–50 + 5% txn |
| License delivery email | Resend | $20 |
| Error monitoring | Sentry | $26 |
| Analytics | PostHog | $0–20 |
| Domain + CDN | Cloudflare | ~$2 |
| **Total fixed** | | **~$80–120/mo** |

### Margin per Tier

| Tier | Monthly | Annual | Our cost | Gross margin |
|------|---------|--------|----------|-------------|
| Pro | $9.90/seat | $99/seat | ~$0.50 | ~95% |
| Team | $19.90/mo | $199/mo | ~$0.50 | ~97% |
| Enterprise | Custom | Custom | ~$0 | ~100% |

---

## 10. MRR Model (2% free → paid conversion)

_Assumes 60% buy annual (counted as MRR equivalent), 40% monthly. Team = flat $19.90/mo per account up to 5 seats._

| Free MAU | Paid Users | Pro (80%) | Team (20%) | Est. MRR | vs. Break-even ($120) |
|----------|-----------|-----------|------------|---------|----------------------|
| 200 | 4 | 3 × $9.90 | 1 × $19.90 | ~$50 | -$70 |
| 500 | 10 | 8 × $9.90 | 2 × $19.90 | ~$119 | **+$0 ✓** |
| 1,000 | 20 | 16 × $9.90 | 4 × $19.90 | ~$238 | +$118 |
| 5,000 | 100 | 80 × $9.90 | 20 × $19.90 | ~$1,190 | +$1,070 |
| 20,000 | 400 | 320 × $9.90 | 80 × $19.90 | ~$4,752 | +$4,632 |

> **First milestone: 500 free MAU.** Break-even at ~10 paying users — very achievable.

---

## 11. Additional Revenue Streams (later stage)

| Stream | Description | When to pursue |
|--------|-------------|----------------|
| **Per-addon purchases** | Users buy only the addons they need | Now |
| **API access (usage-based)** | Graph API sold to AI tools, linters, CI systems | After product-market fit |
| **Consulting / onboarding** | $2k–10k setup fee for enterprise | Immediately, on request |
| **Training data licensing** | Anonymised coupling + ownership patterns (opt-in) | At scale, with legal review |

---

## 12. Implementation Stack

| Need | Tool | Why |
|------|------|-----|
| Payments + VAT | [LemonSqueezy](https://lemonsqueezy.com) | Handles global VAT, simple API |
| License issuance + validation | [Keygen.sh](https://keygen.sh) | Trial support, machine fingerprinting |
| Transactional email | [Resend](https://resend.com) | Key delivery, trial expiry, renewal reminders |
| npm distribution | Private npm packages (addons) | Compiled output only — no source |
| Analytics | [PostHog](https://posthog.com) | Funnel + conversion tracking |

---

## 13. Domain & Brand

| Asset | Value |
|-------|-------|
| Primary domain | `ctxloom.com` |
| Developer alias | `ctxloom.dev` (redirects to .com) |
| npm package (core) | `ctxloom` (public) |
| npm packages (addons) | `ctxloom-prbot`, `ctxloom-history`, etc. (private) |
| GitHub org | `github.com/ctxloom` |

---

*Last updated: 2026-04-18*
