type Props = {
  current: number;
  total: number;
  onChange: (n: number) => void;
};

export function Switcher({ current, total, onChange }: Props) {
  return (
    <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2">
      <div className="flex items-center gap-1 rounded-full border border-white/15 bg-black/70 px-1.5 py-1.5 font-mono text-[11px] text-white/70 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.55)] backdrop-blur-md">
        <span className="px-2 text-white/40">variation</span>
        {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
          const active = n === current;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              className={
                "min-w-7 rounded-full px-2.5 py-1 text-center transition-colors " +
                (active
                  ? "bg-white text-black"
                  : "text-white/70 hover:bg-white/10 hover:text-white")
              }
              aria-pressed={active}
              aria-label={`Show variation ${n}`}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}
