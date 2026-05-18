/**
 * hmacBlock.ts — HMAC-signed templated-block primitives for the agent-
 * harness installer. Closes Phase 2 of the agent-harness plan
 * (docs/superpowers/plans/2026-05-18-agent-harness.md).
 *
 * Problem: `ctxloom init` writes agent-rule blocks into user-editable
 * files (CLAUDE.md, AGENTS.md, GEMINI.md). Users may add their own
 * content around the blocks. We need to:
 *
 *   1. Replace ONLY the block on re-install — preserve user content
 *      outside the markers
 *   2. Detect tampering — if a user hand-edits the block we want CI to
 *      flag it (drift test) so they re-run `ctxloom init` instead of
 *      silently shipping a stale block
 *
 * Block format:
 *   <!-- BEGIN CTXLOOM-RULES v:1 hmac:sha256:abc123... -->
 *   [canonical content]
 *   <!-- END CTXLOOM-RULES -->
 *
 * The HMAC is computed over the canonical content (NOT including the
 * markers themselves). Tampering detection: re-compute the HMAC from
 * the on-disk content and compare to the declared HMAC.
 *
 * The HMAC is for drift detection, not security: anyone with the source
 * tree can compute the same HMAC, so a determined attacker can produce
 * a valid-signature stale block. The goal is to catch good-faith
 * desync — hand-edits during routine maintenance — and force a
 * re-install. For authenticated-block use cases (signed plugins,
 * tamper-resistant deployments) the key would need to be secret +
 * per-deployment; that's not the design here.
 */
import crypto from 'node:crypto';

/**
 * Published HMAC key. Drift-detection-only — never an auth boundary.
 * Documented in the design doc so anyone can verify a block.
 *
 * Override via `CTXLOOM_INSTALL_KEY` env var for self-hosted or
 * private-fork deployments that want their own signing namespace.
 *
 * @internal
 */
export const DEFAULT_HMAC_KEY = 'ctxloom-agent-harness-v1-published';

/**
 * Resolve the active HMAC key. Reads `CTXLOOM_INSTALL_KEY` if set,
 * else falls back to `DEFAULT_HMAC_KEY`.
 *
 * @internal
 */
export function resolveHmacKey(): string {
  return process.env.CTXLOOM_INSTALL_KEY ?? DEFAULT_HMAC_KEY;
}

/**
 * Compute the HMAC-SHA256 of canonical content. Returns the hex-
 * encoded digest (64 chars). The block marker carries the full digest;
 * we trade marker compactness for unambiguous comparison.
 *
 * @public
 */
export function computeBlockHmac(content: string, key: string = resolveHmacKey()): string {
  return crypto.createHmac('sha256', key).update(content, 'utf-8').digest('hex');
}

/**
 * Build the wrapped block string given canonical content + a block
 * name. Block name forms the marker identifier (CTXLOOM-RULES,
 * CTXLOOM-HOOKS, etc.) and disambiguates multiple blocks in the same
 * file. Currently we ship one block per file so this is forward-looking.
 *
 * @public
 */
export function wrapBlock(name: string, content: string): string {
  const hmac = computeBlockHmac(content);
  return [
    `<!-- BEGIN ${name} v:1 hmac:sha256:${hmac} -->`,
    content,
    `<!-- END ${name} -->`,
  ].join('\n');
}

/**
 * Extract the block named `name` from `fileContent` if present, else
 * return null. Returns the canonical inner content + the declared
 * HMAC so callers can verify drift independently.
 *
 * @public
 */
export interface ExtractedBlock {
  /** Canonical content WITHOUT the marker lines. */
  content: string;
  /** Declared HMAC as parsed from the start marker. */
  declaredHmac: string;
  /** Block schema version (currently 1). */
  version: number;
  /** Byte offset of the start marker — useful for in-place replacement. */
  start: number;
  /** Byte offset past the end marker — useful for in-place replacement. */
  end: number;
}

const START_RE_TEMPLATE = (name: string): RegExp =>
  new RegExp(`<!-- BEGIN ${escapeRegex(name)} v:(\\d+) hmac:sha256:([0-9a-f]{64}) -->`);
const END_RE_TEMPLATE = (name: string): RegExp =>
  new RegExp(`<!-- END ${escapeRegex(name)} -->`);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractBlock(fileContent: string, name: string): ExtractedBlock | null {
  const startRe = START_RE_TEMPLATE(name);
  const endRe = END_RE_TEMPLATE(name);
  const startMatch = startRe.exec(fileContent);
  if (!startMatch) return null;
  const startIdx = startMatch.index;
  const afterStart = startIdx + startMatch[0].length;
  endRe.lastIndex = afterStart;
  const endMatch = endRe.exec(fileContent.slice(afterStart));
  if (!endMatch) return null;
  const endIdx = afterStart + endMatch.index + endMatch[0].length;

  // Inner content: between start-marker end and end-marker start.
  // Trim the surrounding newlines that `wrapBlock` added.
  let inner = fileContent.slice(afterStart, afterStart + endMatch.index);
  if (inner.startsWith('\n')) inner = inner.slice(1);
  if (inner.endsWith('\n')) inner = inner.slice(0, -1);

  return {
    content: inner,
    declaredHmac: startMatch[2],
    version: Number(startMatch[1]),
    start: startIdx,
    end: endIdx,
  };
}

/**
 * Verify that the extracted block's declared HMAC matches the HMAC
 * computed from its on-disk content. Returns `true` if intact,
 * `false` if tampered (or if the file's content has drifted from the
 * canonical we'd produce now).
 *
 * @public
 */
export function verifyBlock(block: ExtractedBlock): boolean {
  return computeBlockHmac(block.content) === block.declaredHmac;
}

/**
 * Replace an existing block in `fileContent` with the new canonical
 * content (re-wrapped with a fresh HMAC). If no block exists, the
 * new block is appended to the end with a single blank-line separator.
 *
 * Preserves the user's content outside the markers verbatim.
 *
 * @public
 */
export function upsertBlock(fileContent: string, name: string, newContent: string): string {
  const wrapped = wrapBlock(name, newContent);
  const existing = extractBlock(fileContent, name);
  if (existing) {
    return fileContent.slice(0, existing.start) + wrapped + fileContent.slice(existing.end);
  }
  // No existing block — append.
  const sep = fileContent.length === 0 || fileContent.endsWith('\n\n') ? '' : fileContent.endsWith('\n') ? '\n' : '\n\n';
  return fileContent + sep + wrapped + '\n';
}
