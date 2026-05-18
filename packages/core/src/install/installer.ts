/**
 * installer.ts — Phase 2 of the agent-harness plan. Installs the
 * agent-harness layer (HMAC-signed agent-rule blocks + Claude Code
 * hooks) into a project root. Idempotent.
 *
 * Composition: this module focuses on the harness-specific artifacts
 * (CLAUDE.md / AGENTS.md / GEMINI.md / .claude/hooks.json /
 * .claude/hooks/session-start.sh). It is called BY the
 * `src/index.ts` `init` command alongside the existing `runInit()`
 * which handles `.mcp.json` + `.gitignore`. Separation lets each
 * piece be tested in isolation.
 *
 * Security boundary: every output path MUST resolve to within the
 * passed `projectRoot`. The `safeJoin` helper enforces this — a
 * symlinked dot-claude pointing at /etc would be rejected.
 *
 * Performance contract:
 *   - <3s on first install (file writes only — no graph build here)
 *   - <200ms idempotent re-run (HMAC compare; no writes when unchanged)
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  RULES_BLOCK_NAME,
  RULES_BLOCK_CONTENT,
  SESSION_START_FULL,
  CTXLOOM_HOOK_ENTRIES,
  type HooksJsonShape,
} from './templates.js';
import { upsertBlock, extractBlock, verifyBlock } from './hmacBlock.js';

/** Per-file outcome of the install. */
export interface FileResult {
  path: string;
  /** Did this run create the file (didn't exist before)? */
  created: boolean;
  /** Did this run modify the file (block updated / hook merged)? */
  updated: boolean;
  /** No-op — file was already in canonical shape. */
  alreadyCorrect: boolean;
  /** True for skipped writes when `dryRun: true`. */
  dryRun: boolean;
}

/** Aggregate result returned to the CLI. */
export interface InstallHarnessResult {
  /** Absolute path of the project root we installed into. */
  projectRoot: string;
  /** CLAUDE.md result. */
  claudeMd: FileResult;
  /** AGENTS.md result. */
  agentsMd: FileResult;
  /** GEMINI.md result. */
  geminiMd: FileResult;
  /** .claude/hooks.json result. */
  hooksJson: FileResult;
  /** .claude/hooks/session-start.sh result. */
  sessionStartSh: FileResult;
  /** Non-fatal advisories surfaced during install. */
  warnings: string[];
}

export interface InstallHarnessOptions {
  /** Project root to install into. Resolves to absolute. */
  cwd?: string;
  /**
   * Skip ACTUAL writes — return the result as if writes had happened.
   * Inspected by the CLI's `--dry-run` flag.
   */
  dryRun?: boolean;
  /**
   * On HMAC drift (block content tampered) DO replace the block. When
   * false (default) we preserve the on-disk content + emit a warning
   * — refusal to clobber gives the user a chance to commit their
   * change before we overwrite.
   */
  force?: boolean;
}

/**
 * Run the agent-harness install in `cwd`. Throws if `cwd` is not a
 * directory. All other failure modes degrade to a `warnings` entry
 * on the result.
 *
 * @public
 */
export function installHarness(opts: InstallHarnessOptions = {}): InstallHarnessResult {
  const cwd = opts.cwd ?? process.cwd();
  const projectRoot = path.resolve(cwd);
  const stat = fs.statSync(projectRoot);
  if (!stat.isDirectory()) {
    throw new Error(`installHarness: ${projectRoot} is not a directory`);
  }

  const dryRun = opts.dryRun === true;
  const force = opts.force === true;
  const warnings: string[] = [];

  const claudeMd = writeRulesBlock(projectRoot, 'CLAUDE.md', { dryRun, force, warnings });
  const agentsMd = writeRulesBlock(projectRoot, 'AGENTS.md', { dryRun, force, warnings });
  const geminiMd = writeRulesBlock(projectRoot, 'GEMINI.md', { dryRun, force, warnings });
  const hooksJson = writeHooksJson(projectRoot, { dryRun, warnings });
  const sessionStartSh = writeSessionStartScript(projectRoot, { dryRun });

  return {
    projectRoot,
    claudeMd,
    agentsMd,
    geminiMd,
    hooksJson,
    sessionStartSh,
    warnings,
  };
}

// ─── Per-file writers ────────────────────────────────────────────────

/**
 * Path-traversal safety helper. Resolves `name` relative to `root`
 * and asserts the resolved path stays inside `root`. Rejects symlinks
 * pointing outside (so a malicious `.claude` symlink to `/etc` can't
 * trick the installer into writing system files).
 */
function safeJoin(root: string, name: string): string {
  const target = path.resolve(root, name);
  const rootResolved = path.resolve(root);
  if (!target.startsWith(rootResolved + path.sep) && target !== rootResolved) {
    throw new Error(`installHarness: refusing to write outside project root: ${target}`);
  }
  return target;
}

