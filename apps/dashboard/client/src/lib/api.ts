import type {
  OverviewResponse,
  GraphResponse,
  RiskResponse,
  CommunitiesResponse,
  ChurnResponse,
  OwnershipResponse,
  TokenStatsResponse,
  TrendsResponse,
  TrendRange,
} from '../../../server/types.js';

const BASE = '/api';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export interface StatusResponse {
  lastIndexed: string;
  fileCount: number;
  gitEnabled: boolean;
}

export interface RefreshResponse {
  ok: boolean;
  lastIndexed: string;
  fileCount: number;
}

export const api = {
  overview: () => get<OverviewResponse>('/overview'),
  graph: () => get<GraphResponse>('/graph'),
  risk: () => get<RiskResponse>('/risk'),
  communities: () => get<CommunitiesResponse>('/communities'),
  churn: () => get<ChurnResponse>('/churn'),
  ownership: () => get<OwnershipResponse>('/ownership'),
  status: () => get<StatusResponse>('/status'),
  tokens: () => get<TokenStatsResponse>('/tokens'),
  trends: (range: TrendRange = '30d') => get<TrendsResponse>(`/trends?range=${range}`),
  refresh: () => fetch(`${BASE}/refresh`, { method: 'POST' }).then(r => r.json()) as Promise<RefreshResponse>,
};
