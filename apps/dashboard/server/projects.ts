/**
 * Project list for the multi-project dashboard.
 *
 * The dashboard loads exactly one project's graph into memory at a time
 * (via `DashboardContext`). This module gives the UI a stable list of
 * candidate projects to switch between.
 *
 * Sources, in priority order:
 *   1. The "default" project — whichever root the dashboard was launched
 *      against (CTXLOOM_ROOT or cwd). Always present even if not
 *      registered, so a fresh user with no `ctxloom register` history
 *      still sees something useful.
 *   2. The registered-repos list at ~/.ctxloom/repos.json, populated by
 *      `ctxloom register <path>`. Same source the cross-repo MCP tool
 *      reads, so registering a repo there immediately surfaces it in
 *      the dashboard switcher too.
 *
 * Registry I/O is best-effort: a missing or malformed file means an
 * empty list, never a crash. The dashboard remains usable.
 */
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export interface RegisteredRepoEntry {
  root: string;
  dbPath?: string;
  name?: string;
  alias?: string;
  registeredAt?: string;
}

export interface DashboardProject {
  /** Stable URL-safe id derived from the absolute root path. */
  slug: string;
  /** Human-readable name (basename of root by default). */
  name: string;
  /** Optional short alias set via `ctxloom register --alias <name>`. */
  alias?: string;
  /** Absolute path. NOT exposed via /api/health for privacy, but the
   *  switcher needs it to switch and to disambiguate same-name projects. */
  root: string;
  /** True if this is the project the dashboard was launched against. */
  isDefault: boolean;
  /** True if this project has a `.ctxloom/` snapshot dir on disk —
   *  i.e. it's been indexed at least once. Used to show an "indexed"
   *  badge and warn before switching to a never-indexed project (slow
   *  cold-start). */
  hasSnapshot: boolean;
}

const HOME = os.homedir();
const REGISTRY_PATH = path.join(HOME, '.ctxloom', 'repos.json');

/**
 * Slug = first 8 chars of sha1(absolute root). Stable across renames
 * of the directory's basename, URL-safe, collision-resistant in
 * practice for the small N of registered repos.
 */
export function slugFor(root: string): string {
  const abs = path.resolve(root);
  return crypto.createHash('sha1').update(abs).digest('hex').slice(0, 12);
}

function readRegistry(): RegisteredRepoEntry[] {
  if (!existsSync(REGISTRY_PATH)) return [];
  try {
    const raw = readFileSync(REGISTRY_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r): r is RegisteredRepoEntry => typeof r?.root === 'string');
  } catch {
    return [];
  }
}

/**
 * Build the candidate project list. `defaultRoot` is the root the
 * dashboard was launched with — always shown first, always marked
 * `isDefault: true`. Registered repos follow, deduped against the
 * default by absolute path.
 */
export function listProjects(defaultRoot: string): DashboardProject[] {
  const absDefault = path.resolve(defaultRoot);
  const out: DashboardProject[] = [
    {
      slug: slugFor(absDefault),
      name: path.basename(absDefault) || absDefault,
      root: absDefault,
      isDefault: true,
      hasSnapshot: existsSync(path.join(absDefault, '.ctxloom')),
    },
  ];

  const seen = new Set([absDefault]);
  for (const entry of readRegistry()) {
    const abs = path.resolve(entry.root);
    if (seen.has(abs)) continue;
    seen.add(abs);
    const item: DashboardProject = {
      slug: slugFor(abs),
      name: entry.name ?? (path.basename(abs) || abs),
      root: abs,
      isDefault: false,
      hasSnapshot: existsSync(path.join(abs, '.ctxloom')),
    };
    if (entry.alias !== undefined) item.alias = entry.alias;
    out.push(item);
  }
  return out;
}
