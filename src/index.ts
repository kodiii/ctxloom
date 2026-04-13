#!/usr/bin/env node

/**
 * ContextMesh — The Universal Code Context Engine
 *
 * A local-first MCP sidecar providing intelligent code context via
 * hybrid Vector + AST + Graph search with Skeletonization.
 *
 * Usage:
 *   contextmesh              Start MCP server on Stdio
 *   contextmesh index        Index the current directory
 *   contextmesh setup        Configure MCP clients (interactive wizard)
 *   contextmesh --help       Show help
 */

import { startServer } from './server.js';
import { indexDirectory } from './indexer/embedder.js';
import { DependencyGraph } from './graph/DependencyGraph.js';
import { ASTParser } from './ast/ASTParser.js';
import { runSetupWizard } from './setup/setup-wizard.js';

const command = process.argv[2];

async function main(): Promise<void> {
  switch (command) {
    case 'index': {
      console.log('[ContextMesh] Indexing current directory...');
      const root = process.cwd();
      const result = await indexDirectory(root, (file, i, total) => {
        process.stdout.write(`\r[ContextMesh] Indexing ${i}/${total}: ${file.slice(0, 60)}`);
      });
      console.log(`\n[ContextMesh] Done! Indexed ${result.indexed} files, ${result.errors} errors.`);

      // Also build the dependency graph
      console.log('[ContextMesh] Building dependency graph...');
      const parser = new ASTParser();
      await parser.init();
      const graph = new DependencyGraph();
      graph.setParser(parser);
      await graph.buildFromDirectory(root);
      console.log(`[ContextMesh] Graph built with ${graph.edgeCount()} edges.`);
      break;
    }

    case 'setup': {
      await runSetupWizard();
      break;
    }

    case '--help':
    case '-h': {
      console.log(`
ContextMesh — The Universal Code Context Engine

Usage:
  contextmesh          Start MCP server on Stdio transport
  contextmesh index    Index the current directory and build dependency graph
  contextmesh setup    Detect and configure MCP-compatible AI tools
  contextmesh --help   Show this help

Environment Variables:
  CONTEXTMESH_ROOT     Project root directory (default: current working directory)

MCP Client Configuration:
  Add to your MCP client config (e.g., Claude Code, Cursor):

  {
    "mcpServers": {
      "contextmesh": {
        "command": "npx",
        "args": ["-y", "contextmesh"]
      }
    }
  }

  Or run 'contextmesh setup' to auto-detect and configure your tools.

Tools Exposed:
  ctx_search             Hybrid semantic + graph search
  ctx_get_file           Safe file read with path validation
  ctx_get_context_packet Smart multi-file context with skeletonization
  ctx_get_call_graph     Bidirectional call graph traversal with depth
  ctx_get_definition     Symbol definition lookup
  ctx_get_rules          Project rule injection from .cursorrules, CLAUDE.md, etc.
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
  console.error('[ContextMesh] Fatal error:', err);
  process.exit(1);
});
