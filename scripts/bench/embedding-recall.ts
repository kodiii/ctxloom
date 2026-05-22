#!/usr/bin/env tsx
/**
 * embedding-recall.ts — targeted recall micro-bench for the v1.7.0
 * embedding model swap.
 *
 * Question we answer: does `jina-code` actually distinguish code
 * semantically better than `minilm` (the historical default)?
 *
 * Why a micro-bench and not the full F1 harness:
 *
 *   The full bench re-indexes 15 worktrees with the active embedding
 *   model — each worktree is 50-3000 files and indexing dominates wall
 *   time. We tried it; it stalled at 30+ min with no output (likely
 *   first-time jina-code model download + LanceDB lock contention on
 *   the corpus dirs we just wiped).
 *
 *   A targeted recall test doesn't need the indexer or LanceDB at all.
 *   We embed a small fixed corpus directly, compute cosine similarity
 *   for known-similar pairs and known-different pairs, and report the
 *   discrimination gap. This is the right tool for the actual
 *   question: "does the embedding distinguish code semantically?"
 *
 * Methodology:
 *
 *   1. SIMILAR pairs (10) — two snippets that describe the SAME
 *      semantic operation in different ways. Expected: high cosine.
 *   2. DIFFERENT pairs (10) — two snippets that are syntactically
 *      similar but semantically unrelated. Expected: low cosine.
 *   3. Discrimination score = avg(SIMILAR) - avg(DIFFERENT).
 *      Higher = better at distinguishing meaning from form.
 *
 *   Run once with the active model. To compare:
 *     CTXLOOM_EMBEDDING_MODEL=minilm    npx tsx scripts/bench/embedding-recall.ts
 *     CTXLOOM_EMBEDDING_MODEL=jina-code npx tsx scripts/bench/embedding-recall.ts
 *
 *   The pairs are intentionally code-focused (parsing, error handling,
 *   data structures, async flow) so the result reflects what the
 *   production semantic-search tool actually has to discriminate.
 */
import { generateEmbedding, getActiveEmbeddingModel } from '../../packages/core/src/indexer/embedder.js';

interface Pair {
  a: string;
  b: string;
  /** Hint for the human reader — not used in the math. */
  label: string;
}

/**
 * Pairs that DO mean the same thing — different syntax, same intent.
 * A good code embedder ranks these as highly similar (target ≥0.6).
 */
const SIMILAR: Pair[] = [
  {
    label: 'parse JSON safely (try/catch vs Result return)',
    a: `function parseJSON(s) {
  try { return JSON.parse(s); }
  catch { return null; }
}`,
    b: `def parse_json(s):
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        return None`,
  },
  {
    label: 'iterate map and sum values',
    a: `let total = 0;
for (const [k, v] of map) {
  total += v;
}`,
    b: `total = sum(map.values())`,
  },
  {
    label: 'HTTP GET with JSON response (axios vs fetch)',
    a: `const r = await axios.get(url);
return r.data;`,
    b: `const r = await fetch(url);
return await r.json();`,
  },
  {
    label: 'guard clause for null parameter',
    a: `if (!user) throw new Error("user required");`,
    b: `if user is None:
    raise ValueError("user required")`,
  },
  {
    label: 'binary search on sorted array',
    a: `function binSearch(arr, t) {
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] === t) return m;
    if (arr[m] < t) lo = m + 1;
    else hi = m - 1;
  }
  return -1;
}`,
    b: `def binary_search(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target: return mid
        if arr[mid] < target: lo = mid + 1
        else: hi = mid - 1
    return -1`,
  },
  {
    label: 'singleton pattern',
    a: `let instance;
function getInstance() {
  if (!instance) instance = new Service();
  return instance;
}`,
    b: `_instance = None
def get_instance():
    global _instance
    if _instance is None:
        _instance = Service()
    return _instance`,
  },
  {
    label: 'debounce function',
    a: `function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}`,
    b: `def debounce(fn, ms):
    timer = None
    def wrapper(*args):
        nonlocal timer
        if timer: timer.cancel()
        timer = Timer(ms/1000, lambda: fn(*args))
        timer.start()
    return wrapper`,
  },
  {
    label: 'extract domain from URL',
    a: `const url = new URL(href);
return url.hostname;`,
    b: `from urllib.parse import urlparse
return urlparse(href).hostname`,
  },
  {
    label: 'group array by key',
    a: `const groups = {};
for (const item of items) {
  const k = item.category;
  (groups[k] ||= []).push(item);
}`,
    b: `from collections import defaultdict
groups = defaultdict(list)
for item in items:
    groups[item.category].append(item)`,
  },
  {
    label: 'retry with exponential backoff',
    a: `async function retry(fn, n) {
  for (let i = 0; i < n; i++) {
    try { return await fn(); }
    catch { await sleep(2 ** i * 100); }
  }
}`,
    b: `async def retry(fn, n):
    for i in range(n):
        try:
            return await fn()
        except Exception:
            await asyncio.sleep((2 ** i) * 0.1)`,
  },
];

