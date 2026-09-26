import { cn } from "@/lib/utils";

/**
 * Thin progress bar. `value` 0–100; `null` = indeterminate (partial bar).
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
      <div
        className={cn(
          "h-full rounded-full transition-[width]",
          tone === "danger" ? "bg-danger" : "bg-accent",
          clamped === null && "animate-pulse"
        )}
        style={{ width: clamped === null ? "35%" : `${clamped}%` }}
      />
    </div>
  );
}

export { Progress };