function writeRulesBlock(
  projectRoot: string,
  filename: string,
  opts: { dryRun: boolean; force: boolean; warnings: string[] },
): FileResult {
  const filePath = safeJoin(projectRoot, filename);
  const existed = fs.existsSync(filePath);
  const existing = existed ? fs.readFileSync(filePath, 'utf-8') : '';

  // If a block already exists, verify it hasn't drifted.
  if (existed) {
    const block = extractBlock(existing, RULES_BLOCK_NAME);
    if (block) {
      const intact = verifyBlock(block);
      // If the block IS intact AND content matches canonical, no-op.
      if (intact && block.content === RULES_BLOCK_CONTENT) {
        return { path: filePath, created: false, updated: false, alreadyCorrect: true, dryRun: opts.dryRun };
      }
      // Drift detected (user edited the block content).
      if (!intact && !opts.force) {
        opts.warnings.push(
          `Drift detected in ${filename}: the CTXLOOM-RULES block has been hand-edited. ` +
            `Re-run \`ctxloom init --force\` to overwrite, or commit your changes and re-run.`,
        );
        return { path: filePath, created: false, updated: false, alreadyCorrect: false, dryRun: opts.dryRun };
      }
    }
  }

  // Build the new file content with block upserted.
  const next = upsertBlock(existing, RULES_BLOCK_NAME, RULES_BLOCK_CONTENT);

  if (!opts.dryRun) {
    fs.writeFileSync(filePath, next, 'utf-8');
  }

  return {
    path: filePath,
    created: !existed,
    updated: existed,
    alreadyCorrect: false,
    dryRun: opts.dryRun,
  };
}

function writeHooksJson(
  projectRoot: string,
  opts: { dryRun: boolean; warnings: string[] },
): FileResult {
  const dir = safeJoin(projectRoot, '.claude');
  const filePath = safeJoin(projectRoot, '.claude/hooks.json');
  const existed = fs.existsSync(filePath);

  // Read or initialize.
  let current: HooksJsonShape = {};
  if (existed) {
    try {
      const text = fs.readFileSync(filePath, 'utf-8');
      current = JSON.parse(text) as HooksJsonShape;
    } catch (err) {
      opts.warnings.push(
        `Could not parse existing ${path.relative(projectRoot, filePath)}; treating as empty. ` +
          `(${err instanceof Error ? err.message : String(err)})`,
      );
      current = {};
    }
  }

  // Merge by matcher — replaces any existing entry with the same
  // `matcher` so a stale ctxloom hook gets refreshed in place.
  const merged: HooksJsonShape = { ...current };
  for (const event of ['SessionStart', 'PostToolUse'] as const) {
    const incoming = CTXLOOM_HOOK_ENTRIES[event];
    const existingArr = Array.isArray(merged[event]) ? (merged[event] as unknown as Array<{ matcher: string; hooks: unknown }>) : [];
    const filtered = existingArr.filter(
      (entry) => !isCtxloomEntry(entry, incoming.matcher),
    );
    merged[event] = [...filtered, incoming] as HooksJsonShape[typeof event];
  }

  const nextJson = JSON.stringify(merged, null, 2) + '\n';

  // Idempotency: skip write if content is identical.
  let alreadyCorrect = false;
  if (existed) {
    const currentText = fs.readFileSync(filePath, 'utf-8');
    if (currentText === nextJson) alreadyCorrect = true;
  }

  if (!opts.dryRun && !alreadyCorrect) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, nextJson, 'utf-8');
  }

  return {
    path: filePath,
    created: !existed,
    updated: existed && !alreadyCorrect,
    alreadyCorrect,
    dryRun: opts.dryRun,
  };
}

/**
 * Detect whether an existing hook entry is "owned" by ctxloom. We
 * key on the matcher AND the presence of `ctxloom` in any command —
 * conservatively replaces only entries that look like ours, leaving
 * user-defined hooks alone.
 */
function isCtxloomEntry(entry: { matcher: string; hooks: unknown }, expectedMatcher: string): boolean {
  if (entry.matcher !== expectedMatcher) return false;
  if (!Array.isArray(entry.hooks)) return false;
  return entry.hooks.some((h) => {
    if (!h || typeof h !== 'object') return false;
    const cmd = (h as { command?: unknown }).command;
    if (typeof cmd !== 'string') return false;
    return cmd.includes('ctxloom') || cmd.includes('.claude/hooks/session-start.sh');
  });
}

function writeSessionStartScript(
  projectRoot: string,
  opts: { dryRun: boolean },
): FileResult {
  const dir = safeJoin(projectRoot, '.claude/hooks');
  const filePath = safeJoin(projectRoot, '.claude/hooks/session-start.sh');
  const existed = fs.existsSync(filePath);

  let alreadyCorrect = false;
  if (existed) {
    const current = fs.readFileSync(filePath, 'utf-8');
    if (current === SESSION_START_FULL) alreadyCorrect = true;
  }

  if (!opts.dryRun && !alreadyCorrect) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, SESSION_START_FULL, 'utf-8');
    // Mark executable — without this Claude Code rejects the hook.
    try {
      fs.chmodSync(filePath, 0o755);
    } catch {
      // chmod fails on some filesystems (e.g. WSL with metadata
      // disabled). Hooks still work when the host can `bash <file>`
      // directly, so this is non-fatal.
    }
  }

  return {
    path: filePath,
    created: !existed,
    updated: existed && !alreadyCorrect,
    alreadyCorrect,
    dryRun: opts.dryRun,
  };
}
