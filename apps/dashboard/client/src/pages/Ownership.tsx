import { useState } from 'react';
import { useApi } from '../hooks/useApi.ts';
import { api } from '../lib/api.ts';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import { FileDrawer } from '../components/FileDrawer.tsx';

export function Ownership() {
  const state = useApi(api.ownership);
  const [filter, setFilter] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  if (state.status === 'loading') return <div className="text-white/40 text-sm">Loading...</div>;
  if (state.status === 'error') return <ErrorBanner message={state.message} />;

  const { entries, totalAuthors } = state.data;

  if (entries.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-white text-xl font-semibold">Ownership</h1>
        <p className="text-white/40 text-sm">
          No git history available. Run <code className="text-[#a78bfa]">ctxloom index --with-git</code> to enable ownership analysis.
        </p>
      </div>
    );
  }

  const filtered = entries.filter(
    e =>
      e.file.toLowerCase().includes(filter.toLowerCase()) ||
      e.primaryOwner.toLowerCase().includes(filter.toLowerCase())
  );

  const busFactor1 = entries.filter(e => e.busFactor === 1).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-white text-xl font-semibold">Ownership</h1>
        <span className="text-sm text-white/40">{totalAuthors} authors · {busFactor1} single-owner files</span>
      </div>

      {busFactor1 > 0 && (
        <div className="bg-yellow-900/20 border border-yellow-500/30 text-yellow-300 rounded-lg p-3 text-sm">
          ⚠ {busFactor1} files have only one contributor — bus factor risk.
        </div>
      )}

      <input
        type="text"
        placeholder="Filter by file or owner..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
        className="w-full rounded-md border border-white/10 bg-[#1e1d2a] px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:ring-2 focus:ring-[#603dc6]/50 focus:border-[#603dc6]/50"
      />

      <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#1e1d2a]">
        <table className="min-w-full text-sm">
          <thead className="border-b border-white/10 bg-[#131220]">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-white/40">File</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Primary owner</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Share</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Contributors</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgba(255,255,255,0.05)]">
            {filtered.map(e => (
              <tr key={e.file} className={`hover:bg-white/5 ${e.busFactor === 1 ? 'bg-yellow-900/10' : ''}`}>
                <td
                  className="px-4 py-3 font-mono text-xs text-white/60 max-w-xs truncate cursor-pointer hover:text-[#a78bfa] transition-colors"
                  title={e.file}
                  onClick={() => setSelectedFile(e.file)}
                >
                  {e.file}
                </td>
                <td className="px-4 py-3 text-xs text-white/70">{e.primaryOwner}</td>
                <td className="px-4 py-3 text-xs text-white/50">{Math.round(e.primaryShare * 100)}%</td>
                <td className="px-4 py-3 text-xs text-white/50">
                  {e.busFactor === 1
                    ? <span className="text-yellow-400 font-medium">sole owner</span>
                    : e.busFactor
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <FileDrawer file={selectedFile} onClose={() => setSelectedFile(null)} />
    </div>
  );
}
