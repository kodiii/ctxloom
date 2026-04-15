import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../src/tools/registry.js';

describe('ToolRegistry', () => {
  it('registers a tool and lists it', () => {
    const registry = new ToolRegistry();
    registry.register(
      'test_tool',
      { name: 'test_tool', description: 'A test tool', inputSchema: { type: 'object', properties: {} } },
      async () => 'result',
    );
    const tools = registry.list();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('test_tool');
  });

  it('dispatches to the registered handler', async () => {
    const registry = new ToolRegistry();
    registry.register(
      'echo',
      { name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: {} } },
      async (args) => JSON.stringify(args),
    );
    const result = await registry.dispatch('echo', { hello: 'world' });
    expect(result).toBe('{"hello":"world"}');
  });

  it('throws on unknown tool', async () => {
    const registry = new ToolRegistry();
    await expect(registry.dispatch('unknown', {})).rejects.toThrow('Unknown tool: unknown');
  });

  it('has() returns true for registered tools only', () => {
    const registry = new ToolRegistry();
    registry.register(
      'foo',
      { name: 'foo', description: '', inputSchema: { type: 'object', properties: {} } },
      async () => '',
    );
    expect(registry.has('foo')).toBe(true);
    expect(registry.has('bar')).toBe(false);
  });
});
