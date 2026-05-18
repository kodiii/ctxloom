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
  alias?: string;
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

// ─── Budget events (mirrors `ctxloom budget-stats` CLI output) ──────

export interface BudgetFallbackRow {
  tool: string;
  breaches: number;
  skeletonPct: number;
  truncatePct: number;
  errorPct: number;
}
export interface BudgetDistributionRow {
  tool: string;
  n: number;
  min: number | null;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  max: number | null;
}
export interface BudgetEventsResponse {
  window: { since: string; until: string; days: number };
  totalEvents: number;
  fallbackTable: BudgetFallbackRow[];
  distributionTable: BudgetDistributionRow[];
  breachesPerDay: Array<{ day: string; count: number }>;
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
  budgetEvents: (window: string = '14d', tool?: string) => {
    const params = new URLSearchParams({ window });
    if (tool) params.set('tool', tool);
    return get<BudgetEventsResponse>(`/budget-events?${params.toString()}`);
  },
};
