# VS Code Extension — Future Implementations

Punted-but-tracked work. Not scoped for v1; logged here so we don't lose them.

## Deferred to v1.1+

- **Marketplace publish (lazy-download CLI)** — v1 ships sideload-only because the bundled `ctxloom-pro` CLI is ~400 MB (ML-embedding deps `onnxruntime-web/-node` + `@huggingface/transformers` + `@lancedb/lancedb-darwin-arm64` + `tree-sitter-typescript` dominate). The 50 MB Marketplace limit requires lazy-downloading these on first activation. **Plan for v1.1:** ship a ~5 MB VSIX containing only the extension code; on first activation, download the CLI tarball from a CDN (e.g. GitHub Releases asset signed by a release workflow) into `${context.globalStorageUri}/ctxloom-cli/` and update `BinaryResolver` to look there before the bundled path. ~3 days work. Reference implementation: GitHub Copilot Chat, Sourcegraph Cody both use this pattern.
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
