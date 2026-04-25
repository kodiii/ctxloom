export type DeltaTone = 'good' | 'bad' | 'neutral';

export interface DeltaResult {
  label: string;
  tone: DeltaTone;
}

export function computeDelta(
  earliest: number,
  latest: number,
  goodDirection: 'up' | 'down',
): DeltaResult {
  if (earliest === 0) {
    if (latest === 0) return { label: '→ stable', tone: 'neutral' };
    const rising = latest > 0;
    const isGood = (goodDirection === 'up') === rising;
    return { label: '↑ new', tone: isGood ? 'good' : 'bad' };
  }
  const pct = (latest - earliest) / earliest;
  const absPct = Math.abs(pct);
  if (absPct < 0.01) return { label: '→ stable', tone: 'neutral' };
  const arrow = pct > 0 ? '↑' : '↓';
  const rising = pct > 0;
  const isGood = (goodDirection === 'up') === rising;
  return {
    label: `${arrow} ${(absPct * 100).toFixed(0)}%`,
    tone: isGood ? 'good' : 'bad',
  };
}
