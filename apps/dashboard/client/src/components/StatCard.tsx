interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
}

export function StatCard({ label, value, sub }: StatCardProps) {
  return (
    <div className="bg-[#1e1d2a] border border-white/10 rounded-xl p-5 transition-transform hover:-translate-y-0.5">
      <p className="text-white/50 text-xs uppercase tracking-wider">{label}</p>
      <p className="text-white text-3xl font-semibold mt-1">{value}</p>
      {sub && <p className="text-white/40 text-xs mt-1">{sub}</p>}
    </div>
  );
}
