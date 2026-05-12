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

  it('tracks graph and vectors tiers independently per root', () => {
    const t = new FirstTouchTracker();
    // First call per root+tier always returns true
    expect(t.markAndCheck('/abs/foo', 'graph')).toBe(true);
    expect(t.markAndCheck('/abs/foo', 'vectors')).toBe(true);
    // Subsequent calls always return false
    expect(t.markAndCheck('/abs/foo', 'graph')).toBe(false);
    expect(t.markAndCheck('/abs/foo', 'vectors')).toBe(false);
    // Different root has its own fresh state
    expect(t.markAndCheck('/abs/bar', 'vectors')).toBe(true);
    expect(t.markAndCheck('/abs/bar', 'vectors')).toBe(false);
  });

  it('reset() clears both tiers for a root, leaving other roots untouched', () => {
    const t = new FirstTouchTracker();
    t.markAndCheck('/abs/foo', 'graph');
    t.markAndCheck('/abs/foo', 'vectors');
    t.markAndCheck('/abs/bar', 'graph');
    t.reset('/abs/foo');
    // foo tiers reset — next call returns true again
    expect(t.markAndCheck('/abs/foo', 'graph')).toBe(true);
    expect(t.markAndCheck('/abs/foo', 'vectors')).toBe(true);
    // bar unaffected
    expect(t.markAndCheck('/abs/bar', 'graph')).toBe(false);
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

  it('emits vectors tier envelope with records attribute when provided', () => {
    const wrapped = wrapWithIndexingEnvelope(
      { firstTouch: true, projectRoot: '/abs/foo', tier: 'vectors', durationMs: 1200, records: 512 },
      '<search_results />',
    );
    expect(wrapped).toMatch(
      /^<ctxloom_indexing first_touch="true" project_root="\/abs\/foo" tier="vectors" duration_ms="1200" records="512" \/>\n<search_results \/>$/,
    );
  });

  it('emits vectors tier envelope without records attribute when not provided', () => {
    const wrapped = wrapWithIndexingEnvelope(
      { firstTouch: true, projectRoot: '/abs/foo', tier: 'vectors', durationMs: 800 },
      '<search_results />',
    );
    expect(wrapped).toContain('tier="vectors"');
    expect(wrapped).not.toContain('records=');
    expect(wrapped).not.toContain('files_indexed=');
  });

  it('escapes special characters in projectRoot for XML attribute safety', () => {
    const wrapped = wrapWithIndexingEnvelope(
      { firstTouch: true, projectRoot: '/abs/foo & "bar"', tier: 'vectors', durationMs: 0 },
      '<r />',
    );
    expect(wrapped).toContain('project_root="/abs/foo &amp; &quot;bar&quot;"');
  });
});
