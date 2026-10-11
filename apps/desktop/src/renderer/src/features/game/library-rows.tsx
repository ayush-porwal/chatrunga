/**
 * The library's list pieces, shared by the workspace Library tab and Game review's Choose a game:
 * a saved game's row (its board with the source badge, the two players, the score), its
 * placeholder, a failed read, and what an empty list says.
 */
import type { ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import type { Color, GameSummary } from "@chaturanga/shared/types/chess";
import { LIBRARY_TAB_LABELS } from "@chaturanga/shared/types/library";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { SideDot } from "@/components/ui/side-dot";
import { Skeleton } from "@/components/ui/skeleton";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { BoardThumbnail } from "../settings/board-thumbnail";
import { PiecePair } from "../play/piece-art";
import { SourceBadge } from "../play/recent-games-controls";
import { playerName, scoresFor } from "../play/recent-games";
import type { LibraryFilter } from "./library-tab";

/** What a row shows of a game: a saved one, or the game on the board. */
export type LibraryRowGame = Pick<
  GameSummary,
  "source" | "white" | "black" | "result" | "currentFen"
>;

/**
 * One game: its board (turned to `orientation`) with its source badge, the players (the loser
 * muted), `marker` (the Library's reviewed mark, the picker's badge), the score, then `children`
 * (the row's own controls, which sit above its whole-row button). `onRaised` rows sit on a
 * dialog's raised surface, so the badge's ring takes that colour.
 */
export function LibraryGameRow({
  game,
  orientation,
  onOpen,
  marker,
  onRaised = false,
  children
}: {
  game: LibraryRowGame;
  orientation: Color;
  onOpen: () => void;
  marker?: ReactNode;
  onRaised?: boolean;
  children?: ReactNode;
}) {
  const scores = scoresFor(game.result);
  const white = playerName(game, "white");
  const black = playerName(game, "black");

  const player = (color: Color, name: string) => (
    <span className="flex min-w-0 items-center gap-1.75">
      <SideDot color={color} className="size-2" />
      <span
        className={cn(
          "truncate font-medium",
          scores?.[color] === "0" ? "text-fg-subtle" : "text-fg-secondary"
        )}
      >
        {name}
      </span>
    </span>
  );

  return (
    <li
      className={cn(
        // A row with its ⋯ menu open is lifted, so the rows below don't paint over the menu.
        "group/row relative mx-1.5 flex h-17 cursor-pointer items-center gap-3 rounded-[10px] border border-transparent pl-2.5 pr-2 transition-colors duration-micro hover:border-line-strong hover:bg-control focus-within:border-line-strong focus-within:bg-control has-[[aria-expanded=true]]:z-20",
        onRaised && "mx-0"
      )}
    >
      {/* Isolated: the source badge stays above the thumbnail, under the row's open overlay. */}
      <span className="relative isolate shrink-0">
        <BoardThumbnail
          fen={game.currentFen}
          orientation={orientation}
          rounded="md"
          className="w-13"
        />
        <SourceBadge
          source={game.source}
          className={cn("-bottom-1 -right-1 size-4.5", onRaised && "ring-surface-raised")}
        />
      </span>
      {/* The row's own action: the button covers the whole row (other controls sit above it). */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${white} vs ${black}`}
        className="grid min-w-0 flex-1 gap-0.75 text-left text-[0.8125rem] outline-none after:absolute after:inset-0 after:rounded-[9px] after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-accent/50"
      >
        {player("white", white)}
        {player("black", black)}
      </button>
      {marker}
      <span className="grid w-3.5 shrink-0 gap-0.75 text-center text-[0.8125rem] font-semibold tabular-nums">
        {scores ? (
          (["white", "black"] as const).map((color) => (
            <span
              key={color}
              className={scores[color] === "0" ? "font-medium text-fg-subtle" : "text-fg"}
            >
              {scores[color]}
            </span>
          ))
        ) : (
          <span className="sr-only">In progress</span>
        )}
      </span>
      {children}
    </li>
  );
}

/** A row's placeholder: the thumbnail and the two player lines. */
export function LibrarySkeletonRow({ onRaised = false }: { onRaised?: boolean }) {
  return (
    <div className={cn("mx-1.5 flex h-17 items-center gap-3 pl-2.5 pr-2", onRaised && "mx-0")}>
      <Skeleton className="size-13 rounded-[5px]" />
      <span className="grid flex-1 gap-1">
        <Skeleton className="h-2.75 w-[70%]" />
        <Skeleton className="h-2.75 w-1/2" />
      </span>
    </div>
  );
}

/** The library couldn't be read (its counts or its games): why, and Try again. */
export function LibraryLoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Notice
      tone="danger"
      title="Couldn't load your games"
      action={
        <Button type="button" variant="outline" size="xs" onClick={onRetry}>
          <RotateCcw />
          Try again
        </Button>
      }
    >
      {ipcErrorMessage(error) || "The library couldn't be read."}
    </Notice>
  );
}

/** Nothing listed: no match for the search, none the filter lets through, or no games at all. */
export function NoLibraryGames({
  needle,
  hasGames,
  filter
}: {
  needle: string;
  hasGames: boolean;
  filter: LibraryFilter;
}) {
  if (needle)
    return (
      <p className="px-4 py-6 text-center text-[0.8125rem] text-fg-muted">
        No games match “{needle}”
      </p>
    );
  if (hasGames) {
    const label = filter.tab ? `${LIBRARY_TAB_LABELS[filter.tab]} ` : "";
    return (
      <p className="px-4 py-6 text-center text-[0.8125rem] text-fg-muted">
        No {filter.reviewed ? "reviewed " : ""}
        {label}games
      </p>
    );
  }
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="flex flex-col items-center gap-3">
        <PiecePair piece="pawn" pieceClassName="size-24" gapClassName="[&>*+*]:-ml-4.5" />
        <span className="text-[0.9375rem] font-medium text-fg-secondary">
          Saved games will appear here.
        </span>
      </div>
    </div>
  );
}
