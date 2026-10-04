import { MAIA_BUCKETS, type RatingCurve as RatingCurveType } from "@chaturanga/shared/schemas";
import { SectionHeader } from "@/components/ui/page";
import { cn } from "@/lib/utils";

/** Maia policy weights for the played move vs the engine's best move, per rating bucket. */
export function RatingCurve({ curve }: { curve: RatingCurveType }) {
  return (
    <section className="grid gap-2">
      <SectionHeader
        as="h3"
        title="Human prediction"
        description={
          <span className="flex flex-wrap items-center gap-x-2.5">
            <span className="inline-flex items-center gap-1">
              <i className="size-1.5 rounded-full bg-danger" />
              Played
            </span>
            <span className="inline-flex items-center gap-1">
              <i className="size-1.5 rounded-full bg-accent" />
              Best
            </span>
            <span>Maia model estimate, not a claim about every player</span>
          </span>
        }
      />
      <div className="grid gap-1.5">
        {MAIA_BUCKETS.map((rating, index) => {
          const user = rating === curve.userRatingBucket;
          const played = Math.round(curve.playedProb[index] * 100);
          const best = Math.round(curve.bestProb[index] * 100);
          return (
            <div
              key={rating}
              className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-2xs"
              aria-label={`${rating}${user ? " (your rating)" : ""}: played ${played}%, best ${best}%`}
            >
              <span
                className={cn(
                  "font-mono",
                  user ? "font-semibold text-accent-fg" : "text-fg-subtle"
                )}
              >
                {rating}
              </span>
              <div className="grid gap-1">
                <MiniBar value={curve.playedProb[index]} color="bg-danger" />
                <MiniBar value={curve.bestProb[index]} color="bg-accent" />
              </div>
              <span className="text-right font-mono text-fg-subtle">{played}%</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MiniBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-control">
      <div
        className={cn("h-full rounded-full", color)}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  );
}
