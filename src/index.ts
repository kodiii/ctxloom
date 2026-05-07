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
import { runSetupWizard } from './setup/setup-wizard.js';
import {
  success as fmtSuccess,
  error as fmtError,
  warn as fmtWarn,
  pending as fmtPending,
  header as fmtHeader,
  kvTable as fmtKvTable,
  nextStep as fmtNextStep,
  errorBlock as fmtErrorBlock,
  style,
} from './cli/format.js';
import {
  indexDirectory,
  DependencyGraph,
  ASTParser,
  GitOverlayStore,
  GrammarLoader,
  RepoRegistry,
  scoreReviewers,
  AuthorResolver,
  resolveViaGitHubApi,
  generateCODEOWNERS,
  writeCODEOWNERS,
  loadReviewConfig,
  isActive,
  getLicenseInfo,
  activateLicense,
  deactivateLicense,
  startTrial,
  LicenseRequiredError,
  NetworkError,
  SeatLimitError,
  InvalidKeyError,
  FingerprintAlreadyUsedError,
  EmailAlreadyUsedError,
  TrialUnavailableError,
  track,
  captureError,
  recordTrendSnapshot,
} from '@ctxloom/core';
import type { CandidateActivity } from '@ctxloom/core';
import type { CodeownersRule } from '@ctxloom/core';
import { execSync } from 'node:child_process';
import * as readline from 'node:readline';
import os from 'node:os';
import path from 'node:path';

// ─── File-descriptor headroom ────────────────────────────────────────────────
// Indexing a 600+ file project simultaneously holds many descriptors open
// (LanceDB SSTables + tree-sitter WASM grammars + ONNX model files +
// per-file reads). On macOS, processes spawned by Claude / VS Code inherit
// a 256-FD soft limit, which is too low. Try to bump the soft limit toward
// the hard limit if Node exposes the API.
//
// process.setrlimit was added in Node 24. Node 20 (current build target)
// doesn't have it, so this is a no-op there — users still need to set
// `ulimit -n 4096` manually. The fix-side mitigation (closing the
// VectorStore between phases) is the durable solution.
try {
  const proc = process as NodeJS.Process & {
    setrlimit?: (resource: 'nofile', limits: { soft: number; hard: number }) => void;
    getrlimit?: (resource: 'nofile') => { soft: number; hard: number };
  };
  if (typeof proc.getrlimit === 'function' && typeof proc.setrlimit === 'function') {
    const cur = proc.getrlimit('nofile');
    const target = Math.min(cur.hard, Math.max(cur.soft, 8192));
    if (target > cur.soft) proc.setrlimit('nofile', { soft: target, hard: cur.hard });
  }
} catch {
  // Best-effort; never block CLI startup on rlimit tuning failures.
}

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

// ─── License gate ────────────────────────────────────────────────────────────

// M-1 (audit): the previous CTXLOOM_LICENSE_BYPASS=1 env-var escape
// hatch was removed. The legitimate use case (Codzign team using the
// CLI without burning paid seats) is now served by the internal Polar
// product — a hidden €0 product with 5 lifetime activations. Team
// members run `ctxloom activate <internal-key>` like any real customer,
// which goes through the same code path and exercises the actual
// license flow (good for dogfooding).
//
// Tests use either the same internal key or a CTXLOOM_LICENSE_KEY env
// var that hits the validate endpoint — no source-level bypass.
const LICENSE_GATE_BYPASS_COMMANDS = new Set(['trial', 'activate', 'deactivate', 'status', '--help']);

async function checkLicense(): Promise<void> {
  if (command !== undefined && LICENSE_GATE_BYPASS_COMMANDS.has(command)) return;

  const ciKey = process.env['CTXLOOM_LICENSE_KEY'];
  if (ciKey) {
    // CI path: validate on every invocation, no local state
    const { ApiClient } = await import('@ctxloom/core');
    const client = new ApiClient(process.env['CTXLOOM_API_BASE']);
    try {
      const result = await client.validate(ciKey, 'ci-ephemeral');
      if (result.status === 'revoked' || result.status === 'expired') {
        // BUG-002: Must use stderr — stdout is the MCP JSON-RPC channel when
        // running as an MCP server. Writing plain text to stdout corrupts the
        // protocol and causes "Server disconnected" in the client.
        process.stderr.write(`\nctxloom license is ${result.status}.\n  Purchase a new license at https://ctxloom.com/pricing\n\n`);
        process.exit(2);
      }
    } catch {
      // Network failure in CI — fail hard (no offline grace for ephemeral runners)
      process.stderr.write(`[ctxloom] License validation failed. Check CTXLOOM_LICENSE_KEY.\n`);
      process.exit(2);
    }
    return;
  }

  const active = await isActive();
  if (!active) {
    track('license_gate_hit', os.hostname());
    // BUG-002: Must use stderr — stdout is the MCP JSON-RPC channel when
    // running as an MCP server. Writing plain text to stdout corrupts the
    // protocol and causes "Server disconnected" in the client.
    process.stderr.write(fmtErrorBlock('ctxloom requires an active license.', [
      `${style.bold('ctxloom trial')}            ${style.dim('— start a 7-day free trial')}`,
      `${style.bold('ctxloom activate <KEY>')}   ${style.dim('— activate a purchased key')}`,
      `${style.link('https://ctxloom.com/pricing')}  ${style.dim('— buy a license')}`,
    ]));
    process.exit(2);
  }
}

