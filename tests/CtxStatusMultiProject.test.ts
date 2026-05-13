import { describe, it, expect } from 'vitest';
import { ProjectStateManager } from '../packages/core/src/server/ProjectStateManager.js';
import { renderStatusXml } from '../packages/core/src/tools/status.js';

describe('ctx_status multi-project rendering', () => {
  it('emits active_projects with count and max', () => {
    const mgr = new ProjectStateManager({ maxProjects: 5 });
    mgr.pin('/abs/main');
    mgr.get('/abs/b');
    const out = renderStatusXml({
      defaultRoot: '/abs/main',
      manager: mgr,
      registry: { list: () => [{ root: '/abs/main', alias: 'main', name: 'main', dbPath: '', registeredAt: '' }] },
    });
    expect(out).toMatch(/<active_projects count="2" max="5">/);
    expect(out).toMatch(/root="\/abs\/main".*pinned="true"/);
    expect(out).toMatch(/<registered_projects count="1">/);
  });

  it('emits no_default_project marker when defaultRoot is null', () => {
    const mgr = new ProjectStateManager({ maxProjects: 5 });
    const out = renderStatusXml({
      defaultRoot: null,
      manager: mgr,
      registry: { list: () => [] },
    });
    expect(out).toMatch(/<no_default_project/);
  });
});
