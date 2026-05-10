import { useEffect, useState } from 'react';
import type { FileRiskTrendsResponse } from '../../../server/types.js';

const LABEL_COLOURS: Record<string, string> = {
  critical: '#fca5a5',
  high: '#fdba74',
  medium: '#fde68a',
  low: '#86efac',
};

interface Props {
  file: string;
}

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: FileRiskTrendsResponse };

const W = 240;
const H = 40;
const PAD = 2;

function fmtRelative(unixSeconds: number): string {
  const diffSec = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export function FileRiskSparkline({ file }: Props) {
  const [state, setState] = useState<FetchState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetch(`/api/trends/file?path=${encodeURIComponent(file)}&range=90d`)
      .then(async r => {
        if (!r.ok) throw new Error(`API failed: ${r.status}`);
        return r.json() as Promise<FileRiskTrendsResponse>;
      })
      .then(data => { if (!cancelled) setState({ status: 'success', data }); })
      .catch(err => {
        if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => { cancelled = true; };
  }, [file]);

  if (state.status === 'loading') {
    return <div className="text-white/30 text-xs">Loading risk history…</div>;
  }
  if (state.status === 'error') {
    return <div className="text-red-300/60 text-xs">Risk history failed: {state.message}</div>;
  }

  const { points, gitEnabled } = state.data;

  if (!gitEnabled) {
    return (
      <div className="text-white/40 text-xs">
        No git history available for this project.
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="text-white/40 text-xs leading-relaxed">
        No risk history yet for this file.<br />
        <span className="text-white/30">Records appear after a re-index when the file's score changes meaningfully.</span>
      </div>
    );
  }

  if (points.length === 1) {
    const p = points[0];
    return (
      <div className="text-white/60 text-xs">
        Single point: <span className="text-white/90 tabular-nums">{p.score.toFixed(2)}</span>
        <span className="text-white/30"> ({p.label}, {fmtRelative(p.unixSeconds)})</span>
      </div>
    );
  }

  const first = points[0];
  const last = points[points.length - 1];
  const delta = last.score - first.score;
  const deltaSign = delta > 0.005 ? '↑' : delta < -0.005 ? '↓' : '→';
  const deltaColour = delta > 0.005 ? 'text-red-300/80' : delta < -0.005 ? 'text-green-300/80' : 'text-white/40';

  const minScore = 0;
  const maxScore = 1;
  const xs = points.map(p => p.unixSeconds);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xRange = xMax - xMin || 1;
  const yRange = maxScore - minScore;

  const path = points
    .map((p, i) => {
      const x = PAD + ((p.unixSeconds - xMin) / xRange) * (W - PAD * 2);
      const y = H - PAD - ((p.score - minScore) / yRange) * (H - PAD * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-white/40 text-[10px] uppercase tracking-wide">Risk over time</span>
        <span className="text-white/30 text-[10px]">{points.length} points · last 90d</span>
      </div>
      <div className="flex items-center gap-3">
        <svg width={W} height={H} className="shrink-0">
          <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="rgba(255,255,255,0.05)" />
          <path d={path} fill="none" stroke="#a78bfa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((p, i) => {
            const x = PAD + ((p.unixSeconds - xMin) / xRange) * (W - PAD * 2);
            const y = H - PAD - ((p.score - minScore) / yRange) * (H - PAD * 2);
            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={2}
                fill={LABEL_COLOURS[p.label] ?? '#a78bfa'}
              >
                <title>
                  {p.label} ({p.score.toFixed(2)}) — {fmtRelative(p.unixSeconds)}
                </title>
              </circle>
            );
          })}
        </svg>
        <div className="text-xs leading-relaxed">
          <div className="text-white/60">
            <span className="text-white/90 tabular-nums">{last.score.toFixed(2)}</span>
            <span className="text-white/30"> · {last.label}</span>
          </div>
          <div className={`tabular-nums text-[11px] ${deltaColour}`}>
            {deltaSign} {delta >= 0 ? '+' : ''}{delta.toFixed(2)} <span className="text-white/30">since {fmtRelative(first.unixSeconds)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
