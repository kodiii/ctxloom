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

const Schema = z.object({
  query: z.string().min(1).describe('Search term — literal or /regex/'),
  mode: z.enum(['hybrid', 'keyword', 'semantic']).optional().default('hybrid'),
  case_sensitive: z.boolean().optional().default(false),
  limit: z.number().min(1).max(100).optional().default(20),
  context_lines: z.number().min(0).max(5).optional().default(1),
  project_root: ProjectRootField,
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
        },
        required: ['query'],
      },
    },
    async (args) => {
      const { query, mode, case_sensitive, limit, context_lines, project_root } = Schema.parse(args);

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
          return xml.join('\n');
        } catch {
          return `<full_text_search query="${escapeXML(query)}" mode="semantic" count="0"/>`;
        }
      }

      const pattern = buildPattern(query, case_sensitive);
      if (!pattern) {
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

      const xml = [
        `<full_text_search query="${escapeXML(query)}" mode="${mode}" case_sensitive="${case_sensitive}" count="${merged.length}">`,
      ];
      for (const r of merged) {
        xml.push(`  <result file="${escapeXML(r.filePath)}" matches="${r.matchCount}">`);
        for (const snippet of r.snippets) {
          xml.push(`    <match><![CDATA[${snippet}]]></match>`);
        }
        xml.push('  </result>');
      }
      xml.push('</full_text_search>');
      return xml.join('\n');
    },
  );
}