// ─── License command handlers ─────────────────────────────────────────────────

async function promptEmail(): Promise<string> {
  const flagEmail = getFlagValue('--email=');
  if (flagEmail) return flagEmail;
  if (!process.stdin.isTTY) {
    process.stderr.write('[ctxloom] Use --email=<address> in non-interactive mode.\n');
    process.exit(1);
  }
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Email: ', answer => { rl.close(); resolve(answer.trim()); });
  });
}

async function runTrial(): Promise<void> {
  process.stdout.write(fmtHeader('Trial'));
  process.stdout.write(`  ${style.dim('7-day free trial · no credit card required')}\n\n`);
  const email = await promptEmail();
  if (!email) {
    process.stderr.write(fmtErrorBlock('Email is required.'));
    process.exit(1);
  }
  process.stdout.write(`  ${fmtPending('Creating checkout…')}\n`);
  try {
    const result = await startTrial(email);
    process.stdout.write(`  ${fmtSuccess('Checkout ready')}\n\n`);
    process.stdout.write(`  ${style.dim('Open in your browser:')}\n`);
    process.stdout.write(`  ${style.link(result.checkoutUrl)}\n\n`);
    process.stdout.write(`  ${style.dim(`Your license key will arrive at ${email} after checkout.`)}\n`);
    process.stdout.write(fmtNextStep('Activate on this machine', 'ctxloom activate <KEY>'));
    track('trial_started', os.hostname(), { email });
  } catch (err) {
    if (err instanceof FingerprintAlreadyUsedError) {
      process.stdout.write(fmtErrorBlock('A trial has already been used on this machine.', [
        `Purchase a license at ${style.link('https://ctxloom.com/pricing')}`,
      ]));
      process.exit(1);
    }
    if (err instanceof EmailAlreadyUsedError) {
      process.stdout.write(fmtErrorBlock('A trial has already been used for this email.', [
        `Try a different email, or purchase a license at ${style.link('https://ctxloom.com/pricing')}`,
      ]));
      process.exit(1);
    }
    if (err instanceof TrialUnavailableError) {
      process.stderr.write(fmtErrorBlock('Trial service is temporarily unavailable.', [
        `Activate a purchased key:  ${style.bold('ctxloom activate <KEY>')}`,
        `Buy a license now:         ${style.link('https://ctxloom.com/pricing')}`,
        `Status updates:            ${style.link('https://ctxloom.com/status')}`,
      ]));
      process.exit(1);
    }
    process.stderr.write(fmtErrorBlock('Trial request failed.', [
      err instanceof Error ? err.message : String(err),
    ]));
    process.exit(1);
  }
}

async function runActivate(key: string): Promise<void> {
  process.stdout.write(fmtHeader('Activate'));
  process.stdout.write(`  ${fmtPending('Activating on this machine…')}\n`);
  try {
    const license = await activateLicense(key);
    const tier = license.tier.charAt(0).toUpperCase() + license.tier.slice(1);
    const expires = license.expiresAt ? new Date(license.expiresAt).toISOString().slice(0, 10) : 'Never';
    process.stdout.write(`  ${fmtSuccess(`${style.bold(`ctxloom ${tier}`)} activated`)}\n\n`);
    process.stdout.write(fmtKvTable([
      ['Tier', tier],
      ['Expires', expires],
      ['Machine', `${os.hostname()} (${os.platform()}-${os.arch()})`],
    ]));
    process.stdout.write(fmtNextStep('Configure your AI tools', 'ctxloom setup'));
    track('license_activated', os.hostname(), { tier: license.tier });
  } catch (err) {
    if (err instanceof SeatLimitError) {
      process.stdout.write(fmtErrorBlock('Seat limit reached.', [
        `Deactivate another machine: ${style.link('https://ctxloom.com/account/licenses')}`,
        `Or upgrade to Team:         ${style.link('https://ctxloom.com/pricing')}`,
      ]));
      process.exit(1);
    }
    if (err instanceof InvalidKeyError) {
      process.stdout.write(fmtErrorBlock('Invalid license key.', [
        'Double-check the key from your purchase email.',
        `Or buy a license at ${style.link('https://ctxloom.com/pricing')}`,
      ]));
      process.exit(1);
    }
    if (err instanceof NetworkError) {
      process.stderr.write(fmtErrorBlock('Activation failed — network error.', [
        'Check your internet connection and try again.',
      ]));
      process.exit(1);
    }
    process.stderr.write(fmtErrorBlock('Activation failed.', [
      err instanceof Error ? err.message : String(err),
    ]));
    process.exit(1);
  }
}

