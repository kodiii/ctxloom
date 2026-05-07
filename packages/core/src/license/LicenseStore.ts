import { readFileSync, writeFileSync, unlinkSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
import { LicenseFileSchema, type LicenseFile } from './types.js';

export function licenseFilePath(home: string): string {
  return path.join(home, '.ctxloom', 'license.json');
}

export class LicenseStore {
  private readonly filePath: string;

  constructor(home: string) {
    this.filePath = licenseFilePath(home);
  }

  async read(): Promise<LicenseFile | null> {
    if (!existsSync(this.filePath)) return null;
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return LicenseFileSchema.parse(parsed);
    } catch (err) {
      // Set CTXLOOM_DEBUG=1 to surface the underlying parse error. Previously
      // this catch was completely silent, which masked a real schema bug
      // (empty email failing .email() validation) for every activation.
      // We still return null on any failure — corrupt files shouldn't crash
      // the CLI — but at least make the failure visible when debugging.
      if (process.env['CTXLOOM_DEBUG']) {
        const detail = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[ctxloom] LicenseStore.read failed at ${this.filePath}: ${detail}\n`);
      }
      return null;
    }
  }

  async write(license: LicenseFile): Promise<void> {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(license, null, 2), 'utf8');
    if (process.platform !== 'win32') {
      chmodSync(this.filePath, 0o600);
    }
  }

  async clear(): Promise<void> {
    try {
      unlinkSync(this.filePath);
    } catch {
      // already gone
    }
  }
}
