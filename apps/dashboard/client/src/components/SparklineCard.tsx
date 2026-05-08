import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts';
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
  // Tone-colored line + area fill make the trajectory readable at a
  // glance without reading the delta label. Green when the metric is
  // moving the "good" direction, red when regressing, grey when flat.
  const lineColor = TONE_COLOR[delta.tone];
  const gradientId = `spark-grad-${label.replace(/[^a-zA-Z0-9]/g, '_')}`;

  return (
    <div className="bg-[#1e1d2a] border border-white/10 rounded-xl p-5">
      <h2 className="text-white/40 text-xs uppercase tracking-wider mb-2">{label}</h2>
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-white text-2xl font-semibold">{format(currentValue)}</span>
        <span className="text-xs font-medium" style={{ color: lineColor }}>
          {delta.label}
        </span>
      </div>
      <div className="h-14">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={numericPoints} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity={0.32} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={['auto', 'auto']} />
            <Area
              type="monotone"
              dataKey="v"
              stroke={lineColor}
              strokeWidth={1.75}
              fill={`url(#${gradientId})`}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
