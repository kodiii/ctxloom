import crypto from 'node:crypto';
import path from 'node:path';

export function hashProjectRoot(absPath: string): string {
  const canonical = path.resolve(absPath);
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}
