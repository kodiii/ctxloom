import { describe, it, expect } from 'vitest';
import { DependencyGraph, GitOverlayStore } from '@ctxloom/core';

describe('@ctxloom/core public API smoke', () => {
  it('exports DependencyGraph', () => {
    expect(typeof DependencyGraph).toBe('function');
  });
  it('exports GitOverlayStore', () => {
    expect(typeof GitOverlayStore).toBe('function');
  });
});
