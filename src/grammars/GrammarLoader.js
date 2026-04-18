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
import { GRAMMAR_MANIFEST, findGrammar } from './grammar-manifest.js';
import { logger } from '../utils/logger.js';
const DEFAULT_CDN = 'https://cdn.jsdelivr.net/npm';
const DEFAULT_CACHE_DIR = path.join(os.homedir(), '.ctxloom', 'grammars');
export class GrammarLoader {
    cacheDir;
    cdn;
    skipVerify;
    constructor(cacheDir = DEFAULT_CACHE_DIR) {
        const envCdn = process.env.CTXLOOM_GRAMMAR_CDN ?? '';
        this.skipVerify = envCdn === 'unsafe';
        this.cdn = this.skipVerify ? DEFAULT_CDN : (envCdn || DEFAULT_CDN);
        this.cacheDir = cacheDir;
    }
    /** List all known grammars and their cache status. */
    listGrammars() {
        return GRAMMAR_MANIFEST.map(entry => {
            const cachedPath = this.getCachedPath(entry.language);
            return {
                language: entry.language,
                extensions: entry.extensions,
                version: entry.version,
                status: cachedPath !== null ? 'cached' : 'missing',
                cachedPath,
            };
        });
    }
    /** Returns the cached WASM path if it exists, null otherwise. */
    getCachedPath(language) {
        const entry = findGrammar(language);
        if (!entry)
            return null;
        const p = path.join(this.cacheDir, entry.wasmFile);
        return fs.existsSync(p) ? p : null;
    }
    isCached(language) {
        return this.getCachedPath(language) !== null;
    }
    /**
     * Ensures the grammar WASM is present in the cache.
     * Downloads and verifies if missing. Returns the local path.
     */
    async ensureGrammar(language) {
        const entry = findGrammar(language);
        if (!entry)
            throw new Error(`Unknown grammar: ${language}`);
        const cached = this.getCachedPath(language);
        if (cached)
            return cached;
        const url = entry.downloadUrl?.trim()
            ? entry.downloadUrl
            : `${this.cdn}/${entry.npmPackage}@${entry.version}/${entry.wasmFile}`;
        const dest = path.join(this.cacheDir, entry.wasmFile);
        logger.info('Downloading grammar', { language, url, source: entry.downloadUrl?.trim() ? 'custom' : 'cdn' });
        fs.mkdirSync(this.cacheDir, { recursive: true });
        await this.download(url, dest);
        if (entry.sha256 && !this.skipVerify) {
            await this.verifyHash(dest, entry.sha256, language);
        }
        else if (!entry.sha256) {
            logger.warn('Grammar SHA-256 not set — skipping verification', { language });
        }
        logger.info('Grammar cached', { language, path: dest });
        return dest;
    }
    download(url, dest, redirectsLeft = 5) {
        return new Promise((resolve, reject) => {
            const tmp = dest + '.tmp';
            const file = fs.createWriteStream(tmp);
            const request = https.get(url, (response) => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                    const location = response.headers.location;
                    if (!location) {
                        reject(new Error(`Redirect with no location from ${url}`));
                        return;
                    }
                    if (redirectsLeft <= 0) {
                        reject(new Error(`Too many redirects from ${url}`));
                        return;
                    }
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
                file.on('error', (err) => {
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
    async verifyHash(filePath, expectedHex, language) {
        const buf = fs.readFileSync(filePath);
        const actual = crypto.createHash('sha256').update(buf).digest('hex');
        if (actual !== expectedHex) {
            fs.rmSync(filePath, { force: true });
            throw new Error(`SHA-256 mismatch for ${language} grammar.\n  Expected: ${expectedHex}\n  Got:      ${actual}\n` +
                `  The CDN may have served a different version. Update grammar-manifest.ts.`);
        }
    }
}
//# sourceMappingURL=GrammarLoader.js.map