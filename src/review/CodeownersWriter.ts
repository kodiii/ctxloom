import fs from 'node:fs/promises';
import path from 'node:path';

const MARKER_START = '# <ctxloom:start> — managed by ctxloom review-suggest; do not edit between markers';
const MARKER_START_DETECT = '# <ctxloom:start>';
const MARKER_END = '# <ctxloom:end>';

export interface CodeownersRule {
  pattern: string;
  handles: string[];
}

/** Build the managed block (start marker, rules, end marker). */
export function buildCodeownersBlock(rules: CodeownersRule[]): string {
  const lines = [MARKER_START];
  for (const rule of rules) {
    const owners = rule.handles.map(h => `@${h}`).join(' ');
    lines.push(`${rule.pattern.padEnd(40)} ${owners}`);
  }
  lines.push(MARKER_END);
  return lines.join('\n');
}

/**
 * Merge a new managed block into existing file content.
 * - If markers exist: replace the content between them (markers inclusive).
 * - If no markers: append block at the end.
 */
export function mergeIntoFile(existing: string, block: string): string {
  const startIdx = existing.indexOf(MARKER_START_DETECT);
  const endIdx = existing.indexOf(MARKER_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + MARKER_END.length);
    return before + block + after;
  }

  // No markers — append at end
  if (existing.length === 0) return `${block}\n`;
  const base = existing.endsWith('\n') ? existing : `${existing}\n`;
  return `${base}\n${block}\n`;
}

/**
 * Read existing CODEOWNERS (or empty string), merge new block in, return result.
 * Does NOT write to disk — call writeCODEOWNERS() for that.
 */
export async function generateCODEOWNERS(
  codeownersPath: string,
  rules: CodeownersRule[],
): Promise<string> {
  let existing = '';
  try {
    existing = await fs.readFile(codeownersPath, 'utf8');
  } catch {
    // file absent — start fresh
  }
  const block = buildCodeownersBlock(rules);
  return mergeIntoFile(existing, block);
}

/** Write the generated CODEOWNERS content to disk. */
export async function writeCODEOWNERS(
  codeownersPath: string,
  content: string,
): Promise<void> {
  await fs.mkdir(path.dirname(codeownersPath), { recursive: true });
  await fs.writeFile(codeownersPath, content, 'utf8');
}
