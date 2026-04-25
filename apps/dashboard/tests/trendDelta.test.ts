import { describe, it, expect } from 'vitest';
import { computeDelta } from '../client/src/lib/trendDelta.js';

describe('computeDelta', () => {
  it('returns "stable" when change is under 1%', () => {
    const r = computeDelta(100, 100.5, 'down');
    expect(r.label).toBe('→ stable');
    expect(r.tone).toBe('neutral');
  });

  it('returns good tone when metric improves in goodDirection=down', () => {
    const r = computeDelta(100, 80, 'down');
    expect(r.label).toBe('↓ 20%');
    expect(r.tone).toBe('good');
  });

  it('returns bad tone when metric worsens in goodDirection=down', () => {
    const r = computeDelta(100, 120, 'down');
    expect(r.label).toBe('↑ 20%');
    expect(r.tone).toBe('bad');
  });

  it('returns good tone when metric rises in goodDirection=up', () => {
    const r = computeDelta(2.0, 2.4, 'up');
    expect(r.label).toBe('↑ 20%');
    expect(r.tone).toBe('good');
  });

  it('handles zero baseline without crashing', () => {
    const r = computeDelta(0, 5, 'up');
    expect(r.label).toBe('↑ new');
    expect(r.tone).toBe('good');
  });
});
