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

const command = process.argv[2];

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
  ctxloom --help               Show this help

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
`);
      break;
    }

    default: {
      // Start MCP server
      await startServer();
      break;
    }
  }
}

main().catch(err => {
  console.error('[ctxloom] Fatal error:', err);
  process.exit(1);
});