/**
 * Pairs that DON'T mean the same thing — often share syntactic shape
 * (e.g. both are loops, both throw errors) but the semantic intent
 * differs. A good code embedder ranks these as NOT very similar (target ≤0.4).
 */
const DIFFERENT: Pair[] = [
  {
    label: 'parse JSON vs format date',
    a: `return JSON.parse(s);`,
    b: `return new Date(s).toISOString();`,
  },
  {
    label: 'binary search vs bubble sort',
    a: `function binSearch(arr, t) {
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) { /*...*/ }
}`,
    b: `function bubbleSort(arr) {
  for (let i = 0; i < arr.length; i++) {
    for (let j = 0; j < arr.length - 1; j++) { /*...*/ }
  }
}`,
  },
  {
    label: 'HTTP request vs database query',
    a: `const r = await fetch(url);`,
    b: `const rows = await db.query("SELECT * FROM users");`,
  },
  {
    label: 'null guard vs auth check',
    a: `if (!user) throw new Error("user required");`,
    b: `if (!user.isAdmin) throw new Error("forbidden");`,
  },
  {
    label: 'singleton vs factory',
    a: `let instance;
function getInstance() {
  if (!instance) instance = new Service();
  return instance;
}`,
    b: `function createUser(name, email) {
  return { id: uuid(), name, email, createdAt: Date.now() };
}`,
  },
  {
    label: 'debounce vs throttle (similar shape, different timing)',
    a: `function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}`,
    b: `function throttle(fn, ms) {
  let last = 0;
  return (...a) => { if (Date.now() - last > ms) { last = Date.now(); fn(...a); } };
}`,
  },
  {
    label: 'URL parsing vs CSV parsing',
    a: `const url = new URL(href);
return url.hostname;`,
    b: `return line.split(",").map(s => s.trim());`,
  },
  {
    label: 'group by vs filter',
    a: `const groups = {};
for (const item of items) {
  (groups[item.category] ||= []).push(item);
}`,
    b: `return items.filter(item => item.active);`,
  },
  {
    label: 'retry vs rate limit',
    a: `async function retry(fn, n) {
  for (let i = 0; i < n; i++) {
    try { return await fn(); } catch { await sleep(100); }
  }
}`,
    b: `async function rateLimited(fn) {
  const now = Date.now();
  if (now - lastCall < 1000) throw new Error("too fast");
  lastCall = now;
  return await fn();
}`,
  },
  {
    label: 'render template vs send email',
    a: `return template.replace(/\\{(\\w+)\\}/g, (_, k) => data[k]);`,
    b: `await transport.sendMail({ to, subject, html });`,
  },
];

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

async function scorePairs(pairs: Pair[]): Promise<Array<{ label: string; score: number }>> {
  const out: Array<{ label: string; score: number }> = [];
  for (const p of pairs) {
    const [ea, eb] = await Promise.all([generateEmbedding(p.a), generateEmbedding(p.b)]);
    out.push({ label: p.label, score: cosine(ea, eb) });
  }
  return out;
}

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

async function main(): Promise<void> {
  const model = getActiveEmbeddingModel();
  console.error(`\n=== Embedding recall micro-bench ===`);
  console.error(`Model:  ${model.hfId}`);
  console.error(`Dim:    ${model.dim}`);
  console.error(`Desc:   ${model.description}\n`);

  console.error('Scoring SIMILAR pairs (should be HIGH)...');
  const sim = await scorePairs(SIMILAR);
  for (const r of sim) console.error(`  ${r.score.toFixed(3)}  ${r.label}`);

  console.error('\nScoring DIFFERENT pairs (should be LOW)...');
  const diff = await scorePairs(DIFFERENT);
  for (const r of diff) console.error(`  ${r.score.toFixed(3)}  ${r.label}`);

  const simMean = mean(sim.map((r) => r.score));
  const diffMean = mean(diff.map((r) => r.score));
  const discrimination = simMean - diffMean;

  console.error('\n=== Summary ===');
  console.error(`Avg SIMILAR    : ${simMean.toFixed(3)}  (higher = better, target ≥0.60)`);
  console.error(`Avg DIFFERENT  : ${diffMean.toFixed(3)}  (lower = better, target ≤0.40)`);
  console.error(`Discrimination : ${discrimination.toFixed(3)}  (higher = better, target ≥0.20)`);
  console.error('');

  // Machine-readable JSON for downstream comparison scripts.
  console.log(JSON.stringify({
    model: model.hfId,
    dim: model.dim,
    simMean,
    diffMean,
    discrimination,
    similar: sim,
    different: diff,
  }, null, 2));
}

main().catch((err) => {
  console.error('Micro-bench failed:', err);
  process.exit(1);
});
