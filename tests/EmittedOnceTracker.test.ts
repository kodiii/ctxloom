import { describe, it, expect } from 'vitest';
import { EmittedOnceTracker } from '@ctxloom/core';

describe('EmittedOnceTracker', () => {
  it('returns true on the first markAndCheck for a given key', () => {
    const tracker = new EmittedOnceTracker();
    expect(tracker.markAndCheck('project_resolved:/Users/foo/proj')).toBe(true);
  });

  it('returns false on subsequent calls with the same key', () => {
    const tracker = new EmittedOnceTracker();
    tracker.markAndCheck('key-a');
    expect(tracker.markAndCheck('key-a')).toBe(false);
    expect(tracker.markAndCheck('key-a')).toBe(false);
  });

  it('treats different keys independently', () => {
    const tracker = new EmittedOnceTracker();
    tracker.markAndCheck('key-a');
    expect(tracker.markAndCheck('key-b')).toBe(true);
  });

  it('reset() clears all keys', () => {
    const tracker = new EmittedOnceTracker();
    tracker.markAndCheck('key-a');
    tracker.reset();
    expect(tracker.markAndCheck('key-a')).toBe(true);
  });
});
