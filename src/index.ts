#!/usr/bin/env node

/**
 * ctxloom — The Universal Code Context Engine
 *
 * A local-first MCP sidecar providing intelligent code context via
 * hybrid Vector + AST + Graph search with Skeletonization.
 *
 * Usage:
 *   ctxloom              Start MCP server on Stdio
 *   ctxloom index        Index the current directory
 *   ctxloom setup        Configure MCP clients (interactive wizard)
 *   ctxloom --help       Show help
 */

import { startServer } from './server.js';
import { indexDirectory } from './indexer/embedder.js';
import { DependencyGraph } from './graph/DependencyGraph.js';
import { ASTParser } from './ast/ASTParser.js';
import { runSetupWizard } from './setup/setup-wizard.js';
import { GrammarLoader } from './grammars/GrammarLoader.js';
import { RepoRegistry } from './tools/cross-repo-search.js';
import os from 'node:os';
import path from 'node:path';

// ─── CLI flag parsing ────────────────────────────────────────────────────────

const args = process.argv.slice(2);

/**
 * Resolved command: the first positional argument (not a flag).
 * Special-cased: '--help' and '-h' are mapped to '--help' so the switch
 * still handles them even though they start with '-'.
 */
const command: string | undefined =
  args.includes('--help') || args.includes('-h')
    ? '--help'
    : args.find(a => !a.startsWith('-'));

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

