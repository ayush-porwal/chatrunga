import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** A set's tile: sunken, inside the hub card (no card within the card). */
export const tile = "flex min-w-0 flex-col rounded-lg bg-surface-sunken leading-[1.43]";

/**
 * The Practice tab's placeholder tiles, while its sets (or the tab's code: the hub's fallback)
 * load.
 */
export function PracticeTilesLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading practice"
      className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-4 p-4"
    >
      {[0, 1, 2].map((index) => (
        <div key={index} className={cn(tile, "h-56 p-4")}>
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}
