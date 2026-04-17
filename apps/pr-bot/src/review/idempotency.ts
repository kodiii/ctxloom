import type { ReviewPayload } from './types.js';
import { renderSummary } from './renderSummary.js';

export const SUMMARY_MARKER_PREFIX = '<!-- ctxloom:review:';

export function markerForSha(sha: string): string {
  return `${SUMMARY_MARKER_PREFIX}${sha} -->`;
}

export function buildCommentBody(payload: ReviewPayload): string {
  return renderSummary(payload);
}

/**
 * Searches for any comment containing a ctxloom review marker.
 * Matches ANY sha — ensuring we find and update the existing comment
 * even when the sha changed on a new push.
 */
export function findBotComment(
  comments: Array<{ id: number; body: string }>,
  _headSha: string,
): { id: number; body: string } | null {
  const found = comments.find(c => c.body.includes(SUMMARY_MARKER_PREFIX));
  return found ?? null;
}
