# Host adapter verification — Phase 0 research

Authoritative source for the `platformRegistry.ts` to be built in Phase 1
(v1.6.0 host coverage + auto-detect). Every entry below was cross-checked
against the vendor's own documentation; results that disagree with the
empirical evidence in `tirth8205/code-review-graph`'s `PLATFORMS` dict
are flagged so we don't replicate their bugs.

Verification date: 2026-05-19. Vendor docs evolve — when adding new
hosts later, re-verify everything in this table.

## Verification tier legend

| Tier | Meaning |
|---|---|
| **A** | Vendor's own current docs explicitly state the path + schema. Safe to ship without an `experimental` flag. |
| **B** | Confirmed via real GitHub-search examples or upstream source code, but vendor docs missing/sparse. Ship with a TODO comment but no `experimental` flag. |
| **C** | Sourced only from `code-review-graph`'s empirical PLATFORMS dict — we couldn't independently verify. Ship behind `experimental: true` until a maintainer or user validates against a real install. |

## Bugs found in code-review-graph's PLATFORMS dict (do NOT copy)

While verifying against current vendor docs, two entries in their registry
are stale or incorrect for current host versions:

| Host | code-review-graph says | Vendor docs say (2026-05) | Impact if we'd copied blindly |
|---|---|---|---|
| **Continue** | `~/.continue/config.json` with `mcpServers` as JSON array | Per-server YAML files in `.continue/mcpServers/<name>.yaml` (workspace) | ctxloom MCP config silently ignored by current Continue |
| **OpenCode** | `<repo>/.opencode.json` with key `mcpServers` | `opencode.json` / `opencode.jsonc` with key `mcp` (NOT `mcpServers`) | ctxloom MCP config silently ignored |

Lesson: verifying first was worth the half-day cost. Two hosts would have shipped broken.

## Registry — 15 hosts

