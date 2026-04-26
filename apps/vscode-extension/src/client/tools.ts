import type { ServerManager } from './ServerManager.js';

export interface RiskInfo { file: string; score: number; label: string; topOwner: string | null }
export interface BlastResult { direct: string[]; transitive: string[]; historical: string[] }
export interface RuleViolation { file: string; line: number; col: number; endLine: number; endCol: number; rule: string; message: string; severity: 'error' | 'warning' | 'info' }
export interface KnowledgeGapsResult { isolated: string[]; deadCode: string[]; untestedHubs: { file: string; importers: number }[] }
export interface ContextPacket { text: string; fullTokens: number; skeletonTokens: number; reductionPercent: number }
export interface CommunityCounts { count: number }
export interface HubFile { file: string; importers: number }

function firstText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const item = content.find((c: unknown) => typeof c === 'object' && c !== null && (c as { type?: string }).type === 'text');
  return typeof item === 'object' && item !== null && 'text' in item ? String((item as { text: unknown }).text) : '';
}

function tryJson<T>(s: string): T | null { try { return JSON.parse(s) as T; } catch { return null; } }

export class Tools {
  constructor(private readonly sm: { callTool: (name: string, args: Record<string, unknown>) => Promise<{ content: unknown }> }) {}

  async riskOverlay(file: string): Promise<RiskInfo | null> {
    const res = await this.sm.callTool('ctx_risk_overlay', { files: [file] });
    const text = firstText(res.content);
    const m = text.match(/<file\s+path="([^"]+)"\s+score="([^"]+)"\s+label="([^"]+)"(?:\s+top_owner="([^"]*)")?\s*\/>/);
    if (m === null) return null;
    return { file: m[1], score: Number(m[2]), label: m[3], topOwner: m[4] ?? null };
  }

  async blastRadius(file: string): Promise<BlastResult> {
    const res = await this.sm.callTool('ctx_blast_radius', { files: [file] });
    const data = tryJson<BlastResult>(firstText(res.content));
    return data ?? { direct: [], transitive: [], historical: [] };
  }

  async rulesCheck(file?: string): Promise<RuleViolation[]> {
    const args: Record<string, unknown> = file !== undefined ? { file } : {};
    const res = await this.sm.callTool('ctx_rules_check', args);
    const data = tryJson<RuleViolation[]>(firstText(res.content));
    return data ?? [];
  }

  async knowledgeGaps(): Promise<KnowledgeGapsResult> {
    const res = await this.sm.callTool('ctx_knowledge_gaps', { detail_level: 'standard' });
    const text = firstText(res.content);
    const isolated = [...text.matchAll(/<isolated_files[^>]*>([\s\S]*?)<\/isolated_files>/g)].flatMap(m => [...m[1].matchAll(/<f>([^<]+)<\/f>/g)].map(x => x[1]));
    const deadCode = [...text.matchAll(/<dead_code_candidates[^>]*>([\s\S]*?)<\/dead_code_candidates>/g)].flatMap(m => [...m[1].matchAll(/<f>([^<]+)<\/f>/g)].map(x => x[1]));
    const untestedHubs = [...text.matchAll(/<untested_hubs[^>]*>([\s\S]*?)<\/untested_hubs>/g)].flatMap(m => [...m[1].matchAll(/<f\s+importers="([^"]+)">([^<]+)<\/f>/g)].map(x => ({ file: x[2], importers: Number(x[1]) })));
    return { isolated, deadCode, untestedHubs };
  }

  async hubNodes(limit = 10): Promise<HubFile[]> {
    const res = await this.sm.callTool('ctx_hub_nodes', { limit });
    const data = tryJson<HubFile[]>(firstText(res.content));
    return data ?? [];
  }

  async communityList(): Promise<CommunityCounts> {
    const res = await this.sm.callTool('ctx_community_list', {});
    const data = tryJson<{ communities: unknown[] }>(firstText(res.content));
    return { count: data?.communities?.length ?? 0 };
  }

  async contextPacket(file: string, symbol: string): Promise<ContextPacket> {
    const res = await this.sm.callTool('ctx_get_context_packet', { file, symbol });
    const data = tryJson<ContextPacket>(firstText(res.content));
    return data ?? { text: '', fullTokens: 0, skeletonTokens: 0, reductionPercent: 0 };
  }

  async gitCoupling(file: string): Promise<{ churnLines: number; bucket: 'low' | 'medium' | 'high'; importers: number }> {
    const res = await this.sm.callTool('ctx_git_coupling', { file });
    const data = tryJson<{ churnLines: number; bucket: 'low' | 'medium' | 'high'; importers: number }>(firstText(res.content));
    return data ?? { churnLines: 0, bucket: 'low', importers: 0 };
  }

  async applyRefactor(args: Record<string, unknown>): Promise<{ ok: boolean; message?: string; edits?: unknown }> {
    const res = await this.sm.callTool('ctx_apply_refactor', args);
    const data = tryJson<{ ok: boolean; message?: string; edits?: unknown }>(firstText(res.content));
    return data ?? { ok: false, message: 'malformed response' };
  }
}

// Re-export ServerManager type alias so callers can use Tools without importing ServerManager directly
export type { ServerManager };
