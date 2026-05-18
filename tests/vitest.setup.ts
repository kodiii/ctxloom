/**
 * Global vitest setup. Currently:
 *
 *   - Resets the task-tool budget singleton (Phase 4a) before every
 *     test so tests that hammer the registry don't accidentally
 *     trigger budget-throttled args mid-run. Real-world usage has
 *     a 90s inactivity gap between tasks; test files run in
 *     milliseconds and would otherwise stack into a single
 *     "task" by the tracker's heuristic.
 */
import { beforeEach } from 'vitest';
import { __resetTaskBudgetTrackerForTests } from '../packages/core/src/budget/taskBudget.js';

beforeEach(() => {
  __resetTaskBudgetTrackerForTests();
});