async function runDeactivate(): Promise<void> {
  process.stdout.write(fmtHeader('Deactivate'));
  process.stdout.write(`  ${fmtPending('Releasing this seat…')}\n`);
  try {
    await deactivateLicense();
    process.stdout.write(`  ${fmtSuccess('Deactivated')}\n`);
    process.stdout.write(fmtNextStep('Activate on another machine', 'ctxloom activate <KEY>'));
    track('license_deactivated', os.hostname());
  } catch (err) {
    if (err instanceof NetworkError) {
      process.stderr.write(fmtErrorBlock('Deactivation failed — network error.', [
        'Check your internet connection and try again.',
      ]));
      process.exit(1);
    }
    process.stderr.write(fmtErrorBlock('Deactivation failed.', [
      err instanceof Error ? err.message : String(err),
    ]));
    process.exit(1);
  }
}

async function runStatus(): Promise<void> {
  const license = await getLicenseInfo();
  if (!license) {
    process.stdout.write(fmtHeader('License Status'));
    process.stdout.write(`  ${fmtWarn(style.bold('No active license'))}\n\n`);
    process.stdout.write(`  ${style.dim('Get started:')}\n`);
    process.stdout.write(`  ${style.dim('•')} ${style.bold('ctxloom trial')}                    ${style.dim('— start a 7-day free trial')}\n`);
    process.stdout.write(`  ${style.dim('•')} ${style.bold('ctxloom activate <KEY>')}           ${style.dim('— activate a purchased key')}\n`);
    process.stdout.write(`  ${style.dim('•')} ${style.link('https://ctxloom.com/pricing')}      ${style.dim('— buy a license')}\n\n`);
    return;
  }
  const expires = license.expiresAt ? new Date(license.expiresAt).toISOString().slice(0, 10) : 'Never';
  const daysLeft = license.expiresAt
    ? Math.ceil((new Date(license.expiresAt).getTime() - Date.now()) / 86400000)
    : null;
  const expiresLabel = daysLeft !== null ? `${expires} ${style.dim(`(in ${daysLeft} day${daysLeft === 1 ? '' : 's'})`)}` : expires;
  const lastCheck = license.lastValidatedAt
    ? (() => {
        const h = Math.floor((Date.now() - new Date(license.lastValidatedAt).getTime()) / 3600000);
        return h < 1 ? 'just now' : `${h} hour${h === 1 ? '' : 's'} ago`;
      })()
    : 'never';
  const tier = license.tier.charAt(0).toUpperCase() + license.tier.slice(1);
  const statusRaw = license.status.charAt(0).toUpperCase() + license.status.slice(1);
  const statusColored =
    license.status === 'active' ? style.success(statusRaw)
      : license.status === 'trialing' ? style.highlight(statusRaw)
        : style.warn(statusRaw);

  process.stdout.write(fmtHeader('License Status'));
  process.stdout.write(fmtKvTable([
    ['Tier', style.bold(tier)],
    ['Status', statusColored],
    ['Expires', expiresLabel],
    ['Machine', `${os.hostname()} ${style.dim(`(${os.platform()}-${os.arch()})`)}`],
    ['Last sync', style.dim(lastCheck)],
  ]));
  process.stdout.write('\n');
}

