import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import { computeDelta, type DeltaTone } from '../lib/trendDelta.js';

interface SeriesPoint {
  t: number;
  v: number | null;
}

interface SparklineCardProps {
  label: string;
  currentValue: number | null;
  series: SeriesPoint[];
  goodDirection: 'up' | 'down';
  format: (v: number) => string;
  gitRequired?: boolean;
  gitEnabled: boolean;
}

const TONE_COLOR: Record<DeltaTone, string> = {
  good: '#22c55e',
  bad: '#ef4444',
  neutral: '#a1a1aa',
};

const STROKE_COLOR = '#a78bfa';

export function SparklineCard({
  label,
  currentValue,
  series,
  goodDirection,
  format,
  gitRequired = false,
  gitEnabled,
}: SparklineCardProps) {
  if (gitRequired && !gitEnabled) {
    return (
      <div className="bg-[#1e1d2a] border border-white/10 rounded-xl p-5">
        <h2 className="text-white/40 text-xs uppercase tracking-wider mb-2">{label}</h2>
        <p className="text-white/30 text-sm">Git history disabled</p>
      </div>
    );
  }

  const numericPoints = series.filter(p => typeof p.v === 'number') as Array<{ t: number; v: number }>;

  if (numericPoints.length < 2 || currentValue === null) {
    return (
      <div className="bg-[#1e1d2a] border border-white/10 rounded-xl p-5">
        <h2 className="text-white/40 text-xs uppercase tracking-wider mb-2">{label}</h2>
        <p className="text-white/30 text-sm">Collecting data — edit some files or run <code className="text-white/50">ctxloom index</code></p>
      </div>
    );
  }

  const earliest = numericPoints[0].v;
  const latest = numericPoints[numericPoints.length - 1].v;
  const delta = computeDelta(earliest, latest, goodDirection);

  return (
    <div className="bg-[#1e1d2a] border border-white/10 rounded-xl p-5">
      <h2 className="text-white/40 text-xs uppercase tracking-wider mb-2">{label}</h2>
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-white text-2xl font-semibold">{format(currentValue)}</span>
        <span className="text-xs font-medium" style={{ color: TONE_COLOR[delta.tone] }}>
          {delta.label}
        </span>
      </div>
      <div className="h-12">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={numericPoints} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <YAxis hide domain={['auto', 'auto']} />
            <Line
              type="monotone"
              dataKey="v"
              stroke={STROKE_COLOR}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
