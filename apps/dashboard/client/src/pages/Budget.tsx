/**
 * Budget page — visual surface for `~/.ctxloom/telemetry/budget-events-*.jsonl`.
 *
 * Mirrors the CLI's `ctxloom budget-stats` output (same aggregation
 * via `summarizeBudgetEvents()` from @ctxloom/core) plus a per-day
 * sparkline the CLI can't render.
 *
 * Window selector defaults to 14d (matches the CLI default). Optional
 * tool filter narrows aggregation to a single tool (matches the
 * --tool=<name> CLI flag).
 *
 * Empty-state: when no budget events exist in the window, surfaces
 * the env-var hint to enable telemetry (CTXLOOM_TELEMETRY_LEVEL=full).
 * This is the most common landing-page state for users who haven't
 * opted in yet — calling out the env var is the only useful CTA.
 */
import { useState, useMemo } from 'react';
import { useApi } from '../hooks/useApi.ts';
import { api, type BudgetEventsResponse } from '../lib/api.ts';
import { ErrorBanner } from '../components/ErrorBanner.tsx';

const WINDOW_OPTIONS = ['1d', '7d', '14d', '30d'] as const;
type WindowOption = (typeof WINDOW_OPTIONS)[number];

function fmtNum(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}

function fmtPct(pct: number): string {
  return `${Math.round(pct)}%`;
}

/**
 * Render the per-day breach sparkline. Reuses the dashboard's
 * existing SVG-sparkline aesthetic from SparklineCard but keeps the
 * shape simple (single series, daily resolution). Empty windows
 * render a flat baseline so the section doesn't pop in/out.
 */
