import type { ChangedFile } from '@ctxloom/core';
import type { ReviewPayload } from './types.js';

export interface InlineComment {
  path: string;
  line: number;
  side: 'RIGHT';
  body: string;
}

function formatConfidence(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function buildCouplingLine(file: ChangedFile): string {
  if (!file.risk || file.risk.coupledNodes.length === 0) return '';
  const top = file.risk.coupledNodes[0];
  return `\n- Top coupled sibling: \`${top.node}\` (confidence: ${formatConfidence(top.confidence)})`;
}

export function renderInline(
  file: ChangedFile,
  payload: ReviewPayload,
  validLine: number | undefined,
): InlineComment | null {
  // Only emit for files that are in the changed set
  const isChanged = payload.changedFiles.some(f => f.file === file.file);
  if (!isChanged) return null;

  // Skip files with no interesting data
  if (file.importerCount === 0 && !file.risk) return null;

  // GitHub's review API rejects the whole review (422) if any inline
  // comment references a line that isn't in the PR's unified diff.
  // The caller passes us the first line of the file's first diff hunk
  // (from `pulls.listFiles` → `patch`); if there isn't one — binary
  // file, rename without content change, etc. — we can't anchor an
  // inline and must skip.
  if (typeof validLine !== 'number' || !Number.isFinite(validLine) || validLine < 1) {
    return null;
  }

  const { headSha } = payload.pr;
  const couplingLine = buildCouplingLine(file);

  const body =
    `🧵 **ctxloom:** this file has **${file.importerCount} callers** and risk level **${file.riskLevel}**` +
    couplingLine +
    `\n<!-- ctxloom:inline:${headSha} -->`;

  return {
    path: file.file,
    line: validLine,
    side: 'RIGHT',
    body,
  };
}
