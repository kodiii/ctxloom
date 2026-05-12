/**
 * StructuredErrorWiring.test.ts
 *
 * Verifies the XML contract for the three error kinds that the
 * CallToolRequest handler in src/server.ts converts from thrown Error
 * objects into structured XML tool responses (Task 6.3).
 *
 * We test the error-building functions directly (imported from @ctxloom/core)
 * because spinning up a full MCP server in tests is impractical. These tests
 * confirm that the XML produced by each builder matches what the handler
 * would embed in the `content[0].text` field.
 */
import { describe, it, expect } from 'vitest';
import {
  noDefaultProjectError,
  projectRootNotFoundError,
  aliasNotFoundError,
} from '../packages/core/src/server/structuredErrors.js';

// ─── Simulated handler logic ─────────────────────────────────────────────────
//
// The handler in src/server.ts does:
//
//   if (err.message === 'no_default_project') → noDefaultProjectError(...)
//   if (err.message.startsWith('{'))          → JSON.parse → aliasNotFoundError
//                                              → projectRootNotFoundError
//
// We replicate that dispatch logic here so the tests also cover the
// branching path, not just the XML builders in isolation.

function dispatchError(errMessage: string, registeredAliases: string[]): string {
  if (errMessage === 'no_default_project') {
    return noDefaultProjectError({
      attemptedRoot: '/fake/root',
      resolutionChain: 'CTXLOOM_ROOT env var→unset, fallback_cwd→/fake/root',
      registeredAliases,
    });
  }
  if (errMessage.startsWith('{')) {
    try {
      const parsed = JSON.parse(errMessage) as Record<string, unknown>;
      if (parsed.kind === 'alias_not_found') {
        return aliasNotFoundError({
          alias: String(parsed.alias ?? ''),
          didYouMean: Array.isArray(parsed.didYouMean) ? (parsed.didYouMean as string[]) : [],
        });
      }
      if (parsed.kind === 'project_root_not_found') {
        return projectRootNotFoundError({
          path: String(parsed.attemptedPath ?? ''),
          resolutionChain: String(parsed.resolutionChain ?? ''),
        });
      }
    } catch {
      // JSON.parse failed — not a structured error
    }
  }
  return `Error: ${errMessage}`;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('StructuredErrorWiring — handler error dispatch', () => {
  describe('no_default_project', () => {
    it('returns XML with error code="no_default_project"', () => {
      const xml = dispatchError('no_default_project', ['myapp', 'api']);
      expect(xml).toMatch(/<error code="no_default_project"/);
    });

    it('includes attempted_root in the output', () => {
      const xml = dispatchError('no_default_project', []);
      expect(xml).toMatch(/attempted_root="/);
    });

    it('includes registered aliases in the hint', () => {
      const xml = dispatchError('no_default_project', ['alpha', 'beta']);
      expect(xml).toMatch(/Registered aliases:.*'alpha'.*'beta'/);
    });
  });

  describe('alias_not_found', () => {
    it('returns XML with error code="alias_not_found"', () => {
      const payload = JSON.stringify({ kind: 'alias_not_found', alias: 'fooo', didYouMean: ['foo', 'foobar'] });
      const xml = dispatchError(payload, []);
      expect(xml).toMatch(/<error code="alias_not_found"/);
    });

    it('includes the unrecognised alias', () => {
      const payload = JSON.stringify({ kind: 'alias_not_found', alias: 'myrepo', didYouMean: [] });
      const xml = dispatchError(payload, []);
      expect(xml).toMatch(/alias="myrepo"/);
    });

    it('includes did_you_mean suggestions', () => {
      const payload = JSON.stringify({ kind: 'alias_not_found', alias: 'apii', didYouMean: ['api', 'api-v2'] });
      const xml = dispatchError(payload, []);
      expect(xml).toMatch(/did_you_mean=".*'api'.*'api-v2'.*"/);
    });
  });

  describe('project_root_not_found', () => {
    it('returns XML with error code="project_root_not_found"', () => {
      const payload = JSON.stringify({
        kind: 'project_root_not_found',
        attemptedPath: '/nonexistent/path',
        resolutionChain: 'arg:/nonexistent/path→/nonexistent/path',
      });
      const xml = dispatchError(payload, []);
      expect(xml).toMatch(/<error code="project_root_not_found"/);
    });

    it('includes the attempted path', () => {
      const payload = JSON.stringify({
        kind: 'project_root_not_found',
        attemptedPath: '/bad/path',
        resolutionChain: 'arg:/bad/path→/bad/path',
      });
      const xml = dispatchError(payload, []);
      expect(xml).toMatch(/path="\/bad\/path"/);
    });

    it('includes the resolution chain', () => {
      const payload = JSON.stringify({
        kind: 'project_root_not_found',
        attemptedPath: '/x',
        resolutionChain: 'env:CTXLOOM_ROOT→/x',
      });
      const xml = dispatchError(payload, []);
      expect(xml).toMatch(/resolution_chain="/);
    });
  });

  describe('unrecognised errors fall through', () => {
    it('returns a plain Error: string for unknown errors', () => {
      const result = dispatchError('something went wrong', []);
      expect(result).toBe('Error: something went wrong');
    });

    it('returns a plain Error: string when JSON has unknown kind', () => {
      const payload = JSON.stringify({ kind: 'unknown_kind', detail: 'oops' });
      const result = dispatchError(payload, []);
      expect(result).toBe(`Error: ${payload}`);
    });
  });
});