| # | id | Display | Tier | MCP config path | Schema key | Format | Detection | Vendor doc |
|---|---|---|---|---|---|---|---|---|
| 1 | `claude-desktop` | Claude Desktop | A | macOS: `~/Library/Application Support/Claude/claude_desktop_config.json` · Win: `%APPDATA%\Claude\claude_desktop_config.json` | `mcpServers` | JSON object | platform-specific path exists | [modelcontextprotocol.io/quickstart/user](https://modelcontextprotocol.io/quickstart/user) |
| 2 | `claude-code` | Claude Code | A | `<repo>/.mcp.json` | `mcpServers` | JSON object | always-on | Claude Code docs |
| 3 | `cursor` | Cursor | A | `<repo>/.cursor/mcp.json` (project) · `~/.cursor/mcp.json` (user) | `mcpServers` | JSON object | `~/.cursor/` exists | Cursor docs + 1000s of GitHub examples |
| 4 | `windsurf` | Windsurf | A | `~/.codeium/windsurf/mcp_config.json` | `mcpServers` | JSON object | `~/.codeium/windsurf/` exists | [docs.windsurf.com/.../mcp](https://docs.windsurf.com/windsurf/cascade/mcp) |
| 5 | `zed` | Zed | A | `~/.config/zed/settings.json` (Linux/macOS) · `%APPDATA%\Zed\settings.json` (Win) | **`context_servers`** | JSON object | platform-specific path exists | [zed.dev/docs/ai/mcp](https://zed.dev/docs/ai/mcp) |
| 6 | `gemini-cli` | Gemini CLI | A | `<repo>/.gemini/settings.json` (workspace) · `~/.gemini/settings.json` (user) | `mcpServers` | JSON object (`Record<string, MCPServerConfig>`) | `gemini` on PATH OR `~/.gemini/` exists | `google-gemini/gemini-cli` `docs/cli/settings.md` |
| 7 | `codex` | OpenAI Codex CLI | A | `~/.codex/config.toml` (user) · `<repo>/.codex/config.toml` (project) | **`mcp_servers`** (TOML) | TOML | `~/.codex/` exists | [developers.openai.com/codex/config-reference](https://developers.openai.com/codex/config-reference) |
| 8 | `kiro` | Kiro | A | `<repo>/.kiro/settings/mcp.json` (workspace) · `~/.kiro/settings/mcp.json` (user, merged) | `mcpServers` | JSON object | `~/.kiro/` exists | [kiro.dev/docs/mcp/configuration](https://kiro.dev/docs/mcp/configuration/) |
| 9 | `copilot-vscode` | GitHub Copilot (VS Code) | A | `<repo>/.vscode/mcp.json` | **`servers`** (not `mcpServers`) | JSON object | `~/.vscode/` exists OR VS Code on PATH | docs.github.com/.../extending-copilot-chat-with-mcp |
| 10 | `continue` | Continue | **A (corrected)** | **Per-server YAML in `.continue/mcpServers/<name>.yaml`** (workspace) — NOT what code-review-graph's dict says | each YAML file has its own root, `mcpServers:` followed by `- name:` array entry | YAML | `~/.continue/` exists OR Continue VS Code extension installed | [docs.continue.dev/customize/deep-dives/mcp](https://docs.continue.dev/customize/deep-dives/mcp) |
| 11 | `opencode` | OpenCode | **A (corrected)** | `<repo>/opencode.json` or `<repo>/opencode.jsonc` | **`mcp`** (NOT `mcpServers`) | JSON object | `opencode` on PATH OR `opencode.json` exists in repo | [opencode.ai/docs/mcp-servers](https://opencode.ai/docs/mcp-servers/) |
| 12 | `qwen` | Qwen Code | C — **experimental** | `~/.qwen/settings.json` (assumed — vendor docs don't document MCP) | `mcpServers` (assumed) | JSON object (assumed) | `~/.qwen/` exists | code-review-graph empirical only |
| 13 | `qoder` | Qoder | C — **experimental** | `<repo>/.qoder/mcp.json` (assumed) | `mcpServers` (assumed) | JSON object | `~/.qoder/` exists | code-review-graph empirical only |
| 14 | `antigravity` | Google Antigravity | C — **experimental** | `~/.gemini/antigravity/mcp_config.json` (Gemini variant) | `mcpServers` | JSON object | `~/.gemini/antigravity/` exists | code-review-graph empirical only |
| 15 | `copilot-cli` | GitHub Copilot CLI | C — **experimental** | `~/.copilot/mcp-config.json` (assumed) | `servers` (assumed, mirrors VS Code) | JSON object | `~/.copilot/` exists OR `gh copilot` available | docs link present but page unfetched |

## Notes on tier-A hosts

### Cursor (#3)

The empirical evidence is overwhelming — every public repo with a `.cursor/mcp.json`
follows the same schema. Project-local takes precedence over user-global; merged at runtime.

### Zed (#5)

Schema key is `context_servers`, not `mcpServers`. Easy bug to introduce if you assume
all hosts converged on the Anthropic naming. Path is platform-specific:

- macOS / Linux: `~/.config/zed/settings.json`
- Windows: `%APPDATA%\Zed\settings.json`

Use a `zedSettingsPath()` helper.

### Codex CLI (#7)

TOML, not JSON. Section path is `[mcp_servers.<server-name>]` — different parsing.
Plan to use `@iarna/toml` or `smol-toml` (smaller bundle).

### Copilot VS Code (#9)

Schema key is **`servers`**, not `mcpServers`. Project-local lives in
`.vscode/mcp.json`. Likely shared with Copilot CLI (also uses `servers`).

### Continue (#10) — code-review-graph version is stale

Current Continue uses one YAML file per MCP server inside `.continue/mcpServers/`.
The old `~/.continue/config.json` with embedded `mcpServers` array reflects pre-2025
schema. Our adapter writes:

```yaml
# .continue/mcpServers/ctxloom.yaml
name: ctxloom
command: ctxloom
args: []
env:
  CTXLOOM_ROOT: /absolute/path/to/project
```

### OpenCode (#11) — code-review-graph version is wrong

Schema key is `mcp`, not `mcpServers`. The file is `opencode.json` at repo root
(not `.opencode.json`). Also accepts `opencode.jsonc` (with comments).

## Notes on tier-C hosts

### All four (Qwen, Qoder, Antigravity, Copilot CLI)

We have not validated these against a real install. We're shipping with the
config paths sourced from `code-review-graph`'s empirical PLATFORMS dict
because they had access to the products and we don't (yet).

Behavior:

1. Adapter ships with `experimental: true`
2. `ctxloom init --auto` skips experimental hosts by default
3. User opts in with `ctxloom init --auto --include-experimental`
4. CLI prints a warning when an experimental adapter is invoked:

   ```
   ⚠ Installing experimental adapter for <host-name>.
     Config paths are sourced from code-review-graph's empirical
     registry and have not been validated against a current install
     of this host. Report bugs at github.com/kodiii/ctxloom/issues.
   ```

5. Promote to tier-B (and drop the flag) once we or a contributor
   confirms the adapter actually works against a real install.

## Detection model — match code-review-graph's simplicity

After studying their implementation, the right approach is the simple one:

```typescript
type DetectFn = (ctx: { home: string; cwd: string; pathDirs: string[] }) => boolean;
```

One signal per host. Just check if the config directory exists. No
confidence-weighted multi-signal voting. Reasons:

1. **It works in practice** — code-review-graph has 16k stars and we
   haven't seen a single bug report about false positives from their
   simple detection model.
2. **False positives are cheap** — installing into a host the user
   doesn't actually use writes one extra config file. The HMAC drift
   detection means the user can safely ignore it.
3. **False negatives are also cheap** — `ctxloom init --host=<id>`
   is always available as the explicit override.

We can revisit if real users complain. Ship simple first.

## Things NOT covered

- **`.cursorrules` / `CLAUDE.md` / `AGENTS.md` / `GEMINI.md`** — those are
  rules files, a separate layer from the MCP server config. ctxloom already
  writes those today; Phase 1's scope is **per-host MCP config registration**,
  which is what we currently only do for `claude-code`.
- **Hooks** — Claude Code, Cursor, and Gemini CLI each have their own hook
  systems. ctxloom currently writes Claude Code hooks. Adding hooks for
  Cursor and Gemini is a Phase 1.5 extension (not v1.6.0 scope).
- **Skills** — only Claude Code currently. Cursor's "rules" are not
  equivalent. Out of scope.

## Open questions to resolve in Phase 1

1. **Detection precedence** — what if a user has both Claude Desktop and
   Claude Code? Write to both, since they're different products with
   different config files. Document explicitly.
2. **Project-local vs user-global Cursor** — code-review-graph only writes
   to project-local. We should match for consistency (avoids polluting
   user's global config with project-specific paths in `CTXLOOM_ROOT`).
3. **What if user already has an `mcpServers.ctxloom` entry with a
   different `CTXLOOM_ROOT`?** — Same as today's `.mcp.json` logic:
   compare to canonical, update if different, no-op if same, refuse
   on HMAC drift unless `--force`.
4. **Codex CLI TOML — should we hand-edit or use a parser?** — Use a
   parser. Hand-editing TOML inside an existing user-owned config is
   too risky (comments, formatting, key ordering). Adds one dep to
   `@ctxloom/core`; acceptable.
