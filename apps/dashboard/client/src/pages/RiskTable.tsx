import { useState } from 'react';
import { useApi } from '../hooks/useApi.ts';
import { api } from '../lib/api.ts';
import { RiskBadge } from '../components/RiskBadge.tsx';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import { FileDrawer } from '../components/FileDrawer.tsx';
import type { RiskEntry } from '../../../server/types.js';

type SortKey = keyof Pick<RiskEntry, 'riskScore' | 'churnLines' | 'busFactor' | 'couplingFanOut' | 'bugDensity'>;

export function RiskTable() {
  const state = useApi(api.risk);
  const [sort, setSort] = useState<SortKey>('riskScore');
  const [filter, setFilter] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  if (state.status === 'loading') return <div className="text-white/40 text-sm">Loading...</div>;
  if (state.status === 'error') return <ErrorBanner message={state.message} />;

  const { entries, overallRiskScore } = state.data;

  if (entries.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-white text-xl font-semibold">Risk</h1>
        <p className="text-white/40 text-sm">
          No git history available. Run <code className="text-[#a78bfa]">ctxloom index --with-git</code> to enable risk analysis.
        </p>
      </div>
    );
  }

  const filtered = entries
    .filter(e => e.file.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => b[sort] - a[sort]);

  const cols: { key: SortKey; label: string }[] = [
    { key: 'riskScore', label: 'Risk' },
    { key: 'churnLines', label: 'Churn lines' },
    { key: 'busFactor', label: 'Bus factor' },
    { key: 'couplingFanOut', label: 'Coupling' },
    { key: 'bugDensity', label: 'Bug density' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-white text-xl font-semibold">Risk</h1>
        <span className="text-sm text-white/40">avg score: {overallRiskScore}</span>
      </div>

      <input
        type="text"
        placeholder="Filter by file..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
        className="w-full rounded-md border border-white/10 bg-[#1e1d2a] px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:ring-2 focus:ring-[#603dc6]/50 focus:border-[#603dc6]/50"
      />

      <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#1e1d2a]">
        <table className="min-w-full text-sm">
          <thead className="border-b border-white/10 bg-[#131220]">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-white/40">File</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Owner</th>
              {cols.map(c => (
                <th
                  key={c.key}
                  onClick={() => setSort(c.key)}
                  className={`px-4 py-3 text-left text-xs font-medium cursor-pointer select-none ${sort === c.key ? 'text-[#a78bfa]' : 'text-white/40'}`}
                >
                  {c.label} {sort === c.key ? '↓' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgba(255,255,255,0.05)]">
            {filtered.map(e => (
              <tr key={e.file} className="hover:bg-white/5">
                <td
                  className="px-4 py-3 font-mono text-xs text-white/60 max-w-xs truncate cursor-pointer hover:text-[#a78bfa] transition-colors"
                  title={e.file}
                  onClick={() => setSelectedFile(e.file)}
                >
                  {e.file}
                </td>
                <td className="px-4 py-3 text-xs text-white/50">{e.topOwner ?? '—'}</td>
                <td className="px-4 py-3"><RiskBadge level={e.riskLabel} /></td>
                <td className="px-4 py-3 text-white/70">{e.churnLines.toLocaleString()}</td>
                <td className="px-4 py-3 text-white/70">{e.busFactor}</td>
                <td className="px-4 py-3 text-white/70">{e.couplingFanOut}</td>
                <td className="px-4 py-3 text-white/70">{e.bugDensity.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <FileDrawer file={selectedFile} onClose={() => setSelectedFile(null)} />
    </div>
  );
}
