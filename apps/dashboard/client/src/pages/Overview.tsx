import { useApi } from '../hooks/useApi.ts';
import { api } from '../lib/api.ts';
import { StatCard } from '../components/StatCard.tsx';
import { RiskBadge } from '../components/RiskBadge.tsx';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const RISK_COLOURS: Record<string, string> = {
  critical: '#dc2626',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
};

export function Overview() {
  const state = useApi(api.overview);

  if (state.status === 'loading') return <div className="text-gray-400 text-sm">Loading...</div>;
  if (state.status === 'error') return <ErrorBanner message={state.message} />;

  const { data } = state;
  const riskData = Object.entries(data.risk).map(([name, value]) => ({ name, value }));

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold text-gray-900">Overview</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Files" value={data.totalFiles} />
        <StatCard label="Edges" value={data.totalEdges} />
        <StatCard label="Communities" value={data.totalCommunities} />
        <StatCard label="Git history" value={data.gitEnabled ? 'enabled' : 'disabled'} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-medium text-gray-700 mb-4">Risk breakdown</h2>
          <div className="flex items-center gap-6">
            <ResponsiveContainer width={140} height={140}>
              <PieChart>
                <Pie data={riskData} dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={60}>
                  {riskData.map(entry => (
                    <Cell key={entry.name} fill={RISK_COLOURS[entry.name] ?? '#ccc'} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2">
              {riskData.map(({ name, value }) => (
                <div key={name} className="flex items-center gap-2 text-sm">
                  <RiskBadge level={name} />
                  <span className="text-gray-600">{value} files</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-medium text-gray-700 mb-4">Top architectural hubs</h2>
          <ul className="space-y-2">
            {data.topHubs.slice(0, 8).map(hub => (
              <li key={hub.file} className="flex items-center justify-between text-sm">
                <span className="truncate text-gray-700 max-w-[60%]" title={hub.file}>
                  {hub.file.split('/').pop()}
                </span>
                <span className="text-gray-400 text-xs">
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
