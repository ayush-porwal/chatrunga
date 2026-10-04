import { createContext, useContext, useMemo } from "react";
import { RefreshCw } from "lucide-react";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useGameStore } from "../../stores/game-store";
import type { CommentaryMoveContext } from "./commentary-moves";
import { CommentaryProse } from "./MoveLinks";
import type { CommentaryDetail } from "./review-utils";
import { useGameReviewCommentary } from "./useGameReviewCommentary";

/**
 * What a key-moment or mark card needs to show a move's AI commentary: the Commentary tab's own
 * request options. Null while AI commentary is off (switched off, or no OpenRouter key): cards
 * then show no commentary and don't expand.
 */
export type CardCommentaryOptions = {
  detail: CommentaryDetail;
  userRating: number;
  playerColor: "white" | "black";
  settingsReady: boolean;
};

export const CardCommentaryContext = createContext<CardCommentaryOptions | null>(null);

/** The cards' commentary options, or null while AI commentary is off. */
export function useCardCommentary(): CardCommentaryOptions | null {
  return useContext(CardCommentaryContext);
}

/**
 * A card's expanded body: the same commentary the Commentary tab shows for `move`, from the same
 * source and per-ply cache (asked for once when it isn't cached yet).
 */
export function MomentCommentary({
  move,
  moves,
  options
}: {
  move: MoveReview;
  /** The review's moves (the prose's moves link into them). */
  moves: readonly MoveReview[];
  options: CardCommentaryOptions;
}) {
  const result = useGameReviewCommentary({ ...options, enabled: true, move, visible: true });
  const moveTree = useGameStore((state) => state.moveTree);
  const context = useMemo<CommentaryMoveContext>(
    () => ({ move, moves, moveTree }),
    [move, moveTree, moves]
  );
  const goToLine = useGameStore((state) => state.goToLine);
  const onGoToLine = (target: { startNodeId: string; moves: string[] }) =>
    goToLine(target.startNodeId, target.moves);

  if (result.status === "ready" && result.commentary) {
    const { headline, prose } = result.commentary;
    return (
      <div className="grid animate-fade-in gap-1.5" aria-label="Commentary" role="region">
        {headline ? (
          <p className="font-serif text-sm font-semibold leading-6 text-fg">
            <CommentaryProse prose={headline} context={context} onGoToLine={onGoToLine} />
          </p>
        ) : null}
        <p className="font-serif text-sm leading-6 text-fg-secondary">
          <CommentaryProse prose={prose} context={context} onGoToLine={onGoToLine} />
        </p>
      </div>
    );
  }
  if (result.status === "error") {
    return (
      <div
        className="flex items-center gap-2 text-xs text-fg-muted"
        aria-label="Commentary"
        role="region"
      >
        <span className="min-w-0 flex-1">{result.error}</span>
        <Button variant="outline" size="xs" onClick={result.retry}>
          <RefreshCw />
          Retry
        </Button>
      </div>
    );
  }
  if (result.status === "no-payload") {
    return (
      <p className="text-xs text-fg-muted" aria-label="Commentary" role="region">
        The engine didn't return enough data about this move to explain it.
      </p>
    );
  }
  return (
    <div className="grid gap-1.5" role="status" aria-label="Writing commentary">
      <Skeleton className="h-3 w-3/5 rounded" />
      <Skeleton className="h-3 w-full rounded" />
      <Skeleton className="h-3 w-4/5 rounded" />
    </div>
  );
}
