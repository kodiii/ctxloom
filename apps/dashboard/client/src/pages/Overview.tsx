import { NavLink } from 'react-router-dom';
import { useApi } from '../hooks/useApi.ts';
import { api } from '../lib/api.ts';
import { StatCard } from '../components/StatCard.tsx';
import { RiskBadge } from '../components/RiskBadge.tsx';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const RISK_COLOURS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
};

export function Overview() {
  const state = useApi(api.overview);

  if (state.status === 'loading') return <div className="text-white/40 text-sm">Loading...</div>;
  if (state.status === 'error') return <ErrorBanner message={state.message} />;

  const { data } = state;
  const riskData = Object.entries(data.risk).map(([name, value]) => ({ name, value }));

  return (
    <div className="space-y-8">
      <h1 className="text-white text-xl font-semibold">Overview</h1>

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
