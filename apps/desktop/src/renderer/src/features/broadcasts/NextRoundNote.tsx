import { useEffect, useRef } from "react";
import { ChevronRight, Clock } from "lucide-react";
import type { BroadcastRound } from "@chaturanga/shared/types/broadcast";
import { Button } from "@/components/ui/button";
import { useMinuteClock } from "@/lib/use-minute-clock";
import { LiveDot } from "./broadcast-parts";
import { roundAfter, startsText } from "./broadcast-text";

/**
 * Watching a round live as it finishes, the page moves on to the next round when it starts. A
 * round looked at after it finished stays put (the note offers the next one).
 */
export function useFollowNextRound(
  rounds: readonly BroadcastRound[],
  roundId: string | null,
  setRound: (id: string) => void
): void {
  const watchedLive = useRef<string | null>(null);
  const ongoing = rounds.some((item) => item.id === roundId && item.ongoing);
  const after = roundAfter(rounds, roundId);
  const nextStarted = after?.started ? after.round.id : null;
  useEffect(() => {
    // Gone to another round: the live one was left before it finished.
    if (watchedLive.current !== roundId) watchedLive.current = null;
    if (ongoing) {
      watchedLive.current = roundId;
      return;
    }
    if (nextStarted && watchedLive.current === roundId) {
      watchedLive.current = null;
      setRound(nextStarted);
    }
  }, [ongoing, nextStarted, roundId, setRound]);
}

/** After a finished round: the next one has started (and a way to it), or when it starts. */
export function NextRoundNote({
  rounds,
  roundId,
  onGo
}: {
  rounds: readonly BroadcastRound[];
  roundId: string | null;
  onGo: (roundId: string) => void;
}) {
  const now = useMinuteClock();
  const after = roundAfter(rounds, roundId);
  if (!after) return null;
  const { round, started } = after;
  if (started)
    return (
      <Button size="xs" variant="primary" onClick={() => onGo(round.id)}>
        <LiveDot pulse />
        {round.name} has started
        <ChevronRight />
      </Button>
    );
  if (round.startsAt === null) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
      <Clock aria-hidden="true" className="size-3.5" />
      {round.name}: {startsText(round.startsAt, now).toLowerCase()}
    </span>
  );
}
