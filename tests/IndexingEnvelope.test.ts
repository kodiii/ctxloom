import { describe, it, expect } from 'vitest';
import { wrapWithIndexingEnvelope, FirstTouchTracker } from '../packages/core/src/server/indexingEnvelope.js';

describe('FirstTouchTracker', () => {
  it('returns true on the first call for a root+tier, false thereafter', () => {
    const t = new FirstTouchTracker();
    expect(t.markAndCheck('/abs/foo', 'graph')).toBe(true);
    expect(t.markAndCheck('/abs/foo', 'graph')).toBe(false);
    expect(t.markAndCheck('/abs/foo', 'vectors')).toBe(true);
    expect(t.markAndCheck('/abs/bar', 'graph')).toBe(true);
  });
});

describe('wrapWithIndexingEnvelope', () => {
  it('prepends envelope when first_touch is true', () => {
    const wrapped = wrapWithIndexingEnvelope(
      { firstTouch: true, projectRoot: '/abs/foo', tier: 'graph', durationMs: 4823, filesIndexed: 847 },
      '<some_result />',
    );
    expect(wrapped).toMatch(/^<ctxloom_indexing first_touch="true" project_root="\/abs\/foo" tier="graph" duration_ms="4823" files_indexed="847" \/>\n<some_result \/>$/);
  });

  it('passes through unchanged when first_touch is false', () => {
    const wrapped = wrapWithIndexingEnvelope(
      { firstTouch: false, projectRoot: '/abs/foo', tier: 'graph', durationMs: 0 },
      '<some_result />',
    );
    expect(wrapped).toBe('<some_result />');
  });
});
