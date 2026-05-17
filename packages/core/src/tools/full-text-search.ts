/**
 * ctx_full_text_search — Regex/keyword scan over all indexed files.
 *
 * Modes:
 *   keyword  — regex scan only
 *   semantic — vector search only (requires store to be indexed)
 *   hybrid   — keyword scan + vector search merged
 */
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { ProjectRootField, PROJECT_ROOT_JSON_SCHEMA } from './projectRootParam.js';
import {
  enforceBudget,
  hasBudgetArgs,
  readBudgetArgs,
  wrapResponse,
} from '../budget/budget.js';

/** Per #106 provisional table. */
const DEFAULT_MAX_RESPONSE_TOKENS = 4000;

const Schema = z.object({
  query: z.string().min(1).describe('Search term — literal or /regex/'),
  mode: z.enum(['hybrid', 'keyword', 'semantic']).optional().default('hybrid'),
  case_sensitive: z.boolean().optional().default(false),
  limit: z.number().min(1).max(100).optional().default(20),
  context_lines: z.number().min(0).max(5).optional().default(1),
  project_root: ProjectRootField,
  // ─── Phase B2 budget surface ──
  max_response_tokens: z.number().int().positive().optional()
    .describe('Soft response budget. Default: 4000 (when budget surface is opted into). Over-budget rebuilds the result list without match snippets (paths + match counts only).'),
  on_budget_exceeded: z.enum(['skeleton', 'truncate', 'error']).optional()
    .describe("Behavior when over budget. 'skeleton' (default) drops snippets; 'truncate' slices the raw XML; 'error' throws."),
  response_format: z.enum(['full', 'skeleton', 'auto']).optional()
    .describe("'skeleton' forces the path-and-count-only view; 'full'/'auto' lets the budget decide."),
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildPattern(query: string, caseSensitive: boolean): RegExp | null {
  const flags = caseSensitive ? 'g' : 'gi';
  if (query.startsWith('/') && query.endsWith('/') && query.length > 2) {
    try {
      return new RegExp(query.slice(1, -1), flags);
    } catch {
      return null;
    }
  }
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
}

function scanFile(
  absPath: string,
  pattern: RegExp,
  contextLines: number,
): { matchCount: number; snippets: string[] } | null {
  let content: string;
  try {
    content = fs.readFileSync(absPath, 'utf-8');
  } catch {
    return null;
  }

  const fileLines = content.split('\n');
  const snippets: string[] = [];
  let matchCount = 0;

  for (let i = 0; i < fileLines.length; i++) {
    pattern.lastIndex = 0;
    if (pattern.test(fileLines[i])) {
      matchCount++;
      if (snippets.length < 3) {
        const start = Math.max(0, i - contextLines);
        const end = Math.min(fileLines.length - 1, i + contextLines);
        snippets.push(
          fileLines
            .slice(start, end + 1)
            .map((l, idx) => `${start + idx + 1}: ${l}`)
            .join('\n'),
        );
      }
    }
  }

  return matchCount > 0 ? { matchCount, snippets } : null;
}

export function registerFullTextSearchTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_full_text_search',
    {
      name: 'ctx_full_text_search',
      description:
        'Keyword/regex search over the full codebase with optional hybrid vector merge. ' +
        'Finds exact identifier matches that semantic search misses. ' +
        'Modes: keyword (fast regex), semantic (vector), hybrid (both merged).',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term or /regex/' },
          mode: { type: 'string', enum: ['hybrid', 'keyword', 'semantic'], description: 'Search mode (default: hybrid)' },
          case_sensitive: { type: 'boolean', description: 'Case-sensitive match (default: false)' },
          limit: { type: 'number', description: 'Max results (default: 20)' },
          context_lines: { type: 'number', description: 'Context lines around each match (default: 1)' },
          project_root: PROJECT_ROOT_JSON_SCHEMA,
          max_response_tokens: {
            type: 'number',
            description: 'Soft response budget in tokens. Default: 4000 (when opted into).',
          },
          on_budget_exceeded: {
            type: 'string',
            enum: ['skeleton', 'truncate', 'error'],
            description: "Behavior when over budget. 'skeleton' (default) drops match snippets; 'truncate' slices; 'error' throws.",
          },
          response_format: {
            type: 'string',
            enum: ['full', 'skeleton', 'auto'],
            description: "'skeleton' forces path+count-only view; 'full'/'auto' lets the budget decide.",
          },
        },
        required: ['query'],
      },
    },
    async (args) => {
      const parsed = Schema.parse(args);
      const { query, mode, case_sensitive, limit, context_lines, project_root } = parsed;

      // Helper: budget-aware return. Tools with multiple early-return
      // shapes all funnel through here so the back-compat invariant
      // (no envelope when no budget args) holds uniformly across paths.
      const maybeBudget = async (
        full: string,
        skeletonProducer?: () => Promise<string | null>,
      ): Promise<string> => {
        if (!hasBudgetArgs(args)) return full;
        const result = await enforceBudget({
          full,
          args: readBudgetArgs(args),
          toolName: 'ctx_full_text_search',
          defaultMaxTokens: DEFAULT_MAX_RESPONSE_TOKENS,
          skeletonProducer,
        });
        return wrapResponse(result);
      };

      if (mode === 'semantic') {
        try {
          const { generateEmbedding } = await import('../indexer/embedder.js');
          const store = await ctx.getStore(project_root);
          const embedding = await generateEmbedding(query);
          const results = await store.search(embedding, limit);
          const xml = [`<full_text_search query="${escapeXML(query)}" mode="semantic" count="${results.length}">`];
          for (const r of results) {
            xml.push(`  <result file="${escapeXML(r.filePath)}" matches="0"/>`);
          }
          xml.push('</full_text_search>');
          // Semantic mode already returns path-only results — no
          // skeleton form lighter than what's already rendered.
          return maybeBudget(xml.join('\n'));
        } catch {
          return maybeBudget(`<full_text_search query="${escapeXML(query)}" mode="semantic" count="0"/>`);
        }
      }

      const pattern = buildPattern(query, case_sensitive);
      if (!pattern) {
        // Errors are short — no point running them through the budget.
        return `<error>Invalid regex: ${escapeXML(query)}</error>`;
      }

      const graph = await ctx.getGraph(project_root);
      const files = graph.allFiles();

      const keywordResults: Array<{ filePath: string; score: number; matchCount: number; snippets: string[] }> = [];

      for (const relPath of files) {
        const absPath = path.join(ctx.projectRoot, relPath);
        const hit = scanFile(absPath, pattern, context_lines);
        if (hit) {
          keywordResults.push({
            filePath: relPath,
            score: 1 / hit.matchCount,
            matchCount: hit.matchCount,
            snippets: hit.snippets,
          });
        }
      }

      keywordResults.sort((a, b) => a.score - b.score);
      let merged = keywordResults.slice(0, limit);

      if (mode === 'hybrid') {
        try {
          const { generateEmbedding } = await import('../indexer/embedder.js');
          const store = await ctx.getStore(project_root);
          const embedding = await generateEmbedding(query);
          const vectorResults = await store.search(embedding, Math.ceil(limit / 2));
          const seen = new Set(merged.map(r => r.filePath));
          for (const vr of vectorResults) {
            if (!seen.has(vr.filePath)) {
              merged.push({ filePath: vr.filePath, score: vr.score + 2, matchCount: 0, snippets: [] });
              seen.add(vr.filePath);
            }
          }
          merged.sort((a, b) => a.score - b.score);
          merged = merged.slice(0, limit);
        } catch {
          // vector store unavailable — keyword results only
        }
      }

      // Renderer is extracted so the skeleton fallback can re-render
      // without the per-match snippets (paths + match counts only).
      const render = (includeSnippets: boolean): string => {
        const xml = [
          `<full_text_search query="${escapeXML(query)}" mode="${mode}" case_sensitive="${case_sensitive}" count="${merged.length}">`,
        ];
        for (const r of merged) {
          if (includeSnippets && r.snippets.length > 0) {
            xml.push(`  <result file="${escapeXML(r.filePath)}" matches="${r.matchCount}">`);
            for (const snippet of r.snippets) {
              xml.push(`    <match><![CDATA[${snippet}]]></match>`);
            }
            xml.push('  </result>');
          } else {
            xml.push(`  <result file="${escapeXML(r.filePath)}" matches="${r.matchCount}"/>`);
          }
        }
        xml.push('</full_text_search>');
        return xml.join('\n');
      };

      return maybeBudget(
        render(true),
        async () => render(false),
      );
    },
  );
}
