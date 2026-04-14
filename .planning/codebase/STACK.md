# Technology Stack

**Analysis Date:** 2026-04-13

## Languages

**Primary:**
- TypeScript 5.7+ - All application source code under `src/`

**Secondary:**
- JavaScript (ESM) - Build output in `dist/` (compiled from TypeScript)

## Runtime

**Environment:**
- Node.js >=20.0.0 (required by `engines` field in `package.json`; system has v24.14.1)

**Package Manager:**
- npm (lockfileVersion 3)
- Lockfile: `package-lock.json` present and committed

## Frameworks

**Core:**
- `@modelcontextprotocol/sdk` ^1.12.0 - MCP server/tool protocol; the entire application is an MCP sidecar
- `zod` ^3.23.0 - Schema validation for all MCP tool input schemas

**Testing:**
- `vitest` ^3.0.0 - Test runner and assertion library
- Config: `vitest.config.ts`

**Build/Dev:**
- `tsup` ^8.0.0 - ESM bundler; config in `tsup.config.ts`
- `tsx` ^4.0.0 - TypeScript execution for development (`npm run dev`)
- TypeScript compiler (`tsc`) used as linter only via `npm run lint` (`--noEmit`)

## Key Dependencies

**Critical:**
- `@huggingface/transformers` ^3.0.0 - Local embedding generation using the `sentence-transformers/all-MiniLM-L6-v2` model (384 dimensions, fp32); runs fully offline, no network calls during inference
- `@lancedb/lancedb` ^0.27.0 - Embedded vector database storing code embeddings on disk at `.ctxloom/vectors.lancedb`
- `web-tree-sitter` ^0.25.0 - WASM-based Tree-sitter core; used for AST parsing of TypeScript/TSX files
- `tree-sitter-typescript` ^0.23.2 - TypeScript/TSX grammar for web-tree-sitter (shipped as `.wasm` grammars)
- `chokidar` ^4.0.0 - File system watcher with 200ms debounce for incremental re-indexing

**Infrastructure:**
- Node.js built-in modules only (`fs`, `path`, `os`, `readline`, `child_process`, `url`) - no HTTP client or external networking libraries

## Configuration

**Environment:**
- `CTXLOOM_ROOT` - Optional; overrides project root directory (defaults to `process.cwd()`)
- No `.env` files exist; no dotenv library used
- All configuration is via environment variables or runtime detection

**Build:**
- `tsup.config.ts` - Bundles three entry points: `src/index.ts`, `src/workers/indexerWorker.ts`, `src/setup/postinstall.ts`
- Copies WASM assets (`tree-sitter.wasm`, `tree-sitter-typescript.wasm`, `tree-sitter-tsx.wasm`) to `dist/wasm/` on build success
- Output format: ESM only (`format: ['esm']`), target: `node20`
- Source maps and `.d.ts` declarations emitted
- `tsconfig.json` - Strict mode, `NodeNext` module resolution, `ES2022` target, `outDir: dist`, `rootDir: src`

## Platform Requirements

**Development:**
- Node.js >=20.0.0
- npm (no Yarn or pnpm lockfile present)
- Build: `npm run build` (tsup)
- Dev server: `npm run dev` (tsx, no compilation step)
- Type check: `npm run lint` (tsc --noEmit, excludes `tests/`)
- Tests: `npm test` (vitest run, reads `tests/**/*.test.ts`)

**Production:**
- Published to npm as `ctxloom` package (bin: `ctxloom`)
- Invoked via `npx -y ctxloom` or global install
- No Docker, no containerization, no cloud runtime — runs as a local process
- Transport: MCP Stdio (reads from stdin, writes to stdout)
- Persistent storage: `.ctxloom/vectors.lancedb` directory in project root (created at runtime)
- No CI/CD pipeline detected (no `.github/` directory, no `Dockerfile`)

---

*Stack analysis: 2026-04-13*
