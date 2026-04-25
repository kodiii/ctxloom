import { useState, useEffect } from 'react';
import { SparklineCard } from '../components/SparklineCard.js';
import { TrendsRangePicker } from '../components/TrendsRangePicker.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import type { TrendsResponse } from '../../../server/types.js';
import type { TrendSnapshot } from '@ctxloom/core';

type Range = '7d' | '30d' | '90d';

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: TrendsResponse };

function fmtCount(n: number): string { return String(Math.round(n)); }
function fmtBus(n: number): string { return n.toFixed(1); }
function fmtChurn(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function pick(snapshots: TrendSnapshot[], key: keyof TrendSnapshot) {
  return snapshots.map(s => ({ t: s.unixSeconds, v: (s[key] ?? null) as number | null }));
}

function lastNonNull(snapshots: TrendSnapshot[], key: keyof TrendSnapshot): number | null {
  for (let i = snapshots.length - 1; i >= 0; i--) {
    const v = snapshots[i][key];
    if (typeof v === 'number') return v;
  }
  return null;
}

export function Trends() {
  const [range, setRange] = useState<Range>('30d');
  const [state, setState] = useState<FetchState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetch(`/api/trends?range=${range}`)
      .then(async r => {
        if (!r.ok) throw new Error(`API failed: ${r.status}`);
        return r.json() as Promise<TrendsResponse>;
      })
      .then(data => { if (!cancelled) setState({ status: 'success', data }); })
      .catch(err => { if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) }); });
    return () => { cancelled = true; };
  }, [range]);

  if (state.status === 'loading') return <div className="text-white/40 text-sm">Loading...</div>;
  if (state.status === 'error') return <ErrorBanner message={state.message} />;

  const { snapshots, gitEnabled } = state.data;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-white text-xl font-semibold">Trends</h1>
        <TrendsRangePicker value={range} onChange={setRange} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <SparklineCard
          label="Dead files"
          currentValue={lastNonNull(snapshots, 'deadFiles')}
          series={pick(snapshots, 'deadFiles')}
          goodDirection="down"
          format={fmtCount}
          gitEnabled={gitEnabled}
        />
        <SparklineCard
          label="Avg bus factor"
          currentValue={lastNonNull(snapshots, 'avgBusFactor')}
          series={pick(snapshots, 'avgBusFactor')}
          goodDirection="up"
          format={fmtBus}
          gitRequired
          gitEnabled={gitEnabled}
        />
        <SparklineCard
          label="High-risk files"
          currentValue={lastNonNull(snapshots, 'highRiskFiles')}
          series={pick(snapshots, 'highRiskFiles')}
          goodDirection="down"
          format={fmtCount}
          gitRequired
          gitEnabled={gitEnabled}
        />
        <SparklineCard
          label="Churn lines / week"
          currentValue={lastNonNull(snapshots, 'churnLinesLast7d')}
          series={pick(snapshots, 'churnLinesLast7d')}
          goodDirection="down"
          format={fmtChurn}
          gitRequired
          gitEnabled={gitEnabled}
        />
      </div>
    </div>
  );
}
