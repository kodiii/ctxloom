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
import { GitOverlayStore } from './git/GitOverlayStore.js';
import { runSetupWizard } from './setup/setup-wizard.js';
import { GrammarLoader } from './grammars/GrammarLoader.js';
import { RepoRegistry } from './tools/cross-repo-search.js';
import { scoreReviewers } from './review/ReviewerScorer.js';
import { AuthorResolver, resolveViaGitHubApi } from './review/AuthorResolver.js';
import { generateCODEOWNERS, writeCODEOWNERS } from './review/CodeownersWriter.js';
import { loadReviewConfig } from './review/loadConfig.js';
import type { CandidateActivity } from './review/types.js';
import type { CodeownersRule } from './review/CodeownersWriter.js';
import { execSync } from 'node:child_process';
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

function getStagedFiles(root: string): string[] {
  try {
    const out = execSync('git diff --cached --name-only --diff-filter=ACM', {
      cwd: root, encoding: 'utf8',
    });
    return out.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function getGitUserEmail(root: string): string | undefined {
  try {
    return execSync('git config user.email', { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

function getGitHubRepoSlug(root: string): string | undefined {
  try {
    const remote = execSync('git remote get-url origin', { cwd: root, encoding: 'utf8' }).trim();
    const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function buildActivityFromOverlay(store: GitOverlayStore): CandidateActivity[] {
  const lastTouchMap = new Map<string, number>();
  for (const file of store.ownership.allNodes()) {
    const ownerStats = store.ownership.statsFor(file);
    const churnStats = store.churn.statsFor(file);
    if (!ownerStats || !churnStats) continue;
    for (const owner of ownerStats.owners) {
      const existing = lastTouchMap.get(owner.email) ?? 0;
      if (churnStats.lastTouch > existing) {
        lastTouchMap.set(owner.email, churnStats.lastTouch);
      }
    }
  }
  return Array.from(lastTouchMap.entries()).map(([email, lastCommitTimestamp]) => ({
    email,
    lastCommitTimestamp,
  }));
}

async function main(): Promise<void> {
  switch (command) {
    case 'index': {
      console.log('[ctxloom] Indexing current directory...');
      const root = process.cwd();
      const result = await indexDirectory(root, (file, i, total) => {
        process.stdout.write(`\r[ctxloom] Indexing ${i}/${total}: ${file.slice(0, 60)}`);
      });
      console.log(`\n[ctxloom] Done! Indexed ${result.indexed} files, ${result.errors} errors.`);

      // Build dependency graph
      console.log('[ctxloom] Building dependency graph...');
      const parser = new ASTParser();
      await parser.init();
      const graph = new DependencyGraph();
      graph.setParser(parser);
      await graph.buildFromDirectory(root);
      console.log(`[ctxloom] Graph built with ${graph.edgeCount()} edges.`);

      // Mine git history if requested
      if (withGit) {
        console.log('[ctxloom] Mining git history (this may take a minute)...');
        try {
          const overlay = new GitOverlayStore(root, { windowDays: gitWindowDays });
          const loaded = await overlay.loadSnapshot();
          if (loaded) {
            await overlay.refresh();
          } else {
            await overlay.rebuild();
          }
          await overlay.saveSnapshot();
          const stats = overlay.stats();
          console.log(`[ctxloom] Git overlay ready — ${stats.commits} commits mined.`);
        } catch (err) {
          console.warn(`[ctxloom] Git overlay failed (skipping): ${String(err)}`);
        }
      }
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

    case 'review-suggest': {
      const root = process.cwd();
      const ctxloomDir = path.join(root, '.ctxloom');
      const max = parseInt(getFlagValue('--max=') ?? '3', 10);
      if (isNaN(max) || max <= 0) {
        console.error('[ctxloom] --max must be a positive integer.');
        process.exit(1);
      }
      const emitCodeowners = hasFlag('--emit-codeowners');
      const writeFlag = hasFlag('--write');
      const explainFlag = hasFlag('--explain');
      const minShare = parseFloat(getFlagValue('--min-share=') ?? '0.3');
      const excludeFlags = args.filter(a => a.startsWith('--exclude=')).map(a => a.slice('--exclude='.length));
      const authorFlag = getFlagValue('--author=');
      const jsonFlag = hasFlag('--json');

      const store = new GitOverlayStore(root);
      await store.loadSnapshot();

      const positionalFiles = args.filter(a => !a.startsWith('-') && a !== command);
      const files: string[] = positionalFiles.length > 0
        ? positionalFiles
        : getStagedFiles(root);

      if (files.length === 0) {
        console.error('[ctxloom] No files specified and no staged changes found.');
        process.exit(1);
      }

      const config = await loadReviewConfig(root);
      if (excludeFlags.length > 0) {
        config.exclude = [...config.exclude, ...excludeFlags];
      }
      config.defaults = { ...config.defaults, max, minShare };

      const prAuthorEmail = authorFlag ?? getGitUserEmail(root) ?? '';
      const activity = buildActivityFromOverlay(store);
      const resolver = new AuthorResolver(ctxloomDir);
      await resolver.load();

      if (emitCodeowners) {
        const allFiles = store.ownership.allNodes();
        const ruleMap = new Map<string, Set<string>>();
        for (const file of allFiles) {
          const dir = path.dirname(file);
          const stats = store.ownership.statsFor(file);
          if (!stats) continue;
          const topOwners = stats.owners.filter(o => o.share >= minShare).slice(0, 2);
          for (const owner of topOwners) {
            const handle = resolver.resolve(owner.email);
            if (!handle) continue;
            const pattern = `${dir}/**`;
            const set = ruleMap.get(pattern) ?? new Set<string>();
            set.add(handle);
            ruleMap.set(pattern, set);
          }
        }
        const rules: CodeownersRule[] = Array.from(ruleMap.entries())
          .map(([pattern, handles]) => ({ pattern, handles: Array.from(handles) }))
          .sort((a, b) => a.pattern.localeCompare(b.pattern));
        const codeownersPath = path.join(root, '.github', 'CODEOWNERS');
        const content = await generateCODEOWNERS(codeownersPath, rules);
        if (writeFlag) {
          await writeCODEOWNERS(codeownersPath, content);
          console.log(`[ctxloom] Updated ${codeownersPath} (${rules.length} rules).`);
        } else {
          console.log('--- dry run (pass --write to save) ---\n');
          console.log(content);
        }
        break;
      }

      const result = scoreReviewers(
        files,
        store.ownership,
        store.coChange,
        activity,
        prAuthorEmail,
        config,
      );

      if (jsonFlag) {
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      if (result.suggestions.length === 0) {
        console.log('[ctxloom] No suggestions — all candidates filtered by staleness/exclusion rules.');
        break;
      }

      console.log(`\nSuggested reviewers for ${files.length} file(s):`);
      for (let i = 0; i < result.suggestions.length; i++) {
        const s = result.suggestions[i]!;
        const handle = resolver.resolve(s.breakdown.email);
        const displayName = (typeof handle === 'string')
          ? `@${handle}`
          : s.breakdown.email;
        const score = s.breakdown.total.toFixed(2);
        console.log(`  ${i + 1}. ${displayName.padEnd(20)} ${score}   ${s.reason}`);
        if (explainFlag) {
          const b = s.breakdown;
          console.log(`     ownership=${b.ownership.toFixed(2)}  coChange=${b.coChange.toFixed(2)}  activity=${b.activity.toFixed(2)}  busBoost=${b.busFactorBoost.toFixed(2)}  stale=×${b.stalenessMultiplier}`);
        }
      }

      if (result.warnings.length > 0) {
        console.log('');
        for (const w of result.warnings) {
          if (w.busFactor <= 2) {
            console.log(`  ⚠  Bus factor is ${w.busFactor} for ${w.pattern}. Consider pairing a second reviewer.`);
          }
          if (w.topOwnerStalenessDays > 90) {
            console.log(`  ⚠  Top owner last touched ${w.pattern} ${w.topOwnerStalenessDays}d ago. Ownership may be stale.`);
          }
        }
      }
      console.log('');
      break;
    }

    case 'authors-sync': {
      const root = process.cwd();
      const ctxloomDir = path.join(root, '.ctxloom');
      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        console.error('[ctxloom] GITHUB_TOKEN env var required for authors-sync.');
        process.exit(1);
      }
      const repoSlug = getFlagValue('--repo=') ?? getGitHubRepoSlug(root);
      if (!repoSlug) {
        console.error('[ctxloom] Could not detect GitHub repo. Pass --repo=owner/name.');
        process.exit(1);
      }
      const [owner, repo] = repoSlug.split('/') as [string, string];
      const store = new GitOverlayStore(root);
      await store.loadSnapshot();
      const resolver = new AuthorResolver(ctxloomDir);
      await resolver.load();
      const allEmails = Array.from(new Set(
        store.ownership.allNodes().flatMap(f => {
          const s = store.ownership.statsFor(f);
          return s?.owners.map(o => o.email) ?? [];
        }),
      ));
      const unmapped = resolver.unmapped(allEmails);
      if (unmapped.length === 0) {
        console.log('[ctxloom] All authors already mapped.');
        break;
      }
      console.log(`[ctxloom] Resolving ${unmapped.length} unmapped author(s)...`);
      let resolved = 0;
      for (const email of unmapped) {
        const handle = await resolveViaGitHubApi(email, owner, repo, token);
        if (handle) {
          await resolver.writeCache(email, handle);
          resolved++;
          console.log(`  ${email} → @${handle}`);
        }
      }
      console.log(`[ctxloom] Done. Resolved ${resolved}/${unmapped.length}.`);
      break;
    }

    case 'rules': {
      const subCommand = process.argv[3];
      if (subCommand !== 'check') {
        process.stderr.write('[ctxloom] Usage: ctxloom rules check [--json] [--use-snapshot] [--limit=N]\n');
        process.exit(2);
      }

      const root = process.cwd();
      const useSnapshot = hasFlag('--use-snapshot');
      const jsonMode = hasFlag('--json');
      const rawLimit = getFlagValue('--limit=');
      const limit = rawLimit !== undefined ? parseInt(rawLimit, 10) : 50;

      const { loadRulesConfig, RulesChecker, formatText, formatJson, RulesConfigError } = await import('./rules/index.js');

      let config;
      try {
        config = await loadRulesConfig(root);
      } catch (err) {
        if (err instanceof RulesConfigError) {
          process.stderr.write(`[ctxloom] Config error: ${err.message}\n`);
          process.exit(2);
        }
        throw err;
      }

      if (config === null) {
        process.stderr.write(
          '[ctxloom] No .ctxloom/rules.yml found. Create one to define architecture rules.\n' +
          '  See: docs/rules-engine.md\n',
        );
        process.exit(0);
      }

      if (config.rules.length === 0) {
        process.stderr.write('[ctxloom] 0 rules configured. 0 violations.\n');
        process.exit(0);
      }

      let graph;
      if (useSnapshot) {
        const { DependencyGraph } = await import('./graph/DependencyGraph.js');
        graph = new DependencyGraph();
        // loadSnapshotOnly sets up paths and hydrates from the persisted JSON
        // without triggering a full AST rebuild. Returns false when no snapshot exists.
        const loaded = await graph.loadSnapshotOnly(root);
        if (!loaded) {
          process.stderr.write('[ctxloom] --use-snapshot: no graph snapshot found. Run `ctxloom index` first.\n');
          process.exit(2);
        }
      } else {
        process.stderr.write('[ctxloom] Building dependency graph...\n');
        const { ASTParser } = await import('./ast/ASTParser.js');
        const { DependencyGraph } = await import('./graph/DependencyGraph.js');
        let parser;
        try {
          parser = new ASTParser();
          await parser.init();
          graph = new DependencyGraph();
          graph.setParser(parser);
          await graph.buildFromDirectory(root);
        } catch (err) {
          process.stderr.write(`[ctxloom] Failed to build dependency graph: ${String(err)}\n`);
          process.exit(2);
        }
      }

      const result = new RulesChecker(graph, config).check();

      if (jsonMode) {
        process.stdout.write(formatJson(result) + '\n');
      } else {
        process.stdout.write(formatText(result, limit) + '\n');
      }

      const hasErrorViolation = result.violations.some(v => v.severity === 'error');
      process.exit(hasErrorViolation ? 1 : 0);
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
  ctxloom review-suggest [files]   Suggest reviewers from ownership index
  ctxloom authors-sync             Map git emails to GitHub handles (needs GITHUB_TOKEN)
  ctxloom rules check              Check architecture rules (.ctxloom/rules.yml)
  ctxloom rules check --json       Output violations as JSON
  ctxloom rules check --use-snapshot  Fast mode: use existing graph snapshot
  ctxloom rules check --limit=N   Show first N violations (default 50, 0=unlimited)
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
