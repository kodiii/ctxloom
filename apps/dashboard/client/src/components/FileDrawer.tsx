import { useEffect, useState } from 'react';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import kotlin from 'react-syntax-highlighter/dist/esm/languages/prism/kotlin';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import ruby from 'react-syntax-highlighter/dist/esm/languages/prism/ruby';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';

// Register the language subset we expect to encounter in indexed
// repos. PrismLight only loads grammars we explicitly register, which
// keeps the bundle ~50KB rather than the ~600KB the full Prism build
// would pull in. Extensions that don't map to a registered grammar
// fall back to plain text (no syntax highlighting, but the file still
// renders cleanly).
import { FileRiskSparkline } from './FileRiskSparkline.js';

SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('css', css);
SyntaxHighlighter.registerLanguage('go', go);
SyntaxHighlighter.registerLanguage('java', java);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('kotlin', kotlin);
SyntaxHighlighter.registerLanguage('markdown', markdown);
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('ruby', ruby);
SyntaxHighlighter.registerLanguage('rust', rust);
SyntaxHighlighter.registerLanguage('sql', sql);
SyntaxHighlighter.registerLanguage('tsx', tsx);
SyntaxHighlighter.registerLanguage('yaml', yaml);

const EXT_TO_LANG: Record<string, string> = {
  ts: 'tsx', tsx: 'tsx', js: 'tsx', jsx: 'tsx', mjs: 'tsx', cjs: 'tsx',
  py: 'python', pyi: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin', kts: 'kotlin',
  rb: 'ruby',
  sql: 'sql',
  md: 'markdown', markdown: 'markdown',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  yml: 'yaml', yaml: 'yaml',
  json: 'json',
  css: 'css',
};

function languageFor(ext: string | undefined): string {
  if (!ext) return 'text';
  return EXT_TO_LANG[ext.toLowerCase()] ?? 'text';
}

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
              ✕
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
              <div
                className="px-5 py-3"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
              >
                <FileRiskSparkline file={file} />
              </div>
              <SyntaxHighlighter
                language={languageFor(data.ext)}
                style={vscDarkPlus}
                showLineNumbers
                wrapLongLines={false}
                customStyle={{
                  margin: 0,
                  padding: '20px',
                  background: 'transparent',
                  fontSize: '12px',
                  lineHeight: 1.55,
                }}
                lineNumberStyle={{
                  color: 'rgba(255,255,255,0.20)',
                  minWidth: '2em',
                  paddingRight: '1em',
                  userSelect: 'none',
                }}
                codeTagProps={{
                  style: {
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  },
                }}
              >
                {data.content}
              </SyntaxHighlighter>
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
