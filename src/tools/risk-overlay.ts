/**
 * ctx_risk_overlay — Per-file risk scoring using git overlay data.
 *
 * Combines churn, bug density, bus factor, and coupling fan-out
 * into a single composite risk score for each requested file.
 */
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';

const Schema = z.object({
  nodes: z.array(z.string()).min(1).max(200).describe('File paths to score'),
});

interface NodeRiskEntry {
  file: string;
  riskScore: number;
  riskLabel: 'low' | 'medium' | 'high';
  churnLines: number;
  bugDensity: number;
  busFactor: number;
  topOwner: string | null;
  couplingFanOut: number;
  note?: string;
}

interface RiskResponse {
  nodes: NodeRiskEntry[];
  overallRiskScore: number;
  note: string | null;
}

function computeRiskScore(
  churnLines: number,
  bugDensity: number,
  busFactor: number,
  couplingFanOut: number,
): number {
  const churnPart = Math.min(1, churnLines / 1000);
  const bugPart = Math.min(1, bugDensity * 2);
  const ownerPart = busFactor === 0 ? 0.0 : busFactor === 1 ? 0.6 : busFactor === 2 ? 0.3 : 0.1;
  const couplingPart = Math.min(1, couplingFanOut / 5);
  return 0.35 * churnPart + 0.30 * bugPart + 0.20 * ownerPart + 0.15 * couplingPart;
}

function riskLabel(score: number): 'low' | 'medium' | 'high' {
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

export function registerRiskOverlayTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_risk_overlay',
    {
      name: 'ctx_risk_overlay',
      description:
        'Score each requested file by composite risk: churn lines, bug-fix density, ' +
        'bus factor, and co-change coupling fan-out. Returns per-node scores and an ' +
        'overall max risk score.',
      inputSchema: {
        type: 'object',
        properties: {
          nodes: {
            type: 'array',
            items: { type: 'string' },
            description: 'File paths to score (1–200)',
          },
        },
        required: ['nodes'],
      },
    },
    async (args) => {
      const { nodes } = Schema.parse(args);

      if (!ctx.overlay) {
        const response: RiskResponse = {
          nodes: nodes.map((file) => ({
            file,
            riskScore: 0,
            riskLabel: 'low',
            churnLines: 0,
            bugDensity: 0,
            busFactor: 0,
            topOwner: null,
            couplingFanOut: 0,
            note: 'no git data',
          })),
          overallRiskScore: 0,
          note: 'Git overlay not available. Re-index with --with-git to enable risk data.',
        };
        return JSON.stringify(response);
      }

      const { churn, ownership, coChange } = ctx.overlay;
      const nowSec = Math.floor(Date.now() / 1000);

      const nodeEntries: NodeRiskEntry[] = nodes.map((file) => {
        const churnStats = churn.statsFor(file);
        const ownerStats = ownership.statsFor(file, nowSec);

        if (churnStats === null || ownerStats === null) {
          return {
            file,
            riskScore: 0,
            riskLabel: 'low' as const,
            churnLines: 0,
            bugDensity: 0,
            busFactor: 0,
            topOwner: null,
            couplingFanOut: 0,
            note: 'no git data',
          };
        }

        const strongPartners = coChange.topFor({
          node: file,
          limit: 50,
          minConfidence: 0.2,
          now: nowSec,
        });
        const couplingFanOut = strongPartners.length;

        const score = computeRiskScore(
          churnStats.churnLines,
          churnStats.bugDensity,
          ownerStats.busFactor,
          couplingFanOut,
        );

        const topOwner = ownerStats.owners[0]?.author ?? null;

        return {
          file,
          riskScore: score,
          riskLabel: riskLabel(score),
          churnLines: churnStats.churnLines,
          bugDensity: churnStats.bugDensity,
          busFactor: ownerStats.busFactor,
          topOwner,
          couplingFanOut,
        };
      });

      const overallRiskScore = nodeEntries.reduce(
        (max, n) => Math.max(max, n.riskScore),
        0,
      );

      const response: RiskResponse = { nodes: nodeEntries, overallRiskScore, note: null };
      return JSON.stringify(response);
    },
  );
}
