import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../utils/logger.js';
import {
  getTaskBudgetTracker,
  applyOverBudgetOverrides,
  emitTaskBudgetBreached,
} from '../budget/taskBudget.js';

export type ToolHandler = (args: unknown) => Promise<string>;

export interface ToolDefinition {
  schema: Tool;
  handler: ToolHandler;
}

/**
 * Tools exempt from task-budget enforcement. These are either:
 *
 *   - The orientation anchor (must remain free so the agent can
 *     re-orient mid-task), or
 *   - Cheap-by-design diagnostics (status, get_workflow, get_rules)
 *     that don't consume meaningful tokens
 *
 * Listing here is the v1.5 substitute for an explicit "cheap tool"
 * flag in the schema. If this list grows large, promote it to a
 * registry-level annotation.
 *
 * @internal
 */
const TASK_BUDGET_EXEMPT = new Set<string>([
  'ctx_get_minimal_context',
  'ctx_status',
  'ctx_get_workflow',
  'ctx_get_rules',
  'ctx_suggested_questions',
]);

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(name: string, schema: Tool, handler: ToolHandler): void {
    this.tools.set(name, { schema, handler });
  }

  list(): Tool[] {
    return Array.from(this.tools.values()).map(t => t.schema);
  }

  async dispatch(name: string, args: unknown): Promise<string> {
    const def = this.tools.get(name);
    if (!def) throw new Error(`Unknown tool: ${name}`);
    const projectRoot =
      args && typeof args === 'object' && 'project_root' in args
        ? (args as Record<string, unknown>).project_root
        : undefined;
    logger.debug('tool.dispatch', { tool: name, project_root: projectRoot });

    // ─── Phase 4a: task-tool budget enforcement ──────────────────
    //
    // Track every tool call against a per-task counter. When the
    // agent exceeds the protocol target (default 8 calls per task,
    // configurable via CTXLOOM_TASK_TOOL_BUDGET), inject skeleton/
    // minimal-mode overrides into args so subsequent responses are
    // cheap even if the caller asked for full responses. Exempt
    // tools (see TASK_BUDGET_EXEMPT) are not counted — the
    // orientation anchor MUST always be available for re-orientation.
    let dispatchArgs = args;
    if (!TASK_BUDGET_EXEMPT.has(name)) {
      const decision = getTaskBudgetTracker().recordCall();
      if (decision.overBudget) {
        dispatchArgs = applyOverBudgetOverrides(args);
        if (decision.firstBreach) {
          // Surface a single warn line + one telemetry event per task.
          logger.warn('task tool budget exceeded — auto-throttling responses to skeleton/minimal', {
            tool: name,
            calls: decision.callCount,
            budget: decision.maxCalls,
          });
          emitTaskBudgetBreached(name, decision.callCount, decision.maxCalls);
        }
      }
    }

    return def.handler(dispatchArgs);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}