function getFlagValue(prefix: string): string | undefined {
  const entry = args.find(a => a.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : undefined;
}

// --with-git (default true), --no-git
const withGit = hasFlag('--with-git') || !hasFlag('--no-git');

// --git-window-days=<n> (default 365)
const rawWindowDays = getFlagValue('--git-window-days=');
const parsed = rawWindowDays !== undefined ? parseInt(rawWindowDays, 10) : 365;
if (isNaN(parsed) || parsed <= 0) {
  process.stderr.write(`[ctxloom] Invalid --git-window-days value: "${rawWindowDays}". Must be a positive integer.\n`);
  process.exit(1);
}
const gitWindowDays = parsed;

async function main(): Promise<void> {
  switch (command) {
    case 'index': {
      console.log('[ctxloom] Indexing current directory...');
      const root = process.cwd();
      const result = await indexDirectory(root, (file, i, total) => {
        process.stdout.write(`\r[ctxloom] Indexing ${i}/${total}: ${file.slice(0, 60)}`);
      });
      console.log(`\n[ctxloom] Done! Indexed ${result.indexed} files, ${result.errors} errors.`);

      // Also build the dependency graph
      console.log('[ctxloom] Building dependency graph...');
      const parser = new ASTParser();
      await parser.init();
      const graph = new DependencyGraph();
      graph.setParser(parser);
      await graph.buildFromDirectory(root);
      console.log(`[ctxloom] Graph built with ${graph.edgeCount()} edges.`);
      break;
    }

    case 'setup': {
      await runSetupWizard();
      break;
    }

    case 'register': {
      const repoPath = process.argv[3];
      if (!repoPath) {
        console.error('[ctxloom] Usage: ctxloom register <path>');
        process.exit(1);
      }
      const absPath = path.resolve(repoPath);
      const dbPath = path.join(absPath, '.ctxloom', 'vectors.lancedb');
      const registryPath = path.join(os.homedir(), '.ctxloom', 'repos.json');
      const reg = new RepoRegistry(registryPath);
      reg.register(absPath, dbPath);
      console.log(`[ctxloom] Registered repo: ${absPath}`);
      console.log(`[ctxloom] LanceDB path: ${dbPath}`);
      console.log(`[ctxloom] Registry: ${registryPath}`);
      break;
    }

    case 'repos': {
      const registryPath = path.join(os.homedir(), '.ctxloom', 'repos.json');
      const reg = new RepoRegistry(registryPath);
      const repos = reg.list();
      if (repos.length === 0) {
        console.log('[ctxloom] No repos registered. Run: ctxloom register <path>');
      } else {
        console.log(`\n[ctxloom] Registered repos (${repos.length}):`);
        for (const r of repos) {
          console.log(`  ${r.name.padEnd(20)} ${r.root}`);
        }
      }
      break;
    }

    case 'grammars': {
      const subCommand = process.argv[3]; // undefined or --download
      const loader = new GrammarLoader();
      const list = loader.listGrammars();
      console.log('\n[ctxloom] Grammar cache status:');
      for (const g of list) {
        const icon = g.status === 'cached' ? '✓' : '○';
        const location = g.cachedPath ?? '(not cached)';
        console.log(`  ${icon} ${g.language.padEnd(10)} v${g.version}  ${g.extensions.join(', ').padEnd(12)}  ${location}`);
      }
      console.log('\nTo pre-download all grammars: ctxloom grammars --download');

      if (subCommand === '--download') {
        console.log('\n[ctxloom] Downloading missing grammars...');
        for (const g of list) {
          if (g.status === 'missing') {
            try {
              await loader.ensureGrammar(g.language);
              console.log(`  ✓ ${g.language}`);
            } catch (err) {
              console.error(`  ✗ ${g.language}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }
      }
      break;
    }

    case 'dashboard': {
      const port = Number(
        args.find(a => a.startsWith('--port='))?.split('=')[1] ?? '7842'
      );
      const open = args.includes('--open') || args.includes('-o');
      const root = process.env.CTXLOOM_ROOT ?? process.cwd();
      const { startDashboard } = await import('./dashboard.js');
      await startDashboard({ root, port, open });
      break;
    }

    case '--help':
    case '-h': {
      console.log(`
ctxloom — The Universal Code Context Engine

Usage:
  ctxloom                      Start MCP server on Stdio transport
  ctxloom index                Index the current directory and build dependency graph
  ctxloom setup                Detect and configure MCP-compatible AI tools
  ctxloom grammars             Show grammar cache status
  ctxloom grammars --download  Pre-download all language grammars
  ctxloom register <path>      Register a repo for cross-repo search
  ctxloom repos                List all registered repos
  ctxloom dashboard            Start the web dashboard (port 7842)
  ctxloom dashboard --port=N   Start on custom port
  ctxloom dashboard --open     Open browser automatically
  ctxloom --help               Show this help

Flags (for MCP server mode):
  --with-git                   Enable git history overlay (default: true)
  --no-git                     Disable git history overlay
  --git-window-days=<n>        Days of git history to mine (default: 365)

Environment Variables:
  CTXLOOM_ROOT     Project root directory (default: current working directory)

MCP Client Configuration:
  Add to your MCP client config (e.g., Claude Code, Cursor):

  {
    "mcpServers": {
      "ctxloom": {
        "command": "npx",
        "args": ["-y", "ctxloom"]
      }
    }
  }

  Or run 'ctxloom setup' to auto-detect and configure your tools.

Tools Exposed:
  ctx_search             Hybrid semantic + graph search
  ctx_get_file           Safe file read with path validation
  ctx_get_context_packet Smart multi-file context with skeletonization
  ctx_get_call_graph     Bidirectional call graph traversal with depth
  ctx_get_definition     Symbol definition lookup
  ctx_get_rules          Project rule injection from .cursorrules, CLAUDE.md, etc.
  ctx_similar_files      Find semantically similar files via vector embeddings
  ctx_status             Server status: graph size, vector store, init state
  ctx_blast_radius       Blast radius of changed files: importers + call sites
  ctx_hub_nodes          Top-N files by import degree (architectural chokepoints)
  ctx_bridge_nodes       Top-N files by betweenness centrality (graph connectors)
  ctx_community_list         Louvain communities — cluster files into architectural modules
  ctx_architecture_overview  High-level structural summary: communities, hubs, coupling
  ctx_knowledge_gaps         Isolated files, untested hubs, dead code candidates
  ctx_surprising_connections Circular deps, cross-community imports, prod→test violations
  ctx_wiki_generate          Generate .ctxloom/wiki/ — one Markdown page per community
  ctx_graph_export           Export graph: GraphML (Gephi), DOT (Graphviz), Obsidian vault
  ctx_git_diff_review        All-in-one code review packet: diffs + skeletons + blast radius
  ctx_refactor_preview       Read-only symbol rename diff preview across definition files and importers
  ctx_execution_flow         DFS call graph traversal from entry point with cycle detection
  ctx_cross_repo_search      Federated semantic search across all registered repos
  ctx_git_coupling           Co-change coupling between files from git history
  ctx_risk_overlay           Risk score overlay: churn, coupling, ownership bus-factor
`);
      break;
    }

    default: {
      // Start MCP server
      await startServer({ withGit, gitWindowDays });
      break;
    }
  }
}

main().catch(err => {
  console.error('[ctxloom] Fatal error:', err);
  process.exit(1);
});