async function main(): Promise<void> {
  await checkLicense();

  switch (command) {
    case 'trial': {
      await runTrial();
      break;
    }

    case 'activate': {
      const key = args.find(a => !a.startsWith('-') && a !== 'activate');
      if (!key) { process.stderr.write('[ctxloom] Usage: ctxloom activate <KEY>\n'); process.exit(1); }
      await runActivate(key);
      break;
    }

    case 'deactivate': {
      await runDeactivate();
      break;
    }

    case 'status': {
      await runStatus();
      break;
    }

    case 'index': {
      process.stdout.write(fmtHeader('Index'));
      const root = process.cwd();
      process.stdout.write(`  ${style.dim('Root:')} ${root}\n\n`);
      process.stdout.write(`  ${fmtPending('Indexing files…')}\n`);
      const indexStart = Date.now();
      const result = await indexDirectory(root, (file, i, total) => {
        // \r overwrites in-place; clear-to-EOL keeps prior longer paths from leaking
        const trimmed = file.length > 60 ? '…' + file.slice(-59) : file;
        process.stdout.write(`\r  ${style.dim(`[${i}/${total}]`)} ${style.dim(trimmed)}\x1b[K`);
      });
      const indexMs = Date.now() - indexStart;
      // Clear the progress line, then emit summary
      process.stdout.write('\r\x1b[K');
      const errLabel = result.errors === 0 ? style.dim('0 errors') : style.warn(`${result.errors} error${result.errors === 1 ? '' : 's'}`);
      process.stdout.write(`  ${fmtSuccess(`Indexed ${style.bold(String(result.indexed))} files`)} ${style.dim('·')} ${errLabel} ${style.dim(`· ${(indexMs / 1000).toFixed(1)}s`)}\n\n`);

      // Build dependency graph
      process.stdout.write(`  ${fmtPending('Building dependency graph…')}\n`);
      const graphStart = Date.now();
      const parser = new ASTParser();
      await parser.init();
      const graph = new DependencyGraph();
      graph.setParser(parser);
      const trendOverlay = new GitOverlayStore(root);
      const trendGitEnabled = await trendOverlay.loadSnapshot();
      await graph.buildFromDirectory(root, {
        afterReady: async () => {
          await recordTrendSnapshot({ graph, overlay: trendOverlay, gitEnabled: trendGitEnabled, rootDir: root, source: 'cli' });
        },
      });
      const graphMs = Date.now() - graphStart;
      process.stdout.write(`  ${fmtSuccess(`Graph built with ${style.bold(String(graph.edgeCount()))} edges`)} ${style.dim(`· ${(graphMs / 1000).toFixed(1)}s`)}\n`);

      // Mine git history if requested
      if (withGit) {
        process.stdout.write(`  ${fmtPending('Mining git history (may take ~1 min)…')}\n`);
        const gitStart = Date.now();
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
          const gitMs = Date.now() - gitStart;
          process.stdout.write(`  ${fmtSuccess(`Git overlay ready · ${style.bold(String(stats.commits))} commits`)} ${style.dim(`· ${(gitMs / 1000).toFixed(1)}s`)}\n`);
        } catch (err) {
          process.stdout.write(`  ${fmtWarn(`Git overlay skipped: ${String(err).slice(0, 80)}`)}\n`);
        }
      }
      process.stdout.write(fmtNextStep('Configure your AI tools', 'ctxloom setup'));
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
      if (rawLimit !== undefined && (isNaN(limit) || limit < 0)) {
        process.stderr.write('[ctxloom] --limit must be a non-negative integer (0 for unlimited)\n');
        process.exit(2);
      }

      const { loadRulesConfig, RulesChecker, formatText, formatJson, RulesConfigError } = await import('@ctxloom/core');

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
        process.stdout.write('[ctxloom] 0 rules configured. 0 violations.\n');
        process.exit(0);
      }

      let graph: InstanceType<typeof DependencyGraph>;
      if (useSnapshot) {
        const { DependencyGraph: DG } = await import('@ctxloom/core');
        graph = new DG();
        // loadSnapshotOnly sets up paths and hydrates from the persisted JSON
        // without triggering a full AST rebuild. Returns false when no snapshot exists.
        const loaded = await graph.loadSnapshotOnly(root);
        if (!loaded) {
          process.stderr.write('[ctxloom] --use-snapshot: no graph snapshot found. Run `ctxloom index` first.\n');
          process.exit(2);
        }
      } else {
        process.stderr.write('[ctxloom] Building dependency graph...\n');
        const { ASTParser, DependencyGraph } = await import('@ctxloom/core');
        let parser;
        try {
          parser = new ASTParser();
          await parser.init();
          graph = new DependencyGraph();
          graph.setParser(parser);
          const rulesOverlay = new GitOverlayStore(root);
          const rulesGitEnabled = await rulesOverlay.loadSnapshot();
          await graph.buildFromDirectory(root, {
            afterReady: async () => {
              await recordTrendSnapshot({ graph, overlay: rulesOverlay, gitEnabled: rulesGitEnabled, rootDir: root, source: 'cli' });
            },
          });
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
  ctxloom trial                Start a free 7-day trial (no credit card required)
  ctxloom activate <KEY>       Activate a purchased license key on this machine
  ctxloom deactivate           Release this machine's license seat
  ctxloom status               Show current license status
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
  ctx_rules_check            Check architecture rules against live dependency graph
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
  captureError(err, { command: command ?? 'mcp-server' });
  console.error('[ctxloom] Fatal error:', err);
  process.exit(1);
});
