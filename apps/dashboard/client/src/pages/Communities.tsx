import { useState } from 'react';
import { useApi } from '../hooks/useApi.ts';
import { api } from '../lib/api.ts';
import { ErrorBanner } from '../components/ErrorBanner.tsx';

export function Communities() {
  const state = useApi(api.communities);
  const [expanded, setExpanded] = useState<number | null>(null);

  if (state.status === 'loading') return <div className="text-gray-400 text-sm">Loading...</div>;
  if (state.status === 'error') return <ErrorBanner message={state.message} />;

  const { communities, totalFiles, totalEdges } = state.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Communities</h1>
        <span className="text-sm text-gray-400">
          {communities.length} clusters · {totalFiles} files · {totalEdges} edges
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {communities.map(c => (
          <div key={c.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <button
              className="w-full flex items-center justify-between text-left"
              onClick={() => setExpanded(expanded === c.id ? null : c.id)}
            >
              <div>
                <span className="text-sm font-medium text-gray-800">{c.name}</span>
                <span className="ml-2 text-xs text-gray-400">{c.size} files</span>
              </div>
              <span className="text-gray-400 text-xs">{expanded === c.id ? '▲' : '▼'}</span>
            </button>

            {expanded === c.id && (
              <ul className="mt-3 space-y-1 border-t border-gray-100 pt-3">
                {c.files.map(f => (
                  <li key={f} className="font-mono text-xs text-gray-500 truncate" title={f}>{f}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
