import { describe, it, expect, vi } from 'vitest';
import { Tools } from '../../src/client/tools.js';

function fakeManager() {
  return {
    callTool: vi.fn(async (name: string, args: Record<string, unknown>) => ({ content: [{ type: 'text', text: JSON.stringify({ name, args }) }] })),
  };
}

describe('Tools', () => {
  it('riskOverlay returns parsed score and label for one file', async () => {
    const sm = fakeManager();
    sm.callTool = vi.fn(async () => ({ content: [{ type: 'text', text: '<risk_overlay><file path="a.ts" score="0.42" label="medium" top_owner="alice" /></risk_overlay>' }] }));
    const t = new Tools(sm as never);
    const r = await t.riskOverlay('a.ts');
    expect(r).toEqual({ file: 'a.ts', score: 0.42, label: 'medium', topOwner: 'alice' });
  });

  it('riskOverlay returns null when file is missing from response', async () => {
    const sm = fakeManager();
    sm.callTool = vi.fn(async () => ({ content: [{ type: 'text', text: '<risk_overlay></risk_overlay>' }] }));
    const t = new Tools(sm as never);
    const r = await t.riskOverlay('a.ts');
    expect(r).toBeNull();
  });

  it('blastRadius returns counts and entries', async () => {
    const sm = fakeManager();
    sm.callTool = vi.fn(async () => ({ content: [{ type: 'text', text: '{"direct":["b.ts"],"transitive":["c.ts","d.ts"],"historical":[]}' }] }));
    const t = new Tools(sm as never);
    const r = await t.blastRadius('a.ts');
    expect(r).toEqual({ direct: ['b.ts'], transitive: ['c.ts', 'd.ts'], historical: [] });
  });

  it('rulesCheck returns violations with severities', async () => {
    const sm = fakeManager();
    sm.callTool = vi.fn(async () => ({ content: [{ type: 'text', text: '[{"file":"a.ts","line":3,"col":1,"endLine":3,"endCol":10,"rule":"no-cycle","message":"cycle","severity":"error"}]' }] }));
    const t = new Tools(sm as never);
    const r = await t.rulesCheck('a.ts');
    expect(r).toHaveLength(1);
    expect(r[0].severity).toBe('error');
  });

  it('knowledgeGaps returns counts and lists', async () => {
    const sm = fakeManager();
    sm.callTool = vi.fn(async () => ({ content: [{ type: 'text', text: '<knowledge_gaps><isolated_files count="2"><f>a.ts</f><f>b.ts</f></isolated_files><dead_code_candidates count="1"><f>c.ts</f></dead_code_candidates></knowledge_gaps>' }] }));
    const t = new Tools(sm as never);
    const r = await t.knowledgeGaps();
    expect(r.isolated.length).toBe(2);
    expect(r.deadCode).toEqual(['c.ts']);
  });

  it('contextPacket returns text + token estimate', async () => {
    const sm = fakeManager();
    sm.callTool = vi.fn(async () => ({ content: [{ type: 'text', text: '{"text":"export fn();","fullTokens":1200,"skeletonTokens":120,"reductionPercent":90}' }] }));
    const t = new Tools(sm as never);
    const r = await t.contextPacket('a.ts', 'fn');
    expect(r.text).toContain('fn');
    expect(r.skeletonTokens).toBe(120);
    expect(r.reductionPercent).toBe(90);
  });
});
