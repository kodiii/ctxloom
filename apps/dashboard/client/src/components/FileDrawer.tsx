import { useEffect, useState } from 'react';

interface FileDrawerProps {
  file: string | null;
  onClose: () => void;
}

interface FileData {
  content: string;
  lines: number;
  ext: string;
}

export function FileDrawer({ file, onClose }: FileDrawerProps) {
  const [data, setData] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!file) { setData(null); return; }
    setLoading(true);
    fetch(`/api/file?path=${encodeURIComponent(file)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setData(d))
      .finally(() => setLoading(false));
  }, [file]);

  async function openInIde() {
    if (!file) return;
    setOpening(true);
    await fetch('/api/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: file }),
    });
    setOpening(false);
  }

  if (!file) return null;

  const filename = file.split('/').pop() ?? file;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />
      {/* Drawer */}
      <div
        className="fixed right-0 top-0 h-full w-[680px] max-w-full z-50 flex flex-col"
        style={{ background: '#131220', borderLeft: '1px solid rgba(255,255,255,0.07)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div className="min-w-0">
            <p className="text-white font-medium text-sm truncate">{filename}</p>
            <p className="text-white/30 text-xs font-mono truncate mt-0.5">{file}</p>
          </div>
          <div className="flex items-center gap-2 ml-4 shrink-0">
            <button
              onClick={openInIde}
              disabled={opening}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-[#603dc6]/20 text-[#a78bfa] hover:bg-[#603dc6]/30 transition-colors disabled:opacity-50"
            >
              {opening ? 'Opening\u2026' : '\u2197 Open in IDE'}
            </button>
            <button
              onClick={onClose}
              className="text-white/30 hover:text-white/70 transition-colors text-lg leading-none px-1"
            >
              \u2715
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="p-5 text-white/30 text-sm">Loading\u2026</div>
          )}
          {!loading && data && (
            <>
              <div
                className="px-5 py-2 text-white/20 text-xs"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
              >
                {data.lines} lines &middot; .{data.ext}
              </div>
              <pre className="p-5 text-xs font-mono text-white/70 leading-relaxed whitespace-pre overflow-x-auto">
                {data.content}
              </pre>
            </>
          )}
          {!loading && !data && (
            <div className="p-5 text-white/30 text-sm">Could not load file.</div>
          )}
        </div>
      </div>
    </>
  );
}
