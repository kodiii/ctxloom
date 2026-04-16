import { describe, it, expect } from 'vitest';
import { CallGraphIndex } from '../src/graph/CallGraphIndex.js';

describe('CallGraphConfidence', () => {
  it('CallEdge includes confidence field', () => {
    const idx = new CallGraphIndex();
    idx.addEdge({ callerFile: 'a.ts', callerSymbol: 'foo', calleeSymbol: 'bar', confidence: 'extracted' });
    const callers = idx.getCallers('bar');
    expect(callers[0]).toHaveProperty('confidence', 'extracted');
  });

  it('defaults confidence to "extracted" when not specified', () => {
    const idx = new CallGraphIndex();
    idx.addEdge({ callerFile: 'a.ts', callerSymbol: 'foo', calleeSymbol: 'bar' });
    const callers = idx.getCallers('bar');
    expect(callers[0].confidence).toBe('extracted');
  });

  it('serializes and deserializes confidence via toJSON/fromJSON', () => {
    const idx = new CallGraphIndex();
    idx.addEdge({ callerFile: 'a.ts', callerSymbol: 'foo', calleeSymbol: 'bar', confidence: 'inferred' });
    const json = idx.toJSON();
    const idx2 = CallGraphIndex.fromJSON(json);
    expect(idx2.getCallers('bar')[0].confidence).toBe('inferred');
  });

  it('getCallers filters by confidence when requested', () => {
    const idx = new CallGraphIndex();
    idx.addEdge({ callerFile: 'a.ts', callerSymbol: 'foo', calleeSymbol: 'baz', confidence: 'extracted' });
    idx.addEdge({ callerFile: 'b.ts', callerSymbol: 'bar', calleeSymbol: 'baz', confidence: 'inferred' });
    const extracted = idx.getCallers('baz', 'extracted');
    expect(extracted).toHaveLength(1);
    expect(extracted[0].callerSymbol).toBe('foo');
  });
});
