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

export interface DashboardProject {
  slug: string;
  name: string;
  root: string;
  isDefault: boolean;
  hasSnapshot: boolean;
  isActive: boolean;
}

export interface ProjectsListResponse {
  projects: DashboardProject[];
}

export interface ActiveProjectResponse {
  active: DashboardProject;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) detail = j.error;
    } catch { /* fall through */ }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
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
  listProjects: () => get<ProjectsListResponse>('/projects'),
  activeProject: () => get<ActiveProjectResponse>('/projects/active'),
  switchProject: (slug: string) => postJson<ActiveProjectResponse>('/projects/active', { slug }),
};
