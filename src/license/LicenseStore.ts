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
    } catch {
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
