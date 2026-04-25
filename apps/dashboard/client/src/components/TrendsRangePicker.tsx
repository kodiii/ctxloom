type Range = '7d' | '30d' | '90d';

interface TrendsRangePickerProps {
  value: Range;
  onChange: (next: Range) => void;
}

const OPTIONS: ReadonlyArray<{ value: Range; label: string }> = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
];

export function TrendsRangePicker({ value, onChange }: TrendsRangePickerProps) {
  return (
    <div className="inline-flex rounded-md bg-[#131220] border border-white/10 p-0.5">
      {OPTIONS.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={`px-3 py-1 text-xs font-medium rounded ${
            value === opt.value
              ? 'bg-[#603dc6]/20 text-[#a78bfa]'
              : 'text-white/40 hover:text-white/70'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
