import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { Overview } from '../client/src/pages/Overview.tsx';

vi.mock('../client/src/lib/api.ts', () => ({
  api: {
    overview: vi.fn().mockResolvedValue({
      totalFiles: 42,
      totalEdges: 130,
      totalCommunities: 7,
      risk: { critical: 2, high: 5, medium: 10, low: 25 },
      topHubs: [
        { file: 'src/index.ts', inDegree: 20, outDegree: 5, totalDegree: 25 },
      ],
      gitEnabled: true,
    }),
    status: vi.fn().mockResolvedValue({
      lastIndexed: new Date().toISOString(),
      fileCount: 42,
      gitEnabled: true,
    }),
    tokens: vi.fn().mockResolvedValue({
      fullTokens: 100000,
      skeletonTokens: 20000,
      savedTokens: 80000,
      reductionPercent: 80,
      fileCount: 42,
    }),
  },
}));

describe('Overview page', () => {
  it('renders stat cards with data from API', async () => {
    render(<MemoryRouter><Overview /></MemoryRouter>);
    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(await screen.findByText('130')).toBeInTheDocument();
    expect(await screen.findByText('7')).toBeInTheDocument();
  });

  it('shows git enabled status', async () => {
    render(<MemoryRouter><Overview /></MemoryRouter>);
    expect(await screen.findByText('enabled')).toBeInTheDocument();
  });

  it('renders top hub filename', async () => {
    render(<MemoryRouter><Overview /></MemoryRouter>);
    expect(await screen.findByText('index.ts')).toBeInTheDocument();
  });
});
