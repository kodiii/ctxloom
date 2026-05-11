/**
 * init.ts — Per-project bootstrapping for ctxloom.
 *
 * `ctxloom init` (run inside a project directory) writes the two pieces of
 * config that turn a generic global MCP-server entry into something that
 * works correctly for *this* project:
 *
 *   1. `.mcp.json` at the project root, with the ctxloom server pinned to
 *      this directory via env.CTXLOOM_ROOT.
 *   2. `.ctxloom/` appended to `.gitignore` (the on-disk graph + LanceDB
 *      can easily exceed 500 MB on a mid-size repo).
 *
 * The motivation is concrete: without (1), Claude Code launches the
 * global ctxloom MCP server with cwd inherited from wherever Claude Code
 * itself was launched. Switching to a different project in the same
 * Claude Code session does NOT relaunch MCP servers, so the server stays
 * pinned to the wrong project root forever. A per-project `.mcp.json`
 * with an explicit CTXLOOM_ROOT short-circuits that ambiguity — and
 * Claude Code's per-project MCP merge picks it up automatically the next
 * time the user opens this directory.
 *
 * Both operations are idempotent: re-running `ctxloom init` against an
 * already-initialised project is a no-op (or a merge, if the user has
 * added other MCP servers since).
 */

import fs from 'node:fs';
import path from 'node:path';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface InitMcpResult {
  /** Absolute path to the .mcp.json file we wrote (or would have written). */
  path: string;
  /** True when the file did not exist before this run. */
  created: boolean;
  /**
   * True when the file already existed and we merged a `ctxloom` entry
   * into it (preserving any other servers + top-level keys).
   */
  merged: boolean;
  /**
   * True when the file already contained a `ctxloom` entry pointing at
   * the same CTXLOOM_ROOT — we touched nothing.
   */
  alreadyCorrect: boolean;
}

export interface InitGitignoreResult {
  /** Absolute path to the .gitignore file we wrote (or would have written). */
  path: string;
  /** True when the file did not exist before this run. */
  created: boolean;
  /** True when we appended `.ctxloom/` to the file. */
  appended: boolean;
  /** True when `.ctxloom/` (or an equivalent pattern) was already present. */
  alreadyPresent: boolean;
}

export interface InitResult {
  /** Absolute path of the project root we initialised. */
  cwd: string;
  mcpJson: InitMcpResult;
  gitignore: InitGitignoreResult;
  /** Non-fatal advisories (e.g. "not inside a git repo"). */
  warnings: string[];
}

interface McpServersFile {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Run the per-project init in `cwd`. Throws if `cwd` is not a directory.
 * All other failure modes degrade to a `warnings` entry on the result.
 */
export function runInit(cwd: string = process.cwd()): InitResult {
  const root = path.resolve(cwd);
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) {
    throw new Error(`ctxloom init: ${root} is not a directory`);
  }

  const warnings: string[] = [];
  if (!fs.existsSync(path.join(root, '.git'))) {
    // Not fatal — the init is still meaningful for a non-git scratch
    // project — but most users running this in a non-git directory are
    // doing it by accident. Surface the warning so they can ctrl-C and
    // re-cd if needed.
    warnings.push(
      'No .git directory found here. ctxloom init still works, but most graph features (git coupling, risk overlay, churn) require git history.',
    );
  }

  const mcpJson = writeMcpJson(root);
  const gitignore = appendGitignore(root);

  return { cwd: root, mcpJson, gitignore, warnings };
}

// ─── .mcp.json writer ──────────────────────────────────────────────────────

/**
 * Build the canonical ctxloom MCP server entry for a project. Exposed so
 * tests can verify the exact shape and so callers can dry-run.
 */
export function buildCtxloomEntry(projectRoot: string): {
  command: string;
  args: string[];
  env: { CTXLOOM_ROOT: string };
} {
  return {
    command: 'ctxloom',
    args: [],
    env: { CTXLOOM_ROOT: projectRoot },
  };
}

function writeMcpJson(projectRoot: string): InitMcpResult {
  const mcpPath = path.join(projectRoot, '.mcp.json');
  const entry = buildCtxloomEntry(projectRoot);

  if (!fs.existsSync(mcpPath)) {
    const payload: McpServersFile = { mcpServers: { ctxloom: entry } };
    fs.writeFileSync(mcpPath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
    return { path: mcpPath, created: true, merged: false, alreadyCorrect: false };
  }

  // Existing file — parse, check for prior ctxloom entry, merge.
  const raw = fs.readFileSync(mcpPath, 'utf-8');
  let parsed: McpServersFile;
  try {
    parsed = JSON.parse(raw) as McpServersFile;
  } catch {
    throw new Error(
      `ctxloom init: ${mcpPath} is not valid JSON. Fix the file and re-run, or remove it and re-run init to regenerate.`,
    );
  }

  if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
    parsed.mcpServers = {};
  }
  const servers = parsed.mcpServers as Record<string, unknown>;

  const existing = servers['ctxloom'] as
    | { command?: string; env?: Record<string, string> }
    | undefined;
  const sameRoot =
    existing &&
    typeof existing === 'object' &&
    existing.env &&
    typeof existing.env === 'object' &&
    existing.env.CTXLOOM_ROOT === projectRoot;

  if (sameRoot) {
    return { path: mcpPath, created: false, merged: false, alreadyCorrect: true };
  }

  servers['ctxloom'] = entry;
  fs.writeFileSync(mcpPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
  return { path: mcpPath, created: false, merged: true, alreadyCorrect: false };
}

// ─── .gitignore appender ───────────────────────────────────────────────────

const GITIGNORE_BANNER = '# ctxloom local index (machine-specific, do not commit)';
const GITIGNORE_PATTERN = '.ctxloom/';

function appendGitignore(projectRoot: string): InitGitignoreResult {
  const gitignorePath = path.join(projectRoot, '.gitignore');

  if (!fs.existsSync(gitignorePath)) {
    const content = `${GITIGNORE_BANNER}\n${GITIGNORE_PATTERN}\n`;
    fs.writeFileSync(gitignorePath, content, 'utf-8');
    return {
      path: gitignorePath,
      created: true,
      appended: true,
      alreadyPresent: false,
    };
  }

  const raw = fs.readFileSync(gitignorePath, 'utf-8');
  // Match any reasonable equivalent — bare `.ctxloom`, `.ctxloom/`, or
  // an absolute-from-root pattern `/.ctxloom`. Anchored to start of line
  // so we don't false-match on `!/.ctxloom` (a negation pattern) or
  // comment lines like `# .ctxloom/`.
  const alreadyPresent = raw.split('\n').some((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed.startsWith('!')) return false;
    return (
      trimmed === '.ctxloom' ||
      trimmed === '.ctxloom/' ||
      trimmed === '/.ctxloom' ||
      trimmed === '/.ctxloom/'
    );
  });

  if (alreadyPresent) {
    return {
      path: gitignorePath,
      created: false,
      appended: false,
      alreadyPresent: true,
    };
  }

  // Append with a leading newline if the existing file doesn't end in one,
  // so we don't accidentally produce `lastline.ctxloom/`.
  const sep = raw.endsWith('\n') ? '' : '\n';
  const addition = `${sep}\n${GITIGNORE_BANNER}\n${GITIGNORE_PATTERN}\n`;
  fs.appendFileSync(gitignorePath, addition, 'utf-8');
  return {
    path: gitignorePath,
    created: false,
    appended: true,
    alreadyPresent: false,
  };
}
