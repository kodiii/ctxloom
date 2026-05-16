#!/usr/bin/env bash
# Install ctxloom review agents for LOCAL use (Claude Desktop / Codex /
# Claude Code CLI). After this runs:
#   1. You can ask Claude Desktop or Codex: "review PR #N using the
#      ctxloom review-orchestrator agent" — it'll dispatch all four
#      specialist subagents.
#   2. No API key needed. No GitHub Action. Uses your existing Claude
#      subscription session.
#
# Prereqs:
#   - ctxloom installed locally (`npm install -g ctxloom-pro`)
#   - ctxloom MCP configured in your AI tool (`ctxloom setup`)
#   - You're logged into Claude in the desktop app / Codex / CLI
#   - `gh` CLI installed and authenticated (for posting comments)
#
# Usage:
#   ./setup-local.sh                 # install to ~/.claude/agents/ (global)
#   ./setup-local.sh --project       # install to ./.claude/agents/ (project-only)
#   ./setup-local.sh --uninstall     # remove

set -euo pipefail

MODE="global"
case "${1:-}" in
  --project)   MODE="project" ;;
  --uninstall) MODE="uninstall" ;;
  -h|--help)
    # Portable equivalent of `head -n -1` (GNU-only): strip the final
    # non-comment line ("set -euo pipefail") via awk so this works on
    # both GNU coreutils and BSD/macOS `head`.
    sed -n '2,/^set -e/p' "$0" | sed 's/^# \{0,1\}//' | awk 'NR>1{print prev} {prev=$0}'
    exit 0
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/.claude/agents"

if [ ! -d "$SOURCE_DIR" ]; then
  echo "❌ Agent definitions not found at $SOURCE_DIR"
  echo "   Re-run from the directory containing examples/setup-local.sh"
  exit 1
fi

case "$MODE" in
  global)
    TARGET="$HOME/.claude/agents"
    echo "→ Installing globally to $TARGET"
    ;;
  project)
    TARGET=".claude/agents"
    echo "→ Installing for this project to ./$TARGET"
    ;;
  uninstall)
    echo "→ Removing ctxloom agents from both ~/.claude/agents/ and ./.claude/agents/"
    for dir in "$HOME/.claude/agents" "./.claude/agents"; do
      if [ -d "$dir" ]; then
        for agent in security-reviewer architecture-reviewer testing-reviewer performance-reviewer review-orchestrator; do
          [ -f "$dir/$agent.md" ] && rm -v "$dir/$agent.md"
        done
      fi
    done
    echo "✓ Done."
    exit 0
    ;;
esac

mkdir -p "$TARGET"
for agent in security-reviewer architecture-reviewer testing-reviewer performance-reviewer review-orchestrator; do
  cp -v "$SOURCE_DIR/$agent.md" "$TARGET/$agent.md"
done

echo ""
echo "✓ Installed. To use:"
echo ""
echo "  1. Open Claude Desktop / Codex / Claude Code CLI."
echo "  2. Confirm ctxloom MCP is connected:    /mcp"
echo "  3. Ask Claude:"
echo ""
echo "       Review PR #<NUMBER> in this repo. Use the"
echo "       review-orchestrator agent — it will dispatch the four"
echo "       specialist subagents (security, architecture, testing,"
echo "       performance) in parallel via ctxloom MCP tools and post"
echo "       a consolidated comment using gh CLI."
echo ""
echo "  No API key needed. Uses your existing Claude session."
echo ""
echo "  Re-run setup:   ./setup-local.sh"
echo "  Per-project:    ./setup-local.sh --project"
echo "  Uninstall:      ./setup-local.sh --uninstall"
