import { useState } from 'react';
import { useApi } from '../hooks/useApi.ts';
import { api } from '../lib/api.ts';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import { FileDrawer } from '../components/FileDrawer.tsx';

export function Communities() {
  const state = useApi(api.communities);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  if (state.status === 'loading') return <div className="text-white/40 text-sm">Loading...</div>;
  if (state.status === 'error') return <ErrorBanner message={state.message} />;

  const { communities, totalFiles, totalEdges } = state.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-white text-xl font-semibold">Communities</h1>
        <span className="text-sm text-white/40">
          {communities.length} clusters · {totalFiles} files · {totalEdges} edges
        </span>
      </div>

      {/* `items-start` so an expanded card on the left doesn't push its
          right-side neighbour to the same height — each card keeps its
          natural intrinsic size. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 items-start">
        {communities.map(c => (
          <div key={c.id} className="bg-[#1e1d2a] border border-white/10 rounded-xl p-4 transition-colors hover:border-white/20">
            <button
              className="w-full flex items-center justify-between text-left"
              onClick={() => setExpanded(expanded === c.id ? null : c.id)}
            >
              <div>
                <span className="text-white/80 text-sm font-medium">{c.name}</span>
                <span className="ml-2 text-xs text-white/40">{c.size} files</span>
              </div>
              <span className="text-white/30 text-xs">{expanded === c.id ? '▲' : '▼'}</span>
            </button>

            {expanded === c.id && (
              <ul className="mt-3 space-y-1 border-t border-white/10 pt-3">
                {c.files.map(f => (
                  <li
                    key={f}
                    className="font-mono text-xs text-white/40 truncate cursor-pointer hover:text-[#a78bfa] transition-colors"
                    title={f}
                    onClick={() => setSelectedFile(f)}
                  >
                    {f}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <FileDrawer file={selectedFile} onClose={() => setSelectedFile(null)} />
    </div>
  );
}
