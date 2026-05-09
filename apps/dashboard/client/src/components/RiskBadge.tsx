import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RiskBreakdown } from '../../../server/types.js';

const COLOURS: Record<string, string> = {
  critical: 'bg-red-900/50 text-red-300 font-semibold',
  high: 'bg-orange-900/50 text-orange-300',
  medium: 'bg-yellow-900/50 text-yellow-300',
  low: 'bg-green-900/50 text-green-300',
};

const WEIGHTS = { churn: 0.2, bugDensity: 0.2, busFactor: 0.4, coupling: 0.2 } as const;

const LABELS: Record<keyof RiskBreakdown, string> = {
  busFactor: 'Bus factor',
  churn: 'Churn',
  bugDensity: 'Bug density',
  coupling: 'Coupling',
};

const EXPLANATIONS: Record<string, string> = {
  critical: 'Score > 0.80 — top operational risk; prioritise refactor or knowledge-share.',
  high: 'Score > 0.60 — meaningful risk; review when touching this area.',
  medium: 'Score > 0.30 — moderate risk; keep an eye on it.',
  low: 'Score ≤ 0.30 — healthy file.',
};

interface RiskBadgeProps {
  level: string;
  breakdown?: RiskBreakdown;
  score?: number;
}

const TOOLTIP_W = 288;
const TOOLTIP_H_ESTIMATE = 200;
const GAP = 8;

export function RiskBadge({ level, breakdown, score }: RiskBadgeProps) {
  const colour = COLOURS[level] ?? 'bg-white/10 text-white/50';

  if (!breakdown) {
    return (
      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs ${colour}`}>
        {level}
      </span>
    );
  }

  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const flipUp = r.bottom + TOOLTIP_H_ESTIMATE + GAP > window.innerHeight;
    const top = flipUp ? r.top - TOOLTIP_H_ESTIMATE - GAP : r.bottom + GAP;
    const left = Math.max(8, Math.min(window.innerWidth - TOOLTIP_W - 8, r.left));
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!pinned) return;
    const onClickOutside = (e: MouseEvent) => {
      if (!triggerRef.current) return;
      const target = e.target as Node;
      if (triggerRef.current.contains(target)) return;
      const tooltip = document.getElementById('risk-badge-tooltip');
      if (tooltip && tooltip.contains(target)) return;
      setPinned(false);
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPinned(false);
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [pinned]);

  const contributions = (Object.keys(WEIGHTS) as (keyof RiskBreakdown)[])
    .map(key => ({
      key,
      label: LABELS[key],
      normalized: breakdown[key],
      contribution: breakdown[key] * WEIGHTS[key],
    }))
    .sort((a, b) => b.contribution - a.contribution);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-describedby={open ? 'risk-badge-tooltip' : undefined}
        className={`inline-block rounded-full px-2.5 py-0.5 text-xs cursor-pointer ${colour}`}
        onMouseEnter={() => !pinned && setOpen(true)}
        onMouseLeave={() => !pinned && setOpen(false)}
        onFocus={() => !pinned && setOpen(true)}
        onBlur={() => !pinned && setOpen(false)}
        onClick={(e) => {
          e.stopPropagation();
          if (pinned) {
            setPinned(false);
            setOpen(false);
          } else {
            setPinned(true);
            setOpen(true);
          }
        }}
      >
        {level}
      </button>
      {open && pos && (
        <div
          id="risk-badge-tooltip"
          role="tooltip"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: TOOLTIP_W }}
          className="z-50 rounded-lg border border-white/10 bg-[#131220] p-3 text-left text-xs shadow-xl"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-white font-medium">
              {level} {typeof score === 'number' && <span className="text-white/40 font-normal">({score.toFixed(2)})</span>}
            </span>
            {pinned && (
              <span className="text-[10px] text-white/40">click to unpin · esc</span>
            )}
          </div>
          <div className="text-white/50 mb-2">{EXPLANATIONS[level] ?? ''}</div>
          <div className="text-white/40 text-[10px] uppercase tracking-wide mb-1">
            Contribution to score
          </div>
          <div className="space-y-1">
            {contributions.map(c => (
              <div key={c.key} className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-white/60">{c.label}</span>
                <span className="flex-1 h-1.5 rounded bg-white/5 overflow-hidden">
                  <span
                    className="block h-full bg-[#a78bfa]"
                    style={{ width: `${Math.round(c.normalized * 100)}%` }}
                  />
                </span>
                <span className="w-10 shrink-0 text-right text-white/50 tabular-nums">
                  +{c.contribution.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[10px] text-white/30">
            Weights: bus 40%, churn 20%, bugs 20%, coupling 20%. Churn & coupling normalized to repo p90.
          </div>
        </div>
      )}
    </>
  );
}
