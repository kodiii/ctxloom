export interface OverviewResponse {
  totalFiles: number;
  totalEdges: number;
  totalCommunities: number;
  risk: { critical: number; high: number; medium: number; low: number };
  topHubs: Array<{ file: string; inDegree: number; outDegree: number; totalDegree: number }>;
  gitEnabled: boolean;
}

export interface GraphNode {
  id: string;
  label: string;
  community: number;
  inDegree: number;
  outDegree: number;
  riskScore: number | null;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface RiskEntry {
  file: string;
  riskScore: number;
  riskLabel: 'low' | 'medium' | 'high' | 'critical';
  churnLines: number;
  bugDensity: number;
  busFactor: number;
  topOwner: string | null;
  couplingFanOut: number;
}

export interface RiskResponse {
  entries: RiskEntry[];
  overallRiskScore: number;
}

export interface Community {
  id: number;
  name: string;
  size: number;
  files: string[];
}

export interface CommunitiesResponse {
  communities: Community[];
  totalFiles: number;
  totalEdges: number;
}

export interface ChurnEntry {
  file: string;
  churnLines: number;
  bucket: 'low' | 'medium' | 'high';
  commits: number;
  bugDensity: number;
}

export interface ChurnResponse {
  entries: ChurnEntry[];
}

export interface OwnerEntry {
  file: string;
  primaryOwner: string;
  primaryShare: number;
  busFactor: number;
  coOwners: Array<{ author: string; share: number }>;
}

export interface OwnershipResponse {
  entries: OwnerEntry[];
  totalAuthors: number;
}

export interface TokenStatsResponse {
  fullTokens: number;
  skeletonTokens: number;
  savedTokens: number;
  reductionPercent: number;
  fileCount: number;
}
