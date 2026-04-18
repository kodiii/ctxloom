const COLOURS: Record<string, string> = {
  critical: 'bg-red-900/50 text-red-300 font-semibold',
  high: 'bg-orange-900/50 text-orange-300',
  medium: 'bg-yellow-900/50 text-yellow-300',
  low: 'bg-green-900/50 text-green-300',
};

export function RiskBadge({ level }: { level: string }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs ${COLOURS[level] ?? 'bg-white/10 text-white/50'}`}>
      {level}
    </span>
  );
}
