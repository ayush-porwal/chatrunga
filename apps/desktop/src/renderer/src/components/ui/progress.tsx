import { cn } from "@/lib/utils";

/**
 * Thin progress bar. `value` 0–100; `null` = indeterminate (a partial bar sweeping across; a pulse
 * under reduced motion). Value changes glide (transform, emphasis duration).
 *
 *   <Progress value={pct} aria-label="Downloading Stockfish" />
 */
function Progress({
  value,
  tone = "accent",
  "aria-label": ariaLabel
}: {
  value: number | null;
  tone?: "accent" | "danger";
  "aria-label"?: string;
}) {
  const clamped = value === null ? null : Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped ?? undefined}
      className="h-1.5 w-full overflow-hidden rounded-full bg-control"
    >
      {/* A full-width bar slid left by the remainder: transform-only, so updates never trigger layout. */}
      <div
        className={cn(
          "h-full w-full rounded-full",
          tone === "danger" ? "bg-danger" : "bg-accent",
          clamped === null
            ? "w-[35%] animate-indeterminate motion-reduce:animate-pulse"
            : "transition-transform duration-emphasis ease-standard"
        )}
        style={clamped === null ? undefined : { transform: `translateX(${clamped - 100}%)` }}
      />
    </div>
  );
}

export { Progress };
