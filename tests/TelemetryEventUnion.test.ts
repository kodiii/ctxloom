import { describe, it, expectTypeOf } from 'vitest';
import type { TelemetryEvent } from '@ctxloom/core';

describe('TelemetryEvent union', () => {
  it('includes all v1.1.1 multi-project event names', () => {
    expectTypeOf<'project_resolved'>().toMatchTypeOf<TelemetryEvent>();
    expectTypeOf<'project_first_touch'>().toMatchTypeOf<TelemetryEvent>();
    expectTypeOf<'project_evicted'>().toMatchTypeOf<TelemetryEvent>();
    expectTypeOf<'alias_registered'>().toMatchTypeOf<TelemetryEvent>();
    expectTypeOf<'multi_project_active'>().toMatchTypeOf<TelemetryEvent>();
    expectTypeOf<'kill_switch_active'>().toMatchTypeOf<TelemetryEvent>();
    expectTypeOf<'project_resolution_failed'>().toMatchTypeOf<TelemetryEvent>();
    expectTypeOf<'tool_dispatched'>().toMatchTypeOf<TelemetryEvent>();
  });

  it('still includes the existing license funnel events', () => {
    expectTypeOf<'trial_started'>().toMatchTypeOf<TelemetryEvent>();
    expectTypeOf<'license_activated'>().toMatchTypeOf<TelemetryEvent>();
  });
});
