#!/usr/bin/env node
/**
 * e2e-corpus/run.mjs — Realistic-test E2E runner.
 *
 * Clones a curated public repo at a frozen commit, runs `ctxloom index`,
 * then executes a battery of canned MCP-tool scenarios and asserts the
 * results match expectations.
 *
 * Usage:
 *   node e2e-corpus/run.mjs                          # all repos in repos.json
 *   node e2e-corpus/run.mjs --repo=expressjs/express # one repo
 *   node e2e-corpus/run.mjs --json                   # machine-readable output
 *
 * Exit codes:
 *   0 — all assertions passed
 *   1 — at least one assertion or step failed
 *   2 — runner usage / config error (no repos cloned, schema invalid, etc.)
 *
 * Environment variables:
 *   CTXLOOM_E2E_WORK_DIR  — where to clone repos (default: /tmp/ctxloom-e2e-corpus)
 *   CTXLOOM_E2E_KEEP      — '1' to keep clones between runs (default: keep)
 *   CTXLOOM_BIN           — path to ctxloom binary (default: ./dist/index.js)
 */

import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const workDir = process.env.CTXLOOM_E2E_WORK_DIR || path.join(os.tmpdir(), 'ctxloom-e2e-corpus');
const ctxloomBin = process.env.CTXLOOM_BIN || path.join(repoRoot, 'dist/index.js');
const argv = process.argv.slice(2);
const filterRepo = argv.find((a) => a.startsWith('--repo='))?.slice('--repo='.length) ?? null;
const jsonOutput = argv.includes('--json');

/** @typedef {{ name: string; url: string; commit: string; lang: string; scale: string; scenario: string; indexTimeBudgetMs?: number }} RepoEntry */
/** @typedef {{ name: string; tool: string; args: Record<string, unknown>; assert: Record<string, unknown>; queryLatencyBudgetMs?: number }} Query */
/** @typedef {{ repo: string; graph: { minNodes: number; minEdges: number; maxParseErrors: number }; queries: Query[]; indexTimeBudgetMs?: number }} Scenario */

/**
 * @param {string} cmd
 * @param {readonly string[]} args
 * @param {{ cwd?: string; timeoutMs?: number }} [opts]
 */
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    encoding: 'utf-8',
    timeout: opts.timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status, signal: r.signal };
}

/**
 * @param {RepoEntry} entry
 * @returns {string} clone path
 */
function ensureClone(entry) {
  fs.mkdirSync(workDir, { recursive: true });
  const dir = path.join(workDir, entry.name.replace('/', '__'));
  if (!fs.existsSync(dir)) {
    log(`  cloning ${entry.name} @ ${entry.commit}`);
    const clone = run('git', ['clone', '--depth=1', '--branch', entry.commit, entry.url, dir]);
    if (clone.status !== 0) {
      // Some repos use commit shas not refs; retry with full clone + checkout.
      fs.rmSync(dir, { recursive: true, force: true });
      const fullClone = run('git', ['clone', entry.url, dir]);
      if (fullClone.status !== 0) {
        throw new Error(`git clone failed for ${entry.name}: ${fullClone.stderr}`);
      }
      const checkout = run('git', ['checkout', entry.commit], { cwd: dir });
      if (checkout.status !== 0) throw new Error(`git checkout ${entry.commit} failed: ${checkout.stderr}`);
    }
  } else {
    log(`  using cached ${entry.name}`);
  }
  return dir;
}

/**
 * Run `ctxloom index` against the clone. Returns timing + graph stats.
 * @param {string} cloneDir
 * @param {number} timeoutMs
 */
