import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import type { AuthorMapping } from './types.js';

interface Cache {
  [email: string]: string;
}

/**
 * Resolves git author emails to GitHub handles.
 * Resolution order: authors.yml > authors-cache.json > undefined
 *
 * null  = email is on the ignore list (skip this person entirely)
 * undefined = no mapping found (may attempt API lookup later)
 * string = resolved GitHub handle
 */
export class AuthorResolver {
  private mappings: Record<string, string> = {};
  private ignoreSet: Set<string> = new Set();
  private cache: Cache = {};

  constructor(private readonly ctxloomDir: string) {}

  async load(): Promise<void> {
    await Promise.all([this.loadYml(), this.loadCache()]);
  }

  /** Resolve email → handle. Returns null if ignored, undefined if unknown. */
  resolve(email: string): string | null | undefined {
    if (this.ignoreSet.has(email)) return null;
    const fromYml = this.mappings[email];
    if (fromYml !== undefined) return fromYml;
    const fromCache = this.cache[email];
    if (fromCache !== undefined) return fromCache;
    return undefined;
  }

  /** Write a new mapping to the cache file. */
  async writeCache(email: string, handle: string): Promise<void> {
    this.cache = { ...this.cache, [email]: handle };
    await fs.writeFile(
      path.join(this.ctxloomDir, 'authors-cache.json'),
      JSON.stringify(this.cache, null, 2),
    );
  }

  /** Return all emails that have no mapping and are not ignored. */
  unmapped(emails: string[]): string[] {
    return emails.filter(e => this.resolve(e) === undefined);
  }

  private async loadYml(): Promise<void> {
    const file = path.join(this.ctxloomDir, 'authors.yml');
    try {
      const raw = await fs.readFile(file, 'utf8');
      const parsed = yaml.load(raw) as AuthorMapping | null;
      if (!parsed) return;
      this.mappings = parsed.mappings ?? {};
      this.ignoreSet = new Set(parsed.ignore ?? []);
    } catch {
      // file absent — ok
    }
  }

  private async loadCache(): Promise<void> {
    const file = path.join(this.ctxloomDir, 'authors-cache.json');
    try {
      const raw = await fs.readFile(file, 'utf8');
      this.cache = JSON.parse(raw) as Cache;
    } catch {
      // file absent — ok
    }
  }
}

/**
 * Attempt to resolve a git email to a GitHub handle via the GitHub API.
 * Uses the commits API — returns undefined on any failure.
 */
export async function resolveViaGitHubApi(
  email: string,
  owner: string,
  repo: string,
  token: string,
): Promise<string | undefined> {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/commits?author=${encodeURIComponent(email)}&per_page=1`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) return undefined;
    const data = await res.json() as Array<{ author?: { login?: string } }>;
    return data[0]?.author?.login ?? undefined;
  } catch {
    return undefined;
  }
}
