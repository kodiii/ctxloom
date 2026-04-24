import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useApi } from '../hooks/useApi.ts';
import { api } from '../lib/api.ts';
import { StatCard } from '../components/StatCard.tsx';
import { RiskBadge } from '../components/RiskBadge.tsx';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

function useRelativeTime(iso: string | undefined) {
  const [label, setLabel] = useState('');
  useEffect(() => {
    if (!iso) return;
    function update() {
      const secs = Math.floor((Date.now() - new Date(iso!).getTime()) / 1000);
      if (secs < 60) setLabel(`${secs}s ago`);
      else if (secs < 3600) setLabel(`${Math.floor(secs / 60)}m ago`);
      else setLabel(`${Math.floor(secs / 3600)}h ago`);
    }
    update();
    const id = setInterval(update, 10_000);
    return () => clearInterval(id);
  }, [iso]);
  return label;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const RISK_COLOURS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
};

export function Overview() {
  const state = useApi(api.overview);
  const statusState = useApi(api.status);
  const tokenState = useApi(api.tokens);
  const [refreshing, setRefreshing] = useState(false);
  const [lastIndexed, setLastIndexed] = useState<string | undefined>();
  const timeLabel = useRelativeTime(lastIndexed);

  useEffect(() => {
    if (statusState.status === 'success') setLastIndexed(statusState.data.lastIndexed);
  }, [statusState]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const result = await api.refresh();
      if (result.ok) {
        setLastIndexed(result.lastIndexed);
        window.location.reload();
      }
    } finally {
      setRefreshing(false);
    }
  }

  if (state.status === 'loading') return <div className="text-white/40 text-sm">Loading...</div>;
  if (state.status === 'error') return <ErrorBanner message={state.message} />;

  const { data } = state;
  const riskData = Object.entries(data.risk).map(([name, value]) => ({ name, value }));

  const overviewTitle = (
    <div className="flex items-center justify-between">
      <h1 className="text-white text-xl font-semibold">Overview</h1>
      <div className="flex items-center gap-3">
        {timeLabel && (
          <span className="text-white/30 text-xs">indexed {timeLabel}</span>
        )}
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-[#603dc6]/20 text-[#a78bfa] hover:bg-[#603dc6]/30 transition-colors disabled:opacity-50"
        >
          {refreshing ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      {overviewTitle}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <NavLink to="/graph" className="cursor-pointer rounded-xl hover:ring-1 hover:ring-[#603dc6]/40">
          <StatCard label="Files" value={data.totalFiles} />
        </NavLink>
        <NavLink to="/graph" className="cursor-pointer rounded-xl hover:ring-1 hover:ring-[#603dc6]/40">
          <StatCard label="Edges" value={data.totalEdges} />
        </NavLink>
        <NavLink to="/communities" className="cursor-pointer rounded-xl hover:ring-1 hover:ring-[#603dc6]/40">
          <StatCard label="Communities" value={data.totalCommunities} />
        </NavLink>
        <NavLink to="/risk" className="cursor-pointer rounded-xl hover:ring-1 hover:ring-[#603dc6]/40">
          <StatCard label="Git history" value={data.gitEnabled ? 'enabled' : 'disabled'} />
        </NavLink>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="bg-[#1e1d2a] border border-white/10 rounded-xl p-5">
          <h2 className="text-white/50 text-xs uppercase tracking-wider mb-4">Risk breakdown</h2>
          <div className="flex items-center gap-6">
            <ResponsiveContainer width={140} height={140}>
              <PieChart style={{ background: 'transparent' }}>
                <Pie data={riskData} dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={60}>
                  {riskData.map(entry => (
                    <Cell key={entry.name} fill={RISK_COLOURS[entry.name] ?? '#ccc'} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: '#1e1d2a',
                    border: '1px solid rgba(255,255,255,0.10)',
                    borderRadius: '0.625rem',
                    color: '#fafafa',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2">
              {riskData.map(({ name, value }) => (
                <div key={name} className="flex items-center gap-2 text-sm">
                  <RiskBadge level={name} />
                  <span className="text-white/70">{value} files</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {tokenState.status === 'success' && (
          <div className="bg-[#1e1d2a] border border-white/10 rounded-xl p-5 lg:col-span-2">
            <h2 className="text-white/50 text-xs uppercase tracking-wider mb-4">Token consumption</h2>
            <div className="flex flex-col gap-4">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-white/50 text-xs mb-1">Actual tokens used (with skeletonization)</p>
                  <p className="text-white text-3xl font-semibold">{fmtTokens(tokenState.data.skeletonTokens)}</p>
                </div>
                <div className="text-right">
                  <p className="text-white/50 text-xs mb-1">Would have been (full files)</p>
                  <p className="text-white/60 text-3xl font-semibold line-through decoration-white/30">{fmtTokens(tokenState.data.fullTokens)}</p>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-white/40 text-xs">{fmtTokens(tokenState.data.savedTokens)} tokens saved</span>
                  <span className="text-[#a78bfa] text-sm font-semibold">{tokenState.data.reductionPercent}% reduction</span>
                </div>
                <div className="w-full bg-white/10 rounded-full h-2">
                  <div
                    className="bg-[#603dc6] h-2 rounded-full transition-all"
                    style={{ width: `${tokenState.data.reductionPercent}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-white/20 text-xs">0</span>
                  <span className="text-white/20 text-xs">100%</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="bg-[#1e1d2a] border border-white/10 rounded-xl p-5">
          <h2 className="text-white/50 text-xs uppercase tracking-wider mb-4">Top architectural hubs</h2>
          <ul className="space-y-2">
            {data.topHubs.slice(0, 8).map(hub => (
              <li key={hub.file} className="flex items-center justify-between text-sm">
                <span className="truncate text-white/80 max-w-[60%]" title={hub.file}>
                  {hub.file.split('/').pop()}
                </span>
                <span className="text-white/40 text-xs">
                  ↑{hub.inDegree} ↓{hub.outDegree}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
