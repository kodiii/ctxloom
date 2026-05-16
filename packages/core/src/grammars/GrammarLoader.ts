/**
 * GrammarLoader — Lazy download + SHA-256 verified cache for tree-sitter WASM grammars.
 *
 * Cache location: ~/.ctxloom/grammars/ (or custom via cacheDir constructor arg)
 * CDN: https://cdn.jsdelivr.net/npm/{package}@{version}/{file}
 * Override: CTXLOOM_GRAMMAR_CDN env var
 *
 * Set CTXLOOM_GRAMMAR_CDN=unsafe to skip SHA-256 verification (dev/air-gapped).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import crypto from 'node:crypto';
import { GRAMMAR_MANIFEST, findGrammar, type GrammarEntry } from './grammar-manifest.js';
import { logger } from '../utils/logger.js';

const DEFAULT_CDN = 'https://cdn.jsdelivr.net/npm';
const DEFAULT_CACHE_DIR = path.join(os.homedir(), '.ctxloom', 'grammars');

export interface GrammarStatus {
  language: string;
  extensions: string[];
  version: string;
  status: 'cached' | 'missing';
  cachedPath: string | null;
}

export class GrammarLoader {
  private readonly cacheDir: string;
  private readonly cdn: string;
  private readonly skipVerify: boolean;

  constructor(cacheDir: string = DEFAULT_CACHE_DIR) {
    const envCdn = process.env.CTXLOOM_GRAMMAR_CDN ?? '';
    this.skipVerify = envCdn === 'unsafe';
    this.cdn = this.skipVerify ? DEFAULT_CDN : (envCdn || DEFAULT_CDN);
    this.cacheDir = cacheDir;
  }

  /** List all known grammars and their cache status. */
  listGrammars(): GrammarStatus[] {
    return GRAMMAR_MANIFEST.map(entry => {
      const cachedPath = this.getCachedPath(entry.language);
      return {
        language: entry.language,
        extensions: entry.extensions,
        version: entry.version,
        status: cachedPath !== null ? ('cached' as const) : ('missing' as const),
        cachedPath,
      };
    });
  }

  /** Returns the cached WASM path if it exists, null otherwise. */
  getCachedPath(language: string): string | null {
    const entry = findGrammar(language);
    if (!entry) return null;
    const p = path.join(this.cacheDir, entry.wasmFile);
    return fs.existsSync(p) ? p : null;
  }

  isCached(language: string): boolean {
    return this.getCachedPath(language) !== null;
  }

  /**
   * Ensures the grammar WASM is present in the cache.
   * Downloads and verifies if missing. Returns the local path.
   */
  async ensureGrammar(language: string): Promise<string> {
    const entry = findGrammar(language);
    if (!entry) throw new Error(`Unknown grammar: ${language}`);

    const cached = this.getCachedPath(language);
    if (cached) return cached;

    const url = entry.downloadUrl?.trim()
      ? entry.downloadUrl
      : `${this.cdn}/${entry.npmPackage}@${entry.version}/${entry.wasmFile}`;
    const dest = path.join(this.cacheDir, entry.wasmFile);

    logger.info('Downloading grammar', { language, url, source: entry.downloadUrl?.trim() ? 'custom' : 'cdn' });
    // Some manifest entries place the wasm in a subdir (e.g. `wasm/tree-sitter-c-sharp.wasm`).
    // Create the destination's parent dir, not just `this.cacheDir`, otherwise the
    // WriteStream open inside `download()` crashes with ENOENT before any error
    // listener can attach — escaping as an unhandled 'error' event and killing the
    // host process. See fix/grammar-loader-no-crash-on-download-failure for repro.
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    await this.download(url, dest);

    if (entry.sha256 && !this.skipVerify) {
      await this.verifyHash(dest, entry.sha256, language);
    } else if (!entry.sha256) {
      logger.warn('Grammar SHA-256 not set — skipping verification', { language });
    }

    logger.info('Grammar cached', { language, path: dest });
    return dest;
  }

  private download(url: string, dest: string, redirectsLeft: number = 5): Promise<void> {
    return new Promise((resolve, reject) => {
      const tmp = dest + '.tmp';
      const file = fs.createWriteStream(tmp);

      // Attach `'error'` SYNCHRONOUSLY. createWriteStream is lazy — the actual
      // file open happens on the next tick, and if it fails (ENOENT on the parent
      // dir, EACCES, etc.) and nothing is listening, Node throws on the
      // 'uncaughtException' path and kills the process. The previous version
      // attached this handler inside the https.get callback, which fires far too
      // late.
      const onFileError = (err: NodeJS.ErrnoException) => {
        file.destroy();
        fs.rmSync(tmp, { force: true });
        reject(err);
      };
      file.on('error', onFileError);

      const request = https.get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const location = response.headers.location;
          if (!location) { reject(new Error(`Redirect with no location from ${url}`)); return; }
          if (redirectsLeft <= 0) { reject(new Error(`Too many redirects from ${url}`)); return; }
          response.resume();
          file.close();
          fs.rmSync(tmp, { force: true });
          this.download(location, dest, redirectsLeft - 1).then(resolve).catch(reject);
          return;
        }
        if (response.statusCode !== 200) {
          file.close();
          fs.rmSync(tmp, { force: true });
          reject(new Error(`Failed to download grammar from ${url}: HTTP ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        response.on('error', (err) => {
          file.destroy();
          fs.rmSync(tmp, { force: true });
          reject(err);
        });
        file.on('finish', () => {
          fs.renameSync(tmp, dest);
          resolve();
        });
      });

      request.on('error', (err) => {
        file.close();
        fs.rmSync(tmp, { force: true });
        reject(err);
      });
    });
  }

  private async verifyHash(filePath: string, expectedHex: string, language: string): Promise<void> {
    const buf = fs.readFileSync(filePath);
    const actual = crypto.createHash('sha256').update(buf).digest('hex');
    if (actual !== expectedHex) {
      fs.rmSync(filePath, { force: true });
      throw new Error(
        `SHA-256 mismatch for ${language} grammar.\n  Expected: ${expectedHex}\n  Got:      ${actual}\n` +
        `  The CDN may have served a different version. Update grammar-manifest.ts.`,
      );
    }
  }
}
