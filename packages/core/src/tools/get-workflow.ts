/**
 * ctx_get_workflow — Pre-written workflow templates for common AI-assisted tasks.
 * Workflows: review, debug, onboard, refactor, audit.
 */
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { ProjectRootField, PROJECT_ROOT_JSON_SCHEMA } from './projectRootParam.js';

const Schema = z.object({
  workflow: z.enum(['review', 'debug', 'onboard', 'refactor', 'audit']),
  project_root: ProjectRootField,
});

const WORKFLOWS: Record<string, string> = {
  review: `<workflow name="review" title="Code Review Workflow">
  <description>Complete code review using graph-aware tools. Run these steps in order.</description>
  <step order="1" tool="ctx_detect_changes">Risk-score all changed files. Address critical and high items first. Call with: use_git=true</step>
  <step order="2" tool="ctx_git_diff_review">Get the full review packet: diffs, API skeletons, blast radius. Call with: use_git=true, include_skeletons=true, depth=3</step>
  <step order="3" tool="ctx_suggested_questions">Get graph-derived review questions to guide the review. Call with: use_git=true</step>
  <step order="4" tool="ctx_blast_radius">Verify transitive impact. Call with: use_git=true, depth=5</step>
  <step order="5" tool="ctx_knowledge_gaps">Check for untested hubs introduced or worsened by the change.</step>
</workflow>`,

  debug: `<workflow name="debug" title="Debugging Workflow">
  <description>Trace a bug from symptom to root cause using call-graph and dependency tools.</description>
  <step order="1" tool="ctx_search">Find files related to the symptom using semantic search.</step>
  <step order="2" tool="ctx_definition">Locate the definition of the failing function/class.</step>
  <step order="3" tool="ctx_call_graph">Trace callers of the suspected function.</step>
  <step order="4" tool="ctx_execution_flow">Walk the full execution path from entry point to failure.</step>
  <step order="5" tool="ctx_blast_radius">Understand what else could be affected by the fix.</step>
</workflow>`,

  onboard: `<workflow name="onboard" title="Codebase Onboarding Workflow">
  <description>Get up to speed on an unfamiliar codebase in 5 steps.</description>
  <step order="1" tool="ctx_architecture_overview">Get the high-level module map, hub files, and community structure.</step>
  <step order="2" tool="ctx_community_list">Understand the main subsystems and their key files.</step>
  <step order="3" tool="ctx_hub_nodes">Identify the most-imported files — the architectural load-bearers.</step>
  <step order="4" tool="ctx_search">Search for the area you will be working in.</step>
  <step order="5" tool="ctx_context_packet">Get a full context packet for your entry-point file.</step>
</workflow>`,

  refactor: `<workflow name="refactor" title="Safe Refactoring Workflow">
  <description>Rename or restructure a symbol safely using graph-aware tools.</description>
  <step order="1" tool="ctx_definition">Confirm the exact symbol name and definition locations.</step>
  <step order="2" tool="ctx_blast_radius">See the full impact of changing this symbol.</step>
  <step order="3" tool="ctx_refactor_preview">Preview all changes before touching the disk.</step>
  <step order="4" tool="ctx_apply_refactor">Apply the rename. Review the XML output for missed files.</step>
  <step order="5">Run your test suite and build to verify no regressions: npm test &amp;&amp; npm run build</step>
</workflow>`,

  audit: `<workflow name="audit" title="Code Health Audit Workflow">
  <description>Assess architectural health, dead code, and missing coverage.</description>
  <step order="1" tool="ctx_knowledge_gaps">Find isolated files, untested hubs, and dead-code candidates.</step>
  <step order="2" tool="ctx_hub_nodes">List highest-centrality files. Verify each has test coverage.</step>
  <step order="3" tool="ctx_bridge_nodes">Find architectural bridges whose removal would disconnect modules.</step>
  <step order="4" tool="ctx_surprising_connections">Uncover unexpected cross-module couplings.</step>
  <step order="5" tool="ctx_wiki_generate">Generate a Markdown wiki to document current architecture.</step>
</workflow>`,
};

export function registerGetWorkflowTool(registry: ToolRegistry, _ctx: ServerContext): void {
  registry.register(
    'ctx_get_workflow',
    {
      name: 'ctx_get_workflow',
      description:
        'Return a step-by-step workflow template for common AI-assisted development tasks. ' +
        'Workflows: review, debug, onboard, refactor, audit.',
      inputSchema: {
        type: 'object',
        properties: {
          workflow: {
            type: 'string',
            enum: ['review', 'debug', 'onboard', 'refactor', 'audit'],
            description: 'Which workflow to return',
          },
          project_root: PROJECT_ROOT_JSON_SCHEMA,
        },
        required: ['workflow'],
      },
    },
    async (args) => {
      const { workflow } = Schema.parse(args);
      return WORKFLOWS[workflow] ?? `<error>Unknown workflow: ${workflow}</error>`;
    },
  );
}