function indexRepo(cloneDir, timeoutMs) {
  const start = Date.now();
  const r = run('node', [ctxloomBin, 'index'], { cwd: cloneDir, timeoutMs });
  const elapsed = Date.now() - start;
  if (r.status !== 0) {
    throw new Error(`ctxloom index failed (exit ${r.status}):\n${r.stderr}\n${r.stdout}`);
  }
  // Read graph stats from .ctxloom/graph-snapshot.json.
  // Snapshot shape (v1): { fileCount, forwardEdges: {file: [edges]}, reverseEdges, symbolIndex }
  const snapshotPath = path.join(cloneDir, '.ctxloom', 'graph-snapshot.json');
  let nodes = 0;
  let edges = 0;
  if (fs.existsSync(snapshotPath)) {
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    // Prefer "real" node count (indexed symbols); fall back to fileCount.
    const symbolIndex = /** @type {Record<string, unknown> | undefined} */ (snap.symbolIndex);
    const symbolCount = symbolIndex && typeof symbolIndex === 'object' ? Object.keys(symbolIndex).length : 0;
    nodes = symbolCount > 0 ? symbolCount : (snap.fileCount ?? 0);
    // Total directed edges across all files.
    const forwardEdges = /** @type {Record<string, unknown[]> | undefined} */ (snap.forwardEdges);
    if (forwardEdges && typeof forwardEdges === 'object') {
      for (const arr of Object.values(forwardEdges)) {
        if (Array.isArray(arr)) edges += arr.length;
      }
    }
  }
  // Parse-error proxy: count lines in stderr matching common parser-failure patterns.
  // Cheap heuristic — we don't currently emit a structured count.
  const parseErrors = (r.stderr.match(/parse error|failed to parse|tree-sitter.*error/gi) ?? []).length;
  return { elapsed, nodes, edges, parseErrors };
}

/**
 * Invoke an MCP tool by spawning the server, sending a single JSON-RPC
 * `tools/call` message over stdio, and parsing the response.
 *
 * Realistic in the sense that it exercises the same code path a real
 * MCP client would — no in-process shortcuts.
 * @param {string} cloneDir
 * @param {string} tool
 * @param {Record<string, unknown>} args
 * @param {number} [timeoutMs]
 */
function invokeMcpTool(cloneDir, tool, args, timeoutMs = 30000) {
  const reqId = Math.floor(Math.random() * 1e9);
  const initReq = JSON.stringify({
    jsonrpc: '2.0',
    id: reqId,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e-corpus', version: '1.0.0' } },
  });
  const initNotif = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const callReq = JSON.stringify({
    jsonrpc: '2.0',
    id: reqId + 1,
    method: 'tools/call',
    params: { name: tool, arguments: args },
  });
  const input = `${initReq}\n${initNotif}\n${callReq}\n`;

  const start = Date.now();
  const r = spawnSync('node', [ctxloomBin], {
    cwd: cloneDir,
    input,
    encoding: 'utf-8',
    timeout: timeoutMs,
    env: { ...process.env, CTXLOOM_ROOT: cloneDir },
    maxBuffer: 32 * 1024 * 1024,
  });
  const elapsed = Date.now() - start;

  if (r.status !== 0 && r.signal !== 'SIGTERM') {
    throw new Error(`MCP server exited ${r.status}:\n${r.stderr}`);
  }
  // Parse the last JSON-RPC response matching our id.
  const lines = (r.stdout ?? '').split('\n').filter((l) => l.trim().startsWith('{'));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const msg = JSON.parse(lines[i]);
      if (msg.id === reqId + 1) return { result: msg.result, error: msg.error, elapsed };
    } catch {
      /* ignore non-JSON lines */
    }
  }
  throw new Error(`No JSON-RPC response found for ${tool}.\nstdout (tail):\n${(r.stdout ?? '').slice(-2000)}`);
}

/**
 * @param {Query} q
 * @param {{ result?: unknown; error?: unknown; elapsed: number }} resp
 * @returns {{ ok: boolean; reason?: string }}
 */
function checkAssertions(q, resp) {
  if (resp.error) return { ok: false, reason: `tool error: ${JSON.stringify(resp.error)}` };
  if (q.queryLatencyBudgetMs && resp.elapsed > q.queryLatencyBudgetMs) {
    return { ok: false, reason: `latency ${resp.elapsed}ms exceeds budget ${q.queryLatencyBudgetMs}ms` };
  }
  // The MCP `result` shape is { content: [{ type: 'text', text: '...' }] }.
  // Some tools return JSON-stringified payloads in `text`.
  /** @type {{ content?: Array<{ type: string; text?: string }> } | undefined} */
  const result = /** @type {any} */ (resp.result);
  const allText = (result?.content ?? []).map((c) => c.text ?? '').join('\n');
  const a = /** @type {any} */ (q.assert);

  if (typeof a.minResults === 'number') {
    // Best-effort: count "result" entries by counting JSON array items or non-empty paths.
    const lines = allText.split('\n').filter((l) => l.trim());
    if (lines.length < a.minResults) {
      return { ok: false, reason: `expected ≥${a.minResults} result lines, got ${lines.length}` };
    }
  }
  if (Array.isArray(a.anyHitMatches)) {
    const hit = a.anyHitMatches.some((needle) => allText.includes(needle));
    if (!hit) {
      return { ok: false, reason: `none of [${a.anyHitMatches.join(', ')}] appeared in result` };
    }
  }
  if (Array.isArray(a.contentIncludes)) {
    const missing = a.contentIncludes.filter((needle) => !allText.includes(needle));
    if (missing.length) {
      return { ok: false, reason: `content missing: ${missing.join(', ')}` };
    }
  }
  return { ok: true };
}

