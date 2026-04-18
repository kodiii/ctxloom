const COLOURS: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-green-100 text-green-700',
  critical: 'bg-red-200 text-red-900 font-bold',
};

export function RiskBadge({ level }: { level: string }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs ${COLOURS[level] ?? 'bg-gray-100 text-gray-600'}`}>
      {level}
    </span>
  );
}
