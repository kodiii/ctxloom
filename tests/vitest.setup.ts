/**
 * Global vitest setup. Currently:
 *
 *   - Resets the task-tool budget singleton (Phase 4a) before every
 *     test so tests that hammer the registry don't accidentally
 *     trigger budget-throttled args mid-run. Real-world usage has
 *     a 90s inactivity gap between tasks; test files run in
 *     milliseconds and would otherwise stack into a single
 *     "task" by the tracker's heuristic.
 *   - Resets the learned-suggestions cache (Phase 4b) so tests don't
 *     accidentally see each other's seeded telemetry. The learner is
 *     opt-in via CTXLOOM_LEARNED_SUGGESTIONS=1 — when unset, tests
 *     never consult it, but the reset is cheap defense-in-depth for
 *     when the flag IS set.
 */
import { beforeEach } from 'vitest';
import { __resetTaskBudgetTrackerForTests } from '../packages/core/src/budget/taskBudget.js';
import { __resetLearnedSuggestionsCacheForTests } from '../packages/core/src/budget/learnedSuggestions.js';

beforeEach(() => {
  __resetTaskBudgetTrackerForTests();
  __resetLearnedSuggestionsCacheForTests();
});