/**
 * @param {RepoEntry} entry
 * @param {Scenario} scenario
 * @param {string} cloneDir
 */
function runScenario(entry, scenario, cloneDir) {
  /** @type {{ repo: string; steps: Array<{ name: string; ok: boolean; reason?: string; elapsed?: number }>; ok: boolean }} */
  const report = { repo: entry.name, steps: [], ok: true };

  // Step: index
  log(`  indexing…`);
  try {
    const idx = indexRepo(cloneDir, scenario.indexTimeBudgetMs ?? entry.indexTimeBudgetMs ?? 300000);
    const graphOk =
      idx.nodes >= scenario.graph.minNodes &&
      idx.edges >= scenario.graph.minEdges &&
      idx.parseErrors <= scenario.graph.maxParseErrors;
    report.steps.push({
      name: 'index',
      ok: graphOk,
      reason: graphOk
        ? undefined
        : `graph ${idx.nodes}n/${idx.edges}e/${idx.parseErrors}err vs minimum ${scenario.graph.minNodes}n/${scenario.graph.minEdges}e/${scenario.graph.maxParseErrors}err`,
      elapsed: idx.elapsed,
    });
    if (!graphOk) report.ok = false;
  } catch (err) {
    report.steps.push({ name: 'index', ok: false, reason: /** @type {Error} */ (err).message });
    report.ok = false;
    return report; // can't run queries without an index
  }

  // Step: each canned query
  for (const q of scenario.queries) {
    try {
      const resp = invokeMcpTool(cloneDir, q.tool, q.args);
      const check = checkAssertions(q, resp);
      report.steps.push({ name: `${q.tool}:${q.name}`, ok: check.ok, reason: check.reason, elapsed: resp.elapsed });
      if (!check.ok) report.ok = false;
    } catch (err) {
      report.steps.push({ name: `${q.tool}:${q.name}`, ok: false, reason: /** @type {Error} */ (err).message });
      report.ok = false;
    }
  }
  return report;
}

/** @param {string} msg */
function log(msg) {
  if (!jsonOutput) console.log(msg);
}

function main() {
  if (!fs.existsSync(ctxloomBin)) {
    console.error(`[e2e-corpus] ctxloom binary not found at ${ctxloomBin}. Run \`npm run build\` first.`);
    process.exit(2);
  }

  const reposPath = path.join(__dirname, 'repos.json');
  const reposManifest = JSON.parse(fs.readFileSync(reposPath, 'utf-8'));
  /** @type {RepoEntry[]} */
  const allRepos = reposManifest.repos;
  const repos = filterRepo ? allRepos.filter((r) => r.name === filterRepo) : allRepos;
  if (repos.length === 0) {
    console.error(`[e2e-corpus] No repos matched filter ${filterRepo ?? '(none)'}`);
    process.exit(2);
  }

  const reports = [];
  let allOk = true;

  for (const entry of repos) {
    log(`\n[${entry.name}] (${entry.lang}, ${entry.scale})`);
    const scenarioPath = path.join(__dirname, entry.scenario);
    /** @type {Scenario} */
    const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf-8'));
    let cloneDir;
    try {
      cloneDir = ensureClone(entry);
    } catch (err) {
      reports.push({
        repo: entry.name,
        ok: false,
        steps: [{ name: 'clone', ok: false, reason: /** @type {Error} */ (err).message }],
      });
      allOk = false;
      continue;
    }
    const report = runScenario(entry, scenario, cloneDir);
    reports.push(report);
    if (!report.ok) allOk = false;

    // Pretty-print per-repo summary
    for (const s of report.steps) {
      const icon = s.ok ? '✓' : '✗';
      const time = s.elapsed != null ? ` (${s.elapsed}ms)` : '';
      const reason = s.reason ? ` — ${s.reason}` : '';
      log(`    ${icon} ${s.name}${time}${reason}`);
    }
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ ok: allOk, reports }, null, 2));
  } else {
    log('');
    log(`[e2e-corpus] ${allOk ? 'PASS' : 'FAIL'} — ${reports.filter((r) => r.ok).length}/${reports.length} repos green`);
  }

  process.exit(allOk ? 0 : 1);
}

main();
