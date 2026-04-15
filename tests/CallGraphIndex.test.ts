import { describe, it, expect } from 'vitest';
import { CallGraphIndex } from '../src/graph/CallGraphIndex.js';

describe('CallGraphIndex', () => {
  it('tracks callers of a symbol', () => {
    const idx = new CallGraphIndex();
    idx.addEdge({ callerFile: 'src/a.ts', callerSymbol: 'foo', calleeSymbol: 'bar', line: 10 });
    const callers = idx.getCallers('bar');
    expect(callers).toHaveLength(1);
    expect(callers[0]).toEqual({ file: 'src/a.ts', symbol: 'foo' });
  });

  it('returns empty array for unknown callee', () => {
    const idx = new CallGraphIndex();
    expect(idx.getCallers('unknown')).toEqual([]);
  });

  it('deduplicates identical edges', () => {
    const idx = new CallGraphIndex();
    idx.addEdge({ callerFile: 'a.ts', callerSymbol: 'fn', calleeSymbol: 'x', line: 1 });
    idx.addEdge({ callerFile: 'a.ts', callerSymbol: 'fn', calleeSymbol: 'x', line: 1 });
    expect(idx.getCallers('x')).toHaveLength(1);
  });

  it('returns multiple callers from different files', () => {
    const idx = new CallGraphIndex();
    idx.addEdge({ callerFile: 'a.ts', callerSymbol: 'alpha', calleeSymbol: 'z', line: 5 });
    idx.addEdge({ callerFile: 'b.ts', callerSymbol: 'beta', calleeSymbol: 'z', line: 3 });
    expect(idx.getCallers('z')).toHaveLength(2);
  });

  it('serializes and deserializes correctly', () => {
    const idx = new CallGraphIndex();
    idx.addEdge({ callerFile: 'a.ts', callerSymbol: 'foo', calleeSymbol: 'bar', line: 1 });
    const restored = CallGraphIndex.fromJSON(idx.toJSON());
    expect(restored.getCallers('bar')).toHaveLength(1);
    expect(restored.getCallers('bar')[0]).toEqual({ file: 'a.ts', symbol: 'foo' });
  });

  it('size() counts total edges', () => {
    const idx = new CallGraphIndex();
    idx.addEdge({ callerFile: 'a.ts', callerSymbol: 'f1', calleeSymbol: 'x', line: 1 });
    idx.addEdge({ callerFile: 'b.ts', callerSymbol: 'f2', calleeSymbol: 'x', line: 2 });
    idx.addEdge({ callerFile: 'a.ts', callerSymbol: 'f1', calleeSymbol: 'y', line: 3 });
    expect(idx.size()).toBe(3);
  });
});
