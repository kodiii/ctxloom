/**
 * Pure resolver: pick a project root from an MCP tool call.
 *
 * Resolution order (per design spec §1):
 *   1. Explicit `arg`:
 *        - No path separator (`/`, leading `~`, drive letter) → alias-only.
 *          Registry miss returns `alias_not_found`. No silent path fallback.
 *        - Has path separator → resolve as path. Registry not consulted.
 *   2. `env.CTXLOOM_ROOT` (same as v1.0.31)
 *   3. `cwd` (same fallback as v1.0.31)
 *
 * Side-effect-free. Filesystem checks (existence) are real syscalls and
 * happen here — but no mutations, no logging.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface RegistryView {
  findByAlias(name: string): { root: string; alias?: string } | null;
  list(): { root: string; alias?: string }[];
}

export interface ResolveInput {
  arg: string | undefined;
  env: string | undefined;
  cwd: string;
  registry: RegistryView;
}

export type ResolveOutcome =
  | { kind: 'ok'; root: string; alias?: string; source: 'arg-alias' | 'arg-path' | 'env' | 'cwd' }
  | { kind: 'alias_not_found'; alias: string; didYouMean: string[] }
  | { kind: 'project_root_not_found'; attemptedPath: string; resolutionChain: string };

const PATH_SEPARATOR_PATTERN = /[/\\~]|^[A-Za-z]:/;

function looksLikePath(value: string): boolean {
  return PATH_SEPARATOR_PATTERN.test(value);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

function fuzzyMatchAliases(target: string, registry: RegistryView): string[] {
  return registry
    .list()
    .map((e) => e.alias)
    .filter((a): a is string => typeof a === 'string')
    .map((a) => ({ alias: a, dist: levenshtein(target, a) }))
    .filter((m) => m.dist <= 3)
    .sort((x, y) => x.dist - y.dist)
    .slice(0, 5)
    .map((m) => m.alias);
}

function resolvePathSafely(p: string, cwd: string): string {
  // Expand ~/foo to $HOME/foo. node:path doesn't do this for us.
  let expanded = p;
  if (p === '~' || p.startsWith('~/')) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    expanded = p === '~' ? home : path.join(home, p.slice(2));
  }
  return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(cwd, expanded);
}

function realpathOrSame(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

export function resolveProjectRoot(input: ResolveInput): ResolveOutcome {
  const { arg, env, cwd, registry } = input;

  // 1. Explicit arg
  if (arg !== undefined && arg !== '') {
    if (!looksLikePath(arg)) {
      // Alias-only lookup
      const hit = registry.findByAlias(arg);
      if (hit) {
        return {
          kind: 'ok',
          root: realpathOrSame(hit.root),
          alias: hit.alias,
          source: 'arg-alias',
        };
      }
      return {
        kind: 'alias_not_found',
        alias: arg,
        didYouMean: fuzzyMatchAliases(arg, registry),
      };
    }
    // Path-flavored arg
    const resolved = resolvePathSafely(arg, cwd);
    if (!fs.existsSync(resolved)) {
      return {
        kind: 'project_root_not_found',
        attemptedPath: resolved,
        resolutionChain: `arg:${arg}→${resolved}`,
      };
    }
    return { kind: 'ok', root: realpathOrSame(resolved), source: 'arg-path' };
  }

  // 2. Env
  if (env !== undefined && env !== '') {
    const resolved = resolvePathSafely(env, cwd);
    if (!fs.existsSync(resolved)) {
      return {
        kind: 'project_root_not_found',
        attemptedPath: resolved,
        resolutionChain: `env:CTXLOOM_ROOT→${resolved}`,
      };
    }
    return { kind: 'ok', root: realpathOrSame(resolved), source: 'env' };
  }

  // 3. cwd
  const resolved = resolvePathSafely(cwd, cwd);
  return { kind: 'ok', root: realpathOrSame(resolved), source: 'cwd' };
}

// ─── validateDefaultRoot ─────────────────────────────────────────────────────

const PROJECT_MARKERS = [
  '.ctxloom',
  '.git',
  'package.json',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'setup.py',
  'pom.xml',
  'build.gradle',
];

const FILESYSTEM_ROOTS = new Set(['/', 'C:\\', 'D:\\', 'E:\\', 'F:\\']);

export function validateDefaultRoot(candidate: string): boolean {
  if (FILESYSTEM_ROOTS.has(candidate)) return false;
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isDirectory()) return false;
  } catch {
    return false;
  }
  return PROJECT_MARKERS.some((m) => fs.existsSync(path.join(candidate, m)));
}
