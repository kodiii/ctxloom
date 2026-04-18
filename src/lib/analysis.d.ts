/**
 * src/lib/analysis.ts
 *
 * Pure analysis functions extracted from MCP tool implementations.
 * These functions operate on DependencyGraph and GitOverlayStore directly,
 * with no MCP formatting or I/O side effects.
 */
import type { DependencyGraph } from '../graph/DependencyGraph.js';
import type { GitOverlayStore } from '../git/GitOverlayStore.js';
export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';
export type ChurnBucket = 'low' | 'medium' | 'high';
export interface OverlayRisk {
    churn: ChurnBucket;
    bugDensity: number;
    coupledNodes: Array<{
        node: string;
        confidence: number;
    }>;
    owners: Array<{
        author: string;
        share: number;
    }>;
}
export interface ChangedFile {
    file: string;
    riskLevel: RiskLevel;
    importerCount: number;
    isHub: boolean;
    hasTestCoverage: boolean;
    risk: OverlayRisk | null;
}
export interface DetectChangesInput {
    graph: DependencyGraph;
    overlay?: GitOverlayStore;
    changedFiles: string[];
    depth?: number;
}
export interface DetectChangesResult {
    changedFiles: ChangedFile[];
    summary: {
        critical: number;
        high: number;
        medium: number;
        low: number;
    };
}
export declare function detectChanges(input: DetectChangesInput): DetectChangesResult;
export interface HistoricalCouplingEntry {
    node: string;
    confidence: number;
    evidence: string;
}
export interface ImpactReport {
    seedFiles: string[];
    directImporters: string[];
    transitiveImporters: string[];
    historicalCoupling: HistoricalCouplingEntry[];
    totalImpacted: number;
}
export interface ImpactInput {
    graph: DependencyGraph;
    overlay?: GitOverlayStore;
    changedFiles: string[];
    depth?: number;
}
export declare function getImpactRadius(input: ImpactInput): ImpactReport;
//# sourceMappingURL=analysis.d.ts.map