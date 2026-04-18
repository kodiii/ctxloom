import { useState } from 'react';
import { useApi } from '../hooks/useApi.ts';
import { api } from '../lib/api.ts';
import { ErrorBanner } from '../components/ErrorBanner.tsx';

export function Ownership() {
  const state = useApi(api.ownership);
  const [filter, setFilter] = useState('');

  if (state.status === 'loading') return <div className="text-gray-400 text-sm">Loading...</div>;
  if (state.status === 'error') return <ErrorBanner message={state.message} />;

  const { entries, totalAuthors } = state.data;

  if (entries.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-gray-900">Ownership</h1>
        <p className="text-gray-500 text-sm">
          No git history available. Run <code>ctxloom index --with-git</code> to enable ownership analysis.
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
        <h1 className="text-xl font-semibold text-gray-900">Ownership</h1>
        <span className="text-sm text-gray-400">{totalAuthors} authors · {busFactor1} single-owner files</span>
      </div>

      {busFactor1 > 0 && (
        <div className="rounded-md bg-yellow-50 border border-yellow-200 p-3 text-yellow-800 text-sm">
          ⚠ {busFactor1} files have only one contributor — bus factor risk.
        </div>
      )}

      <input
        type="text"
        placeholder="Filter by file or owner..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
        className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-300"
      />

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">File</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Primary owner</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Share</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Contributors</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map(e => (
              <tr key={e.file} className={`hover:bg-gray-50 ${e.busFactor === 1 ? 'bg-yellow-50/40' : ''}`}>
                <td className="px-4 py-3 font-mono text-xs text-gray-700 max-w-xs truncate" title={e.file}>{e.file}</td>
                <td className="px-4 py-3 text-xs text-gray-700">{e.primaryOwner}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{Math.round(e.primaryShare * 100)}%</td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  {e.busFactor === 1
                    ? <span className="text-yellow-600 font-medium">sole owner</span>
                    : e.busFactor
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
