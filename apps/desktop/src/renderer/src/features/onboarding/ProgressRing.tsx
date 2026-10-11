import { progressRingDash } from "./onboarding-state";

/** The ring's radius in its 40×40 viewBox (the stroke sits inside the box). */
const RADIUS = 16;

/**
 * A download's progress as a ring with the percentage inside. The value circle draws in from
 * empty when it mounts (`onb-ring-in`, off under reduced motion).
 */
export function ProgressRing({
  value,
  label
}: {
  /** Whole-number percentage. */
  value: number;
  /** What is downloading, for screen readers. */
  label: string;
}) {
  const { circumference, offset } = progressRingDash(value, RADIUS);
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      className="relative grid size-[46px] shrink-0 place-items-center"
    >
      <svg viewBox="0 0 40 40" aria-hidden className="absolute inset-0 size-full -rotate-90">
        <circle
          cx="20"
          cy="20"
          r={RADIUS}
          fill="none"
          strokeWidth="3.5"
          className="stroke-control-hover"
        />
        <circle
          cx="20"
          cy="20"
          r={RADIUS}
          fill="none"
          strokeWidth="3.5"
          strokeLinecap="round"
          className="onb-ring-in stroke-accent transition-[stroke-dashoffset] duration-500 ease-standard motion-reduce:transition-none"
          style={{
            "--full": circumference,
            strokeDasharray: circumference,
            strokeDashoffset: offset
          }}
        />
      </svg>
      <b className="font-mono text-[11.5px] font-bold text-fg tabular-nums">{value}%</b>
    </span>
  );
}
