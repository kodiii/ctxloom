/**
 * ctx_git_coupling — Co-change coupling analysis for a given file.
 *
 * Returns files that historically change together with the queried file,
 * scored by recency-decayed Jaccard confidence.
 */
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';

const Schema = z.object({
  file: z.string().describe('File path to look up co-changed siblings for'),
  limit: z.number().int().min(1).max(50).default(10),
  min_confidence: z.number().min(0).max(1).default(0.05),
  half_life_days: z.number().int().min(1).max(3650).default(90),
});

interface CoupledFileEntry {
  file: string;
  confidence: number;
  sharedCommits: number;
  lastSharedDaysAgo: number;
  explanation: string;
}

interface CouplingResponse {
  file: string;
  coupledFiles: CoupledFileEntry[];
  note: string | null;
}

function overlayUnavailableResponse(file: string): CouplingResponse {
  return {
    file,
    coupledFiles: [],
    note: 'Git overlay not available. Re-index with --with-git to enable coupling data.',
  };
}

function buildExplanation(sharedCommits: number, lastSharedDaysAgo: number): string {
  return `Changed together in ${sharedCommits} commit${sharedCommits === 1 ? '' : 's'}; last co-change ${lastSharedDaysAgo} day${lastSharedDaysAgo === 1 ? '' : 's'} ago.`;
}

export function registerGitCouplingTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_git_coupling',
    {
      name: 'ctx_git_coupling',
      description:
        'Return files that historically co-change with the given file, ' +
        'scored by recency-decayed Jaccard confidence. ' +
        'Useful for finding hidden coupling that static imports miss.',
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'File path to look up co-changed siblings for' },
          limit: { type: 'number', description: 'Max results to return (default: 10, max: 50)' },
          min_confidence: { type: 'number', description: 'Minimum confidence threshold (default: 0.05)' },
          half_life_days: { type: 'number', description: 'Recency decay half-life in days (default: 90)' },
        },
        required: ['file'],
      },
    },
    async (args) => {
      const { file, limit, min_confidence, half_life_days } = Schema.parse(args);

      if (!ctx.overlay) {
        return JSON.stringify(overlayUnavailableResponse(file));
      }

      const coChange = ctx.overlay.coChange;
      if (coChange.size().pairs === 0) {
        return JSON.stringify(overlayUnavailableResponse(file));
      }

      const nowSec = Math.floor(Date.now() / 1000);

      const pairs = coChange.topFor({
        node: file,
        limit,
        minConfidence: min_confidence,
        now: nowSec,
        halfLifeDays: half_life_days,
      });

      const coupledFiles: CoupledFileEntry[] = pairs.map((p) => {
        const siblingFile = p.nodeA === file ? p.nodeB : p.nodeA;
        const lastSharedDaysAgo = Math.floor((nowSec - p.lastSharedTimestamp) / 86400);
        return {
          file: siblingFile,
          confidence: p.confidence,
          sharedCommits: p.sharedCommits,
          lastSharedDaysAgo,
          explanation: buildExplanation(p.sharedCommits, lastSharedDaysAgo),
        };
      });

      const response: CouplingResponse = { file, coupledFiles, note: null };
      return JSON.stringify(response);
    },
  );
}
