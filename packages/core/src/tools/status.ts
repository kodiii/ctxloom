import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { ProjectRootField, PROJECT_ROOT_JSON_SCHEMA } from './projectRootParam.js';
import type { ProjectStateManager } from '../server/ProjectStateManager.js';
import type { RegisteredRepo } from './cross-repo-search.js';

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface RenderStatusInput {
  defaultRoot: string | null;
  manager: ProjectStateManager;
  registry: { list(): Pick<RegisteredRepo, 'root' | 'alias' | 'name' | 'dbPath' | 'registeredAt'>[] };
}

export function renderStatusXml(input: RenderStatusInput): string {
  const { defaultRoot, manager, registry } = input;
  const lines = ['<ctx_status>'];

  if (defaultRoot) {
    lines.push(`  <project_root>${escapeXML(defaultRoot)}</project_root>`);
    const state = manager.has(defaultRoot) ? manager.get(defaultRoot) : null;
    if (state?.graphInitialized && state.graphPromise) {
      lines.push('  <graph status="ready" />');
    } else {
      lines.push('  <graph status="not_initialized" />');
    }
  } else {
    lines.push('  <no_default_project reason="server boot validation failed; pass project_root explicitly" />');
  }

  // ─── active_projects ──────────────────────────────────────────────────
  const active = manager.list();
  lines.push(`  <active_projects count="${active.length}" max="${manager.max}">`);
  for (const s of active) {
    const reg = registry.list().find((r) => r.root === s.projectRoot);
    const alias = reg?.alias ? ` alias="${escapeXML(reg.alias)}"` : '';
    const graphState = s.graphInitialized ? 'ready' : s.graphPromise ? 'building' : 'cold';
    const vectorsState = s.vectorsInitialized ? 'ready' : s.storePromise ? 'building' : 'cold';
    lines.push(
      `    <project root="${escapeXML(s.projectRoot)}"${alias} ` +
      `pinned="${s.pinned}" graph="${graphState}" vectors="${vectorsState}" ` +
      `last_touched_at="${new Date(s.lastTouchedAt).toISOString()}" />`,
    );
  }
  lines.push('  </active_projects>');

  // ─── registered_projects ──────────────────────────────────────────────
  const registered = registry.list();
  lines.push(`  <registered_projects count="${registered.length}">`);
  for (const r of registered) {
    const alias = r.alias ? ` alias="${escapeXML(r.alias)}"` : '';
    lines.push(`    <project root="${escapeXML(r.root)}"${alias} name="${escapeXML(r.name)}" />`);
  }
  lines.push('  </registered_projects>');

  lines.push('</ctx_status>');
  return lines.join('\n');
}

export function registerStatusTool(registry: ToolRegistry, ctx: ServerContext): void {
  const Schema = z.object({ project_root: ProjectRootField });

  registry.register(
    'ctx_status',
    {
      name: 'ctx_status',
      description:
        'Return the current status of the ctxloom server. ' +
        'With no project_root: full multi-project view (default + active + registry). ' +
        'With project_root: details for that one project.',
      inputSchema: {
        type: 'object',
        properties: {
          project_root: PROJECT_ROOT_JSON_SCHEMA,
        },
      },
    },
    async (args) => {
      const { project_root } = Schema.parse(args ?? {});
      void project_root; // used in Phase 6 for per-project view
      return renderStatusXml({
        defaultRoot: ctx.noDefaultMode ? null : ctx.projectRoot,
        manager: ctx.stateManager,
        registry: ctx.registry,
      });
    },
  );
}
