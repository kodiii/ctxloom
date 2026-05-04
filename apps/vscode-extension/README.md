# ctxloom — Code Context for Code Review (VS Code)

AST + git + graph context, in your editor. Hover risk, blast radius, dead code, MCP bridge for AI assistants.

## Features

- **Hover cards** on imports — risk, top owner, blast count
- **Rules diagnostics** — squiggles in the Problems panel
- **Status bar** — file risk + license state
- **Blast Radius panel** — direct + transitive + historical importers of the active file
- **Code Health panel** — workspace dead code, hub files, communities
- **Code Lens** — top-of-file risk + per-symbol "Copy AI context" (skeletonized, ~92% token reduction)
- **Gutter decorations** — churn heatmap + dead-code marker
- **Rules quick-fixes** — apply suggested refactors
- **MCP bridge** — auto-registers ctxloom as an MCP server for Copilot Chat / Cursor / Continue (VS Code 1.95+)

## Install

**v1 (current): sideload-only.** Download the VSIX from the [GitHub releases page](https://github.com/kodiii/ctxloom/releases) and install via:

- **Command line:** `code --install-extension ctxloom-vscode-X.Y.Z.vsix`
- **GUI:** Extensions panel → `…` menu → "Install from VSIX…"

Works in VS Code, Cursor, Windsurf, VSCodium, and any other VS Code fork.

**Marketplace publish is shipped in v1.1** via lazy CLI download — the extension VSIX is small, and the CLI (~400 MB of tree-sitter grammars, LanceDB native libs, and ML-embedding deps) is fetched on first activation rather than bundled in the VSIX.

## License

7-day free trial, no card required. Activate via `ctxloom: Open Settings` → License section.

## Configuration

Open VS Code Settings (Ctrl+,) and search "ctxloom" for all options. Or use the branded Settings panel: `ctxloom: Open Settings`.

## Manual test plan (run before each release)

1. **Trial flow:** fresh install → `ctxloom: Start Free Trial` → completes in browser → email arrives → paste key → activate. Status bar shows "trial 7d".
2. **Hover:** open a TS file with imports → hover an import string → card shows risk/owner/blast.
3. **Diagnostics:** create a `.ctxloomrc` rule that fails → save a violating file → squiggle appears in Problems panel.
4. **Settings panel:** `ctxloom: Open Settings` → toggle "Hover cards" off → hover stops showing card. Toggle on → resumes.
5. **Code lens "Copy AI context":** hover a function → click `↗ Copy AI context` → paste into Copilot Chat → context renders correctly.
6. **MCP bridge:** install GitHub Copilot. Open Copilot Chat → ask "what's the blast radius of file X?" → Copilot uses ctxloom MCP tool.
7. **License expiry:** set `expiresAt` in `~/.config/ctxloom/license.json` to past → wait 60s → status bar turns red, providers stop firing.
8. **Deactivate:** `ctxloom: Deactivate License` → confirm → license file removed.
