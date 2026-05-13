import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { __resetForTests, track } from '../client/src/lib/telemetry';

// A minimal TelemetryGate that mirrors App.tsx but without heavy page imports.
function TelemetryGate() {
  const location = useLocation();
  useEffect(() => {
    void track('dashboard_loaded');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void track('dashboard_page_viewed', { path: location.pathname });
  }, [location.pathname]);
  return null;
}

function Navigator({ to }: { to: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to);
  }, [navigate, to]);
  return null;
}

function eventBody(call: unknown[]): { event?: string; props?: Record<string, unknown> } {
  return JSON.parse((call[1] as { body: string }).body);
}

describe('dashboard client telemetry', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetForTests();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = typeof url === 'string' ? url : (url as URL).toString();
      if (u.endsWith('/api/telemetry/identity')) {
        return new Response(JSON.stringify({ enabled: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(null, { status: 204 });
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('fires dashboard_loaded once and dashboard_page_viewed for the initial route on mount', async () => {
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/']}>
          <TelemetryGate />
        </MemoryRouter>,
      );
    });
    // Let the initPromise resolve and the fire-and-forget POSTs flush.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const eventCalls = fetchSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).endsWith('/api/telemetry/event'),
    );
    const events = eventCalls.map(eventBody);
    expect(events.filter((e) => e.event === 'dashboard_loaded')).toHaveLength(1);
    const pageViews = events.filter((e) => e.event === 'dashboard_page_viewed');
    expect(pageViews).toHaveLength(1);
    expect(pageViews[0].props?.path).toBe('/');
  });

  it('fires dashboard_page_viewed with the new path on route change', async () => {
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/']}>
          <TelemetryGate />
          <Navigator to="/graph" />
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const eventCalls = fetchSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).endsWith('/api/telemetry/event'),
    );
    const events = eventCalls.map(eventBody);
    const pageViews = events.filter((e) => e.event === 'dashboard_page_viewed');
    const paths = pageViews.map((e) => e.props?.path);
    expect(paths).toContain('/');
    expect(paths).toContain('/graph');
  });

  it('makes no /event calls when identity returns enabled: false', async () => {
    fetchSpy.mockRestore();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = typeof url === 'string' ? url : (url as URL).toString();
      if (u.endsWith('/api/telemetry/identity')) {
        return new Response(JSON.stringify({ enabled: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(null, { status: 204 });
    });
    __resetForTests();

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/']}>
          <TelemetryGate />
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const eventCalls = fetchSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).endsWith('/api/telemetry/event'),
    );
    expect(eventCalls).toHaveLength(0);
  });

  it('only fetches /identity once across many track() calls', async () => {
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/']}>
          <TelemetryGate />
          <Navigator to="/graph" />
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const identityCalls = fetchSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).endsWith('/api/telemetry/identity'),
    );
    expect(identityCalls).toHaveLength(1);
  });
});
