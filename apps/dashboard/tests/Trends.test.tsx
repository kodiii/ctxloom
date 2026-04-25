import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { Trends } from '../client/src/pages/Trends.js';
import type { TrendsResponse } from '../server/types.js';

function setApiResponse(body: TrendsResponse): void {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

function row(unixSeconds: number, overrides: Partial<TrendsResponse['snapshots'][number]> = {}) {
  return {
    timestamp: new Date(unixSeconds * 1000).toISOString(),
    unixSeconds,
    totalFiles: 100,
    totalEdges: 200,
    deadFiles: 10,
    avgBusFactor: 2.0,
    highRiskFiles: 5,
    churnLinesLast7d: 1000,
    source: 'cli' as const,
    gitSha: 'abc',
    ...overrides,
  };
}

describe('Trends page', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders 4 sparkline cards when data is present', async () => {
    setApiResponse({
      snapshots: [row(1000), row(2000), row(3000)],
      gitEnabled: true,
      totalCount: 3,
      range: '30d',
    });
    render(<MemoryRouter><Trends /></MemoryRouter>);
    expect(await screen.findByText('Dead files')).toBeInTheDocument();
    expect(await screen.findByText('Avg bus factor')).toBeInTheDocument();
    expect(await screen.findByText('High-risk files')).toBeInTheDocument();
    expect(await screen.findByText('Churn lines / week')).toBeInTheDocument();
  });

  it('shows empty-state copy when there are fewer than 2 snapshots', async () => {
    setApiResponse({
      snapshots: [row(1000)],
      gitEnabled: true,
      totalCount: 1,
      range: '30d',
    });
    render(<MemoryRouter><Trends /></MemoryRouter>);
    expect(await screen.findAllByText(/Collecting data/i)).not.toHaveLength(0);
  });

  it('shows "Git history disabled" placeholders for git-dependent cards', async () => {
    setApiResponse({
      snapshots: [
        row(1000, { avgBusFactor: null, highRiskFiles: null, churnLinesLast7d: null }),
        row(2000, { avgBusFactor: null, highRiskFiles: null, churnLinesLast7d: null }),
      ],
      gitEnabled: false,
      totalCount: 2,
      range: '30d',
    });
    render(<MemoryRouter><Trends /></MemoryRouter>);
    const placeholders = await screen.findAllByText(/Git history disabled/i);
    expect(placeholders).toHaveLength(3);
  });

  it('range picker fetches a different URL when clicked', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ snapshots: [], gitEnabled: false, totalCount: 0, range: '30d' }),
    } as unknown as Response);
    global.fetch = fetchMock;
    const user = userEvent.setup();
    render(<MemoryRouter><Trends /></MemoryRouter>);
    await screen.findByText('30d');
    await user.click(screen.getByText('7d'));
    const calls = fetchMock.mock.calls.map(c => String(c[0]));
    expect(calls.some(u => u.includes('range=7d'))).toBe(true);
  });
});
