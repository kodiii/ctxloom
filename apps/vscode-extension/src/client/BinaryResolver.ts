import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export interface ResolveOptions {
  /** Absolute path to the extension's globalStorageUri (where lazy-installed CLIs live). */
  globalStorageRoot: string;
  /** The CLI version pinned in the extension manifest (`ctxloomCliVersion`). */
  cliVersion: string;
  /** User-configured override path. Empty string and whitespace are treated as null. */
  override: string | null;
}

export interface ResolveResult {
  /** 'override' = user-configured path; 'globalStorage' = lazy-installed CLI directory. */
  source: 'override' | 'globalStorage';
  /** Absolute, ~-expanded path to the entry. */
  path: string;
  /** Does the file exist on disk right now? */
  exists: boolean;
}

const CLI_SUBPATH = path.join('dist', 'index.js');

function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

export function resolveCliPath(opts: ResolveOptions): ResolveResult {
  if (opts.override !== null && opts.override.trim() !== '') {
    const expanded = path.resolve(expandHome(opts.override));
    return { source: 'override', path: expanded, exists: fs.existsSync(expanded) };
  }
  const installed = path.join(opts.globalStorageRoot, 'ctxloom-cli', opts.cliVersion, CLI_SUBPATH);
  return { source: 'globalStorage', path: installed, exists: fs.existsSync(installed) };
}
