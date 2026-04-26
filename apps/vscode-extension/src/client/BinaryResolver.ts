import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export interface ResolveOptions {
  /** Absolute path to the extension installation root (use `context.extensionPath`). */
  extensionRoot: string;
  /** User-configured override path or null. */
  override: string | null;
}

export interface ResolveResult {
  /** 'bundled' = used the VSIX-shipped CLI; 'override' = used user-configured path. */
  source: 'bundled' | 'override';
  /** Absolute, ~-expanded path to the entry. */
  path: string;
  /** Does the file exist on disk right now? */
  exists: boolean;
}

const BUNDLED_SUBPATH = path.join('resources', 'ctxloom-cli', 'dist', 'index.js');

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
  const bundled = path.join(opts.extensionRoot, BUNDLED_SUBPATH);
  return { source: 'bundled', path: bundled, exists: fs.existsSync(bundled) };
}
