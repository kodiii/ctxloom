# VS Code Extension — Future Implementations

Punted-but-tracked work. Not scoped for v1; logged here so we don't lose them.

## Deferred to v1.1+

- **Multi-root workspace support** — v1 uses `workspaceFolders[0]` only. Power users with multi-root workspaces want N child processes.
- **Daemon mode** — v1 spawns ctxloom per VS Code window. A shared daemon would lower resource cost for users with many windows.
- **JetBrains port** — separate plugin, shares no code (Kotlin UI, JNI to the same MCP server). Distinct codebase, distinct release cadence.
- **Settings UI for rules config** — today users edit `.ctxloomrc` directly. A visual rule builder would help non-CLI users.
- **Branded settings panel theme variants** — high-contrast and colorblind-friendly modes; the v1 panel uses standard tokens.
- **Per-folder license seats / team license sharing** — current model is per-machine.
- **Web-extension build (github.dev / vscode.dev)** — different build target, no native deps allowed; LanceDB and tree-sitter would need WASM-only paths.

## Out of scope (won't build, by design)

- **Inline AI suggestions** — Copilot's surface, not ours.
- **GitLens-style blame UI** — GitLens owns this surface.

## Engineering polish backlog

- **Visual regression tests on hover cards / status bar** — VS Code render internals change too often; relying on data-snapshot is more durable.
- **Live integration tests against Copilot Chat / Cursor MCP** — depends on third-party extensions in the test runner.
