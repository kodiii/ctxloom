import { describe, it, expect } from 'vitest';
import { buildCodeownersBlock, mergeIntoFile } from '../src/review/CodeownersWriter.js';

const MARKER_START_DETECT = '# <ctxloom:start>';
const MARKER_END = '# <ctxloom:end>';

describe('buildCodeownersBlock', () => {
  it('emits rules with handles prefixed @', () => {
    const rules = [
      { pattern: 'src/auth/**', handles: ['alice', 'bob'] },
      { pattern: 'src/payments/**', handles: ['carol'] },
    ];
    const block = buildCodeownersBlock(rules);
    expect(block).toContain('src/auth/**');
    expect(block).toContain('@alice @bob');
    expect(block).toContain('src/payments/**');
    expect(block).toContain('@carol');
    expect(block).toContain(MARKER_START_DETECT);
    expect(block).toContain(MARKER_END);
  });
});

describe('mergeIntoFile', () => {
  it('appends markers when file has no existing markers', () => {
    const existing = '# hand-written\n/docs/** @docs-team\n';
    const block = `${MARKER_START_DETECT}\nsrc/auth/** @alice\n${MARKER_END}`;
    const result = mergeIntoFile(existing, block);
    expect(result).toContain('# hand-written');
    expect(result).toContain('/docs/** @docs-team');
    expect(result).toContain('src/auth/** @alice');
    expect(result.indexOf('# hand-written')).toBeLessThan(result.indexOf(MARKER_START_DETECT));
  });

  it('replaces content between existing markers', () => {
    const existing = `# hand-written\n${MARKER_START_DETECT}\nold/rule/** @old\n${MARKER_END}\n# footer\n`;
    const block = `${MARKER_START_DETECT}\nnew/rule/** @new\n${MARKER_END}`;
    const result = mergeIntoFile(existing, block);
    expect(result).not.toContain('@old');
    expect(result).toContain('@new');
    expect(result).toContain('# hand-written');
    expect(result).toContain('# footer');
  });

  it('preserves content outside markers exactly', () => {
    const existing = `before\n${MARKER_START_DETECT}\nold\n${MARKER_END}\nafter\n`;
    const block = `${MARKER_START_DETECT}\nnew\n${MARKER_END}`;
    const result = mergeIntoFile(existing, block);
    expect(result.startsWith('before\n')).toBe(true);
    expect(result.endsWith('after\n')).toBe(true);
  });
});
