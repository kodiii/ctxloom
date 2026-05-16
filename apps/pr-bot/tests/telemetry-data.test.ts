/**
 * Contract test for the committed dogfood telemetry data file.
 *
 * Closes TEST-114-4 (medium) from PR #114 dogfood: the committed
 * `apps/pr-bot/data/dogfood-telemetry.jsonl` is the input contract
 * for `aggregate-telemetry.ts`, but previously had no test asserting
 * it parses, has the expected rows, or matches `TelemetryRow`. A
 * future field rename or row addition with a malformed line would
 * break aggregation silently with NaN p75 and no CI signal.
 *
 * This test pins the schema-on-disk and fails LOUDLY if the JSONL
 * drifts from `TelemetryRow`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TelemetryRowSchema, parseTelemetryRow } from '../src/telemetry/schema.js';
import { PHASE_A_PRS } from '../scripts/extract-budget-telemetry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSONL_FILE = join(__dirname, '..', 'data', 'dogfood-telemetry.jsonl');

function loadLines(): string[] {
  const text = readFileSync(JSONL_FILE, 'utf8');
  return text.split('\n').filter((line) => line.trim().length > 0);
}

describe('dogfood-telemetry.jsonl contract', () => {
  const lines = loadLines();

  it('has at least one row', () => {
    expect(lines.length).toBeGreaterThan(0);
  });

  it('contains exactly one row per Phase A PR (backfill is historical)', () => {
    expect(lines.length).toBe(PHASE_A_PRS.length);
  });

  it.each(PHASE_A_PRS)('row for PR #%d parses and matches TelemetryRow schema', (pr) => {
    const line = lines.find((l) => {
      try {
        return JSON.parse(l).pr === pr;
      } catch {
        return false;
      }
    });
    expect(line, `No row found for PR #${pr} in dogfood-telemetry.jsonl`).toBeDefined();
    // Throws a clear ZodError if any field drifts from the schema.
    const row = parseTelemetryRow(line!);
    expect(row.pr).toBe(pr);
    expect(row.url).toMatch(/^https:\/\/github\.com\/kodiii\/ctxloom\/pull\//);
  });

  it('every row passes Zod schema validation', () => {
    for (const line of lines) {
      // Don't just JSON.parse + cast — use the schema to fail loudly
      // on field rename, type mismatch, missing required field, etc.
      const parsed = TelemetryRowSchema.safeParse(JSON.parse(line));
      expect(parsed.success, `Row failed schema validation: ${parsed.success ? '' : parsed.error.message}`).toBe(true);
    }
  });

  it('every row has a positive PR number', () => {
    for (const line of lines) {
      const row = parseTelemetryRow(line);
      expect(row.pr).toBeGreaterThan(0);
    }
  });

  it('total_specialist_tokens is consistent with per-specialist sum when all 4 are present', () => {
    for (const line of lines) {
      const row = parseTelemetryRow(line);
      const allPresent =
        row.specialists.security !== null &&
        row.specialists.architecture !== null &&
        row.specialists.testing !== null &&
        row.specialists.performance !== null;
      if (!allPresent) continue;
      const sum =
        (row.specialists.security ?? 0) +
        (row.specialists.architecture ?? 0) +
        (row.specialists.testing ?? 0) +
        (row.specialists.performance ?? 0);
      expect(
        row.total_specialist_tokens,
        `PR #${row.pr}: total_specialist_tokens (${row.total_specialist_tokens}) should equal sum of specialists (${sum})`,
      ).toBe(sum);
    }
  });
});
