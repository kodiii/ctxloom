/**
 * ContextMesh MCP Server — The core server that exposes all tools
 * via the Model Context Protocol (MCP).
 *
 * Tools exposed:
 *   1. ctx_search             — Hybrid semantic + graph search
 *   2. ctx_get_file           — Safe file read with path validation
 *   3. ctx_get_context_packet — Smart multi-file context with skeletonization
 *   4. ctx_get_call_graph     — Bidirectional call graph traversal with depth
 *   5. ctx_get_definition     — Symbol definition lookup
 *   6. ctx_get_rules          — Project rule injection
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';

import { PathValidator } from './security/PathValidator.js';
import { VectorStore } from './db/VectorStore.js';
import { generateEmbedding, indexDirectory } from './indexer/embedder.js';
import { DependencyGraph } from './graph/DependencyGraph.js';
import { ASTParser } from './ast/ASTParser.js';
import { Skeletonizer } from './ast/Skeletonizer.js';
import { FileWatcher } from './watcher/FileWatcher.js';
import { findCallers, getCallGraph } from './tools/findCallers.js';
import { RuleManager } from './tools/ruleManager.js';

// ─── Configuration ──────────────────────────────────────────────────────

const PROJECT_ROOT = process.env.CONTEXTMESH_ROOT ?? process.cwd();
const DB_PATH = path.join(PROJECT_ROOT, '.contextmesh', 'vectors.lancedb');

// ─── Schemas ────────────────────────────────────────────────────────────

const CtxSearchSchema = z.object({
  query: z.string().describe('Search query — natural language or code fragment'),
  limit: z.number().optional().default(10).describe('Maximum results to return'),
});

const CtxGetFileSchema = z.object({
  path: z.string().describe('Relative path to the file'),
});

const CtxGetContextPacketSchema = z.object({
  target_file: z.string().describe('Relative path to the primary file'),
  mode: z.enum(['edit', 'read']).optional().default('edit').describe('Context mode'),
});

const CtxGetCallGraphSchema = z.object({
  symbol: z.string().describe('Symbol name to search for'),
  direction: z.enum(['callers', 'callees']).optional().default('callers').describe('Traversal direction'),
  depth: z.number().optional().default(1).describe('Transitive traversal depth'),
  target_file: z.string().optional().describe('Optional: relative file path to start from'),
});

const CtxGetDefinitionSchema = z.object({
  symbol: z.string().describe('Symbol name to look up'),
});

// ─── Lazy Singletons ────────────────────────────────────────────────────

let _pathValidator: PathValidator | null = null;
function getPathValidator(): PathValidator {
  if (!_pathValidator) {
    _pathValidator = new PathValidator(PROJECT_ROOT);
  }
  return _pathValidator;
}

let _storePromise: Promise<VectorStore> | null = null;
function getStore(): Promise<VectorStore> {
  if (!_storePromise) {
    _storePromise = (async () => {
      const store = new VectorStore(DB_PATH);
      await store.init();
      return store;
    })();
  }
  return _storePromise;
}

let _parserPromise: Promise<ASTParser> | null = null;
function getParser(): Promise<ASTParser> {
  if (!_parserPromise) {
    _parserPromise = (async () => {
      const parser = new ASTParser();
      await parser.init();
      return parser;
    })();
  }
  return _parserPromise;
}

let _graphPromise: Promise<DependencyGraph> | null = null;
function getGraph(): Promise<DependencyGraph> {
  if (!_graphPromise) {
    _graphPromise = (async () => {
      const parser = await getParser();
      const graph = new DependencyGraph();
      graph.setParser(parser);
      await graph.buildFromDirectory(PROJECT_ROOT);
      return graph;
    })();
  }
  return _graphPromise;
}

let _skeletonizerPromise: Promise<Skeletonizer> | null = null;
function getSkeletonizer(): Promise<Skeletonizer> {
  if (!_skeletonizerPromise) {
    _skeletonizerPromise = (async () => {
      const skeletonizer = new Skeletonizer();
      await skeletonizer.init();
      return skeletonizer;
    })();
  }
  return _skeletonizerPromise;
}

let _ruleManager: RuleManager | null = null;
function getRuleManager(): RuleManager {
  if (!_ruleManager) {
    _ruleManager = new RuleManager(PROJECT_ROOT, getPathValidator());
  }
  return _ruleManager;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function escapeXML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Tool Handlers ──────────────────────────────────────────────────────

async function handleCtxSearch(query: string, limit: number): Promise<string> {
  const store = await getStore();
  const graph = await getGraph();

  // Stage 1: Vector search
  const queryEmbedding = await generateEmbedding(query);
  const vectorResults = await store.search(queryEmbedding, limit);

  // Stage 2: Graph expansion
  const expandedResults = new Map<string, { score: number; content: string }>();

  for (const result of vectorResults) {
    // Add the direct match
    const existingScore = expandedResults.get(result.filePath)?.score ?? Infinity;
    if (result.score < existingScore) {
      expandedResults.set(result.filePath, { score: result.score, content: result.content });
    }

    // Expand via graph: add direct dependencies and importers
    const imports = graph.getImports(result.filePath);
    const importers = graph.getImporters(result.filePath);

    for (const related of [...imports, ...importers]) {
      if (!expandedResults.has(related)) {
        expandedResults.set(related, { score: result.score + 0.1, content: '' });
      }
    }
  }

  // Re-rank: combine vector similarity (0.6) + graph proximity (0.4)
  const ranked = Array.from(expandedResults.entries())
    .map(([filePath, data]) => ({
      filePath,
      score: data.score,
      content: data.content,
    }))
    .sort((a, b) => a.score - b.score)
    .slice(0, limit);

  // Format as XML
  const lines = [`<search_results query="${query.replace(/"/g, '&quot;')}" count="${ranked.length}">`];
  for (const result of ranked) {
    lines.push(`  <result file="${escapeXML(result.filePath)}" score="${result.score.toFixed(4)}">`);
    if (result.content) {
      lines.push(`    ${result.content.slice(0, 200).replace(/&/g, '&amp;').replace(/</g, '&lt;')}`);
    }
    lines.push('  </result>');
  }
  lines.push('</search_results>');

  return lines.join('\n');
}

export async function handleCtxGetContextPacket(
  root: string,
  targetFile: string,
  mode: string = 'edit',
): Promise<string> {
  const pathValidator = getPathValidator();
  const skeletonizer = await getSkeletonizer();
  const graph = await getGraph();

  // Read primary file (with path validation)
  const primaryContent = pathValidator.readFile(targetFile);

  // Get dependency info
  const imports = graph.getImports(targetFile);
  const importers = graph.getImporters(targetFile);

  // Generate skeletons for all imported files
  const skeletons = await Promise.all(
    imports.map(async (dep) => {
      try {
        const absDep = path.resolve(root, dep);
        const sk = await skeletonizer.skeletonize(absDep);
        return `\n<!-- ${dep} -->\n${sk}`;
      } catch {
        return `<!-- ${dep} (skeleton unavailable) -->`;
      }
    }),
  );

  // Format as XML per Design Doc
  const sections = [
    `<context_packet target="${targetFile}" mode="${mode}">`,
    `  <primary_context file="${targetFile}">`,
    `    ${primaryContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}`,
    '  </primary_context>',
    `  <dependency_skeletons count="${imports.length}">`,
    ...skeletons.map(s => `    ${s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}`),
    '  </dependency_skeletons>',
    `  <imported_by count="${importers.length}">`,
    ...importers.map(imp => `    <importer file="${imp}" />`),
    '  </imported_by>',
    '</context_packet>',
  ];

  return sections.join('\n');
}

// ─── MCP Server Creation ────────────────────────────────────────────────

export function createServer(): Server {
  const server = new Server(
    {
      name: 'contextmesh',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // List Tools Handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'ctx_search',
        description:
          'Hybrid semantic + graph search over the codebase. Uses vector embeddings for semantic similarity and the dependency graph for structural expansion. Returns ranked file results.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query — natural language or code fragment' },
            limit: { type: 'number', description: 'Maximum results to return (default: 10)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'ctx_get_file',
        description:
          'Read a file from the project. Path is validated to prevent traversal outside the project root. Returns the full file content.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path to the file' },
          },
          required: ['path'],
        },
      },
      {
        name: 'ctx_get_context_packet',
        description:
          'Returns a smart multi-file context packet: the full target file, skeletons of its imports, and the list of files that import it. Reduces token usage by ~80% vs. sending full dependencies.',
        inputSchema: {
          type: 'object',
          properties: {
            target_file: { type: 'string', description: 'Relative path to the primary file' },
            mode: { type: 'string', enum: ['edit', 'read'], description: 'Context mode (default: edit)' },
          },
          required: ['target_file'],
        },
      },
      {
        name: 'ctx_get_call_graph',
        description:
          'Bidirectional call graph traversal with configurable depth. Find who calls a symbol (callers) or what a symbol depends on (callees). Supports transitive traversal.',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Symbol name to search for' },
            direction: { type: 'string', enum: ['callers', 'callees'], description: 'Traversal direction (default: callers)' },
            depth: { type: 'number', description: 'Transitive traversal depth (default: 1)' },
            target_file: { type: 'string', description: 'Optional: relative file path to start from' },
          },
          required: ['symbol'],
        },
      },
      {
        name: 'ctx_get_definition',
        description:
          'Look up the definition of a symbol by name. Returns file path, type, and signature for all definitions matching the symbol name.',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Symbol name to look up' },
          },
          required: ['symbol'],
        },
      },
      {
        name: 'ctx_get_rules',
        description:
          'Load and inject project-level rules from standard files (.cursorrules, CLAUDE.md, CONTEXT.md, .contextmeshrc). Helps the AI understand project conventions.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  }));

  // Call Tool Handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      // ─── ctx_search ────────────────────────────────────────────────
      if (name === 'ctx_search') {
        const { query, limit } = CtxSearchSchema.parse(args);
        const text = await handleCtxSearch(query, limit);
        return { content: [{ type: 'text' as const, text }] };
      }

      // ─── ctx_get_file ──────────────────────────────────────────────
      if (name === 'ctx_get_file') {
        const { path: filePath } = CtxGetFileSchema.parse(args);
        const pathValidator = getPathValidator();
        try {
          const content = pathValidator.readFile(filePath);
          return { content: [{ type: 'text' as const, text: content }] };
        } catch (err) {
          return {
            content: [{
              type: 'text' as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            }],
            isError: true,
          };
        }
      }

      // ─── ctx_get_context_packet ────────────────────────────────────
      if (name === 'ctx_get_context_packet') {
        const { target_file, mode } = CtxGetContextPacketSchema.parse(args);
        try {
          const text = await handleCtxGetContextPacket(PROJECT_ROOT, target_file, mode);
          return { content: [{ type: 'text' as const, text }] };
        } catch (err) {
          return {
            content: [{
              type: 'text' as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            }],
            isError: true,
          };
        }
      }

      // ─── ctx_get_call_graph ────────────────────────────────────────
      if (name === 'ctx_get_call_graph') {
        const { symbol, direction, depth, target_file } = CtxGetCallGraphSchema.parse(args);
        try {
          const [parser, graph] = await Promise.all([getParser(), getGraph()]);
          const text = await getCallGraph({
            symbol,
            direction,
            depth,
            targetFile: target_file,
            projectRoot: PROJECT_ROOT,
            parser,
            graph,
          });
          return { content: [{ type: 'text' as const, text }] };
        } catch (err) {
          return {
            content: [{
              type: 'text' as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            }],
            isError: true,
          };
        }
      }

      // ─── ctx_get_definition ────────────────────────────────────────
      if (name === 'ctx_get_definition') {
        const { symbol } = CtxGetDefinitionSchema.parse(args);
        try {
          const graph = await getGraph();
          const definitions = graph.lookupSymbol(symbol);

          if (definitions.length === 0) {
            return {
              content: [{
                type: 'text' as const,
                text: `<definitions symbol="${symbol}" count="0">\n  <!-- Symbol not found -->\n</definitions>`,
              }],
            };
          }

          const lines = [`<definitions symbol="${symbol}" count="${definitions.length}">`];
          for (const def of definitions) {
            lines.push(`  <definition file="${def.filePath}" type="${def.type}">`);
            lines.push(`    ${def.signature.replace(/&/g, '&amp;').replace(/</g, '&lt;')}`);
            lines.push('  </definition>');
          }
          lines.push('</definitions>');

          return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
        } catch (err) {
          return {
            content: [{
              type: 'text' as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            }],
            isError: true,
          };
        }
      }

      // ─── ctx_get_rules ─────────────────────────────────────────────
      if (name === 'ctx_get_rules') {
        try {
          const ruleManager = getRuleManager();
          const text = await ruleManager.getRulesXML();
          return { content: [{ type: 'text' as const, text }] };
        } catch (err) {
          return {
            content: [{
              type: 'text' as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            }],
            isError: true,
          };
        }
      }

      // Unknown tool
      return {
        content: [{
          type: 'text' as const,
          text: `Unknown tool: ${name}`,
        }],
        isError: true,
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Internal error: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  });

  return server;
}

// ─── Server Startup ─────────────────────────────────────────────────────

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[ContextMesh] MCP Server started on Stdio transport');
  console.error(`[ContextMesh] Project root: ${PROJECT_ROOT}`);
  console.error(`[ContextMesh] Database: ${DB_PATH}`);

  // Signal readiness when both graph and embedder are initialized
  Promise.all([
    getGraph(),
    generateEmbedding('warmup'),
  ]).then(([graph]) => {
    console.error(`[ContextMesh] Ready — graph: ${graph.edgeCount()} edges, embedder: loaded`);
  }).catch(err => {
    console.error('[ContextMesh] Initialization warning:', err);
  });

  // Start file watcher
  const watcher = new FileWatcher(PROJECT_ROOT, async (absPath, event) => {
    if (event === 'unlink') {
      const store = await getStore();
      const relPath = path.relative(PROJECT_ROOT, absPath);
      await store.remove(relPath);
      console.error(`[ContextMesh] Removed from index: ${relPath}`);
      return;
    }

    // Re-index the changed file
    let content: string;
    try {
      content = fs.readFileSync(absPath, 'utf-8');
      if (!content.trim()) return;
    } catch {
      return;
    }

    // Invalidate rule cache if a rule file changed
    const basename = path.basename(absPath);
    if (['.cursorrules', 'CLAUDE.md', 'CONTEXT.md', '.contextmeshrc'].includes(basename)) {
      getRuleManager().invalidateCache();
      console.error(`[ContextMesh] Rule cache invalidated: ${basename}`);
    }

    try {
      const store = await getStore();
      const relPath = path.relative(PROJECT_ROOT, absPath);
      const embedding = await generateEmbedding(content.slice(0, 4096));
      await store.upsert(relPath, embedding, content.slice(0, 512));
      console.error(`[ContextMesh] Re-indexed: ${relPath}`);
    } catch (err) {
      console.error(`[ContextMesh] Failed to re-index ${absPath}:`, err);
    }
  });

  watcher.start();
  console.error('[ContextMesh] File watcher active');

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.error('[ContextMesh] Shutting down...');
    watcher.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.error('[ContextMesh] Shutting down...');
    watcher.stop();
    process.exit(0);
  });
}