function BreachSparkline({ data }: { data: ReadonlyArray<{ day: string; count: number }> }) {
  if (data.length === 0) {
    return <div className="text-xs text-white/30">No breaches in window.</div>;
  }
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const w = 600;
  const h = 60;
  const stepX = data.length > 1 ? w / (data.length - 1) : 0;
  const pts = data.map((d, i) => {
    const x = i * stepX;
    const y = h - (d.count / maxCount) * (h - 4) - 2;
    return `${x},${y}`;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16">
      <polyline
        fill="none"
        stroke="#a78bfa"
        strokeWidth="2"
        points={pts.join(' ')}
      />
      {data.map((d, i) => (
        <circle
          key={d.day}
          cx={i * stepX}
          cy={h - (d.count / maxCount) * (h - 4) - 2}
          r={3}
          fill="#a78bfa"
        >
          <title>{`${d.day}: ${d.count} breach${d.count === 1 ? '' : 'es'}`}</title>
        </circle>
      ))}
    </svg>
  );
}

export function Budget() {
  const [windowOpt, setWindowOpt] = useState<WindowOption>('14d');
  const [toolFilter, setToolFilter] = useState<string>('');

  // Defer the fetch until the user submits the form OR on initial
  // mount with default args. Empty filter string = no filter.
  const fetcher = useMemo(
    () => () => api.budgetEvents(windowOpt, toolFilter.trim() || undefined),
    [windowOpt, toolFilter],
  );
  const state = useApi<BudgetEventsResponse>(fetcher);

  if (state.status === 'loading') {
    return <div className="text-white/40 text-sm">Loading…</div>;
  }
  if (state.status === 'error') {
    return <ErrorBanner message={state.message} />;
  }

  const { window, totalEvents, fallbackTable, distributionTable, breachesPerDay } = state.data;

  return (
    <div className="space-y-6">
      {/* ── Header + filters ──────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-white text-xl font-semibold">Budget events</h1>
          <p className="text-xs text-white/40 mt-1">
            Aggregated <code className="font-mono">mcp.budget.exceeded</code> and{' '}
            <code className="font-mono">mcp.fallback.used</code> events from{' '}
            <code className="font-mono">~/.ctxloom/telemetry/</code>. Same source as the{' '}
            <code className="font-mono">ctxloom budget-stats</code> CLI.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-white/60 flex items-center gap-2">
            Window:
            <select
              value={windowOpt}
              onChange={(e) => setWindowOpt(e.target.value as WindowOption)}
              className="bg-[#1e1d2a] border border-white/10 rounded px-2 py-1 text-sm text-white"
            >
              {WINDOW_OPTIONS.map((w) => (
                <option key={w} value={w}>
                  Last {w}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-white/60 flex items-center gap-2">
            Tool:
            <input
              type="text"
              placeholder="all"
              value={toolFilter}
              onChange={(e) => setToolFilter(e.target.value)}
              className="bg-[#1e1d2a] border border-white/10 rounded px-2 py-1 text-sm text-white font-mono w-40"
            />
          </label>
        </div>
      </div>

      {/* ── Empty state ──────────────────────────────────────────── */}
      {totalEvents === 0 && (
        <div className="rounded-xl border border-white/10 bg-[#1e1d2a] p-6">
          <h2 className="text-white text-sm font-medium mb-2">No events in window</h2>
          <p className="text-xs text-white/60 leading-relaxed">
            ctxloom emits <code className="font-mono">mcp.budget.exceeded</code> /{' '}
            <code className="font-mono">mcp.fallback.used</code> events only when an MCP tool's response exceeds the caller's{' '}
            <code className="font-mono">max_response_tokens</code>. To opt in,{' '}
            <strong>set</strong> <code className="font-mono">CTXLOOM_TELEMETRY_LEVEL=full</code> in your MCP server environment.
          </p>
          <p className="text-xs text-white/40 mt-3">
            Window: {window.since.slice(0, 10)} → {window.until.slice(0, 10)} ({window.days} days).
          </p>
        </div>
      )}

      {/* ── Sparkline ────────────────────────────────────────────── */}
      {totalEvents > 0 && (
        <div className="rounded-xl border border-white/10 bg-[#1e1d2a] p-4">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-white text-sm font-medium">Breaches per day</h2>
            <span className="text-xs text-white/40">
              {totalEvents} total events · {window.since.slice(0, 10)} → {window.until.slice(0, 10)}
            </span>
          </div>
          <BreachSparkline data={breachesPerDay} />
        </div>
      )}

      {/* ── Fallback distribution table ──────────────────────────── */}
      {fallbackTable.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-[#1e1d2a] overflow-hidden">
          <div className="border-b border-white/10 px-4 py-3">
            <h2 className="text-white text-sm font-medium">Fallback distribution per tool</h2>
            <p className="text-xs text-white/40 mt-0.5">
              How each tool's over-budget responses landed: skeleton, truncate, or error.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-white/5">
              <tr>
                <th className="text-left px-4 py-2 text-white/60 font-medium">Tool</th>
                <th className="text-right px-4 py-2 text-white/60 font-medium">Breaches</th>
                <th className="text-right px-4 py-2 text-white/60 font-medium">Skeleton</th>
                <th className="text-right px-4 py-2 text-white/60 font-medium">Truncate</th>
                <th className="text-right px-4 py-2 text-white/60 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {fallbackTable.map((row) => (
                <tr key={row.tool} className="border-t border-white/5">
                  <td className="px-4 py-2 font-mono text-xs text-white/80">{row.tool}</td>
                  <td className="px-4 py-2 text-right text-white/80">{row.breaches}</td>
                  <td className="px-4 py-2 text-right text-white/60">{fmtPct(row.skeletonPct)}</td>
                  <td className="px-4 py-2 text-right text-white/60">{fmtPct(row.truncatePct)}</td>
                  <td className="px-4 py-2 text-right text-white/60">{fmtPct(row.errorPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Original-token distribution table ────────────────────── */}
      {distributionTable.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-[#1e1d2a] overflow-hidden">
          <div className="border-b border-white/10 px-4 py-3">
            <h2 className="text-white text-sm font-medium">Original-token distribution per tool</h2>
            <p className="text-xs text-white/40 mt-0.5">
              Token-count spread of over-budget calls. The <strong>p75</strong> column is the suggested next{' '}
              <code className="font-mono">DEFAULT_MAX_RESPONSE_TOKENS</code> value (75% of real-world calls
              would fit under it).
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-white/5">
              <tr>
                <th className="text-left px-4 py-2 text-white/60 font-medium">Tool</th>
                <th className="text-right px-4 py-2 text-white/60 font-medium">n</th>
                <th className="text-right px-4 py-2 text-white/60 font-medium">min</th>
                <th className="text-right px-4 py-2 text-white/60 font-medium">p50</th>
                <th className="text-right px-4 py-2 text-white/60 font-medium" style={{ color: '#a78bfa' }}>p75</th>
                <th className="text-right px-4 py-2 text-white/60 font-medium">p95</th>
                <th className="text-right px-4 py-2 text-white/60 font-medium">max</th>
              </tr>
            </thead>
            <tbody>
              {distributionTable.map((row) => (
                <tr key={row.tool} className="border-t border-white/5">
                  <td className="px-4 py-2 font-mono text-xs text-white/80">{row.tool}</td>
                  <td className="px-4 py-2 text-right text-white/80">{row.n}</td>
                  <td className="px-4 py-2 text-right text-white/60">{fmtNum(row.min)}</td>
                  <td className="px-4 py-2 text-right text-white/60">{fmtNum(row.p50)}</td>
                  <td className="px-4 py-2 text-right" style={{ color: '#a78bfa' }}>{fmtNum(row.p75)}</td>
                  <td className="px-4 py-2 text-right text-white/60">{fmtNum(row.p95)}</td>
                  <td className="px-4 py-2 text-right text-white/60">{fmtNum(row.max)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
