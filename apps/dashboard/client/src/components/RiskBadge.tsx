import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RiskBreakdown } from '../../../server/types.js';

const COLOURS: Record<string, string> = {
  critical: 'bg-red-900/50 text-red-300 font-semibold',
  high: 'bg-orange-900/50 text-orange-300',
  medium: 'bg-yellow-900/50 text-yellow-300',
  low: 'bg-green-900/50 text-green-300',
};

const WEIGHTS = { churn: 0.4, bugDensity: 0.3, coupling: 0.3 } as const;

const LABELS: Record<keyof RiskBreakdown, string> = {
  churn: 'Churn',
  bugDensity: 'Bug density',
  coupling: 'Coupling',
};

const EXPLANATIONS: Record<string, string> = {
  critical: 'Top 5% by intrinsic risk in this repo. Prioritise refactor or test coverage.',
  high: 'Next 10% — meaningful intrinsic risk. Review when touching this area.',
  medium: 'Next 20% — moderate intrinsic risk. Worth keeping an eye on.',
  low: 'Bottom 65% — healthy file by intrinsic risk metrics.',
};

interface RiskBadgeProps {
  level: string;
  breakdown?: RiskBreakdown;
  score?: number;
  busFactor?: number;
  topOwner?: string | null;
  siloed?: boolean;
}

const TOOLTIP_W = 296;
const TOOLTIP_H_ESTIMATE = 230;
const GAP = 8;

export function RiskBadge({ level, breakdown, score, busFactor, topOwner, siloed }: RiskBadgeProps) {
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
            Intrinsic risk contribution
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

          {(typeof busFactor === 'number' || topOwner) && (
            <>
              <div className="text-white/40 text-[10px] uppercase tracking-wide mt-3 mb-1">
                Ownership <span className="text-white/30 normal-case">(not in score)</span>
              </div>
              <div className="text-white/60 leading-relaxed">
                {topOwner && <>Owner: <span className="text-white/80">{topOwner}</span><br /></>}
                {typeof busFactor === 'number' && (
                  <>
                    Bus factor: <span className="text-white/80">{busFactor}</span>
                    {siloed && <span className="text-yellow-300/80"> · knowledge silo</span>}
                  </>
                )}
              </div>
            </>
          )}

          <div className="mt-3 text-[10px] text-white/30 leading-relaxed">
            Score: 40% churn + 30% bugs + 30% coupling, normalized to repo p90.
            Labels are percentile-banded (top 5% critical, next 10% high, next 20% medium).
          </div>
        </div>
      )}
    </>
  );
}
