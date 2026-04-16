import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerGetWorkflowTool } from '../src/tools/get-workflow.js';
import type { ServerContext } from '../src/tools/context.js';

function makeCtx(): ServerContext {
  return {
    projectRoot: '/fake',
    dbPath: '/fake/.ctxloom/vectors.lancedb',
    getStore: () => Promise.reject(new Error('not needed')),
    getGraph: () => Promise.reject(new Error('not needed')),
    getParser: () => Promise.reject(new Error('not needed')),
    getSkeletonizer: () => Promise.reject(new Error('not needed')),
    getRuleManager: () => { throw new Error('not needed'); },
    getPathValidator: () => { throw new Error('not needed'); },
    isStoreInitialized: () => false,
    isGraphInitialized: () => false,
    isParserInitialized: () => false,
  };
}

describe('ctx_get_workflow', () => {
  it('returns XML workflow element', async () => {
    const registry = new ToolRegistry();
    registerGetWorkflowTool(registry, makeCtx());
    const result = await registry.dispatch('ctx_get_workflow', { workflow: 'review' });
    expect(result).toContain('<workflow');
    expect(result).toContain('</workflow>');
  });

  it('returns review workflow with tool references', async () => {
    const registry = new ToolRegistry();
    registerGetWorkflowTool(registry, makeCtx());
    const result = await registry.dispatch('ctx_get_workflow', { workflow: 'review' });
    expect(result).toContain('ctx_git_diff_review');
    expect(result).toContain('ctx_detect_changes');
  });

  it('returns onboard workflow with architecture step', async () => {
    const registry = new ToolRegistry();
    registerGetWorkflowTool(registry, makeCtx());
    const result = await registry.dispatch('ctx_get_workflow', { workflow: 'onboard' });
    expect(result).toContain('ctx_architecture_overview');
  });

  it('returns refactor workflow with preview and apply steps', async () => {
    const registry = new ToolRegistry();
    registerGetWorkflowTool(registry, makeCtx());
    const result = await registry.dispatch('ctx_get_workflow', { workflow: 'refactor' });
    expect(result).toContain('ctx_refactor_preview');
    expect(result).toContain('ctx_apply_refactor');
  });

  it('returns all 5 workflows without error', async () => {
    const registry = new ToolRegistry();
    registerGetWorkflowTool(registry, makeCtx());
    for (const w of ['review', 'debug', 'onboard', 'refactor', 'audit']) {
      const result = await registry.dispatch('ctx_get_workflow', { workflow: w });
      expect(result).toContain('<workflow');
    }
  });
});
