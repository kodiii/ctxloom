import { describe, it, expect } from 'vitest';
import { renderInline } from '../src/review/renderInline.js';
import type { ReviewPayload } from '../src/review/types.js';
import { DEFAULT_CONFIG } from '../src/config.js';

const PR = {
  owner: 'acme',
  repo: 'api',
  number: 42,
  headSha: 'inlinesha',
  baseSha: 'base000',
};

function makePayload(overrides: Partial<ReviewPayload> = {}): ReviewPayload {
  return {
    pr: PR,
    riskScore: 0.5,
    riskLabel: 'medium',
    changedFiles: [
      {
        file: 'src/auth.ts',
        riskLevel: 'high',
        importerCount: 5,
        isHub: true,
        hasTestCoverage: false,
        risk: {
          churn: 'high',
          bugDensity: 0.7,
          coupledNodes: [{ node: 'src/user.ts', confidence: 0.85 }],
          owners: [{ author: 'alice', share: 0.6 }],
        },
      },
    ],
    impact: {
      seedFiles: ['src/auth.ts'],
      directImporters: ['src/app.ts', 'src/middleware.ts'],
      transitiveImporters: [],
      historicalCoupling: [],
      totalImpacted: 2,
    },
    suggestedReviewers: [],
    config: DEFAULT_CONFIG,
    ...overrides,
  };
}

describe('renderInline', () => {
  it('returns null for files not in payload.changedFiles', () => {
    const payload = makePayload();
    const file = {
      file: 'src/not-changed.ts',
      riskLevel: 'low' as const,
      importerCount: 0,
      isHub: false,
      hasTestCoverage: true,
      risk: null,
    };
    const result = renderInline(file, payload);
    expect(result).toBeNull();
  });

  it('returns an InlineComment with correct path, line, side, and body', () => {
    const payload = makePayload();
    const file = payload.changedFiles[0];
    const result = renderInline(file, payload);

    expect(result).not.toBeNull();
    expect(result?.path).toBe('src/auth.ts');
    expect(result?.line).toBeGreaterThan(0);
    expect(typeof result?.line).toBe('number');
    expect(result?.side).toBe('RIGHT');
    expect(typeof result?.body).toBe('string');
  });

  it('body contains the blast radius caller count', () => {
    const payload = makePayload();
    const file = payload.changedFiles[0];
    const result = renderInline(file, payload);

    // importerCount is 5
    expect(result?.body).toContain('5');
  });

  it('body contains the inline marker with headSha', () => {
    const payload = makePayload();
    const file = payload.changedFiles[0];
    const result = renderInline(file, payload);

    expect(result?.body).toContain(`<!-- ctxloom:inline:${PR.headSha} -->`);
  });

  it('body contains top coupled sibling when coupling data is present', () => {
    const payload = makePayload();
    const file = payload.changedFiles[0];
    const result = renderInline(file, payload);

    expect(result?.body).toContain('src/user.ts');
  });

  it('returns null for file with importerCount 0 and no risk', () => {
    const payload = makePayload({
      changedFiles: [
        {
          file: 'src/trivial.ts',
          riskLevel: 'low',
          importerCount: 0,
          isHub: false,
          hasTestCoverage: true,
          risk: null,
        },
      ],
    });
    const file = payload.changedFiles[0];
    const result = renderInline(file, payload);
    expect(result).toBeNull();
  });

  it('returns non-null for file with importerCount > 0 even with no risk overlay', () => {
    const payload = makePayload({
      changedFiles: [
        {
          file: 'src/shared.ts',
          riskLevel: 'medium',
          importerCount: 3,
          isHub: false,
          hasTestCoverage: false,
          risk: null,
        },
      ],
    });
    const file = payload.changedFiles[0];
    const result = renderInline(file, payload);
    expect(result).not.toBeNull();
  });
});
