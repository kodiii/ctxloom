import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface DistinctIdRecord {
  id: string;
  alias_pending?: string;
}

function distinctIdPath(home?: string): string {
  return path.join(home ?? os.homedir(), '.ctxloom', 'distinct_id');
}

function isValidV4(id: unknown): id is string {
  return typeof id === 'string' && UUID_V4_REGEX.test(id);
}

export function getOrCreateDistinctId(home?: string): DistinctIdRecord {
  const filePath = distinctIdPath(home);

  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        isValidV4((parsed as Record<string, unknown>)['id'])
      ) {
        return parsed as DistinctIdRecord;
      }
    } catch {
      // corrupt or unreadable — fall through to regenerate
    }
  }

  const record: DistinctIdRecord = {
    id: crypto.randomUUID(),
    alias_pending: os.hostname(),
  };

  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(record), { mode: 0o600 });

  return record;
}

export function markAliasSent(home?: string): void {
  const filePath = distinctIdPath(home);
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as DistinctIdRecord;
    const { alias_pending: _dropped, ...rest } = parsed;
    writeFileSync(filePath, JSON.stringify(rest), { mode: 0o600 });
  } catch {
    // best-effort: silently swallow errors
  }
}
