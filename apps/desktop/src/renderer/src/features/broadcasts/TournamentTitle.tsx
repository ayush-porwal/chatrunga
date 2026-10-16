import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBroadcastTournamentQuery } from "../../queries/broadcasts";

/** "Broadcasts › Tournament name", with a link back to the hub. */
export function TournamentTitle({
  tourId,
  onBroadcasts
}: {
  tourId: string;
  onBroadcasts: () => void;
}) {
  const tournament = useBroadcastTournamentQuery(tourId);
  const name = tournament.data?.tour.name ?? null;
  return (
    <nav
      aria-label="Broadcast location"
      className="flex min-w-0 items-center gap-1 text-sm [-webkit-app-region:no-drag]"
    >
      <Button
        type="button"
        variant="link"
        size="xs"
        className="cursor-pointer text-sm"
        onClick={onBroadcasts}
      >
        Broadcasts
      </Button>
      {name ? (
        <>
          <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
          <span className="truncate font-medium text-fg">{name}</span>
        </>
      ) : null}
    </nav>
  );
}
