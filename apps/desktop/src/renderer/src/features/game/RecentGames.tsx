import { useMemo, useState, type MouseEvent } from "react";
import { BookPlus, FolderOpen, RotateCcw, Trash2 } from "lucide-react";
import { useDeleteGameMutation, useGamePagesQuery, type GameListParams } from "../../queries/api";
import { useGameStore } from "../../stores/game-store";
import { useReviewStore } from "../../stores/review-store";
import { cn } from "@/lib/utils";
import { listRow } from "@/lib/ui";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { OverflowMenu } from "@/components/ui/menu";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { cancelActiveReview } from "../../app/useReviewRunner";
import { gamesOfPages } from "@/lib/game-pages";
import { useAddToRepertoireStore } from "../../stores/add-to-repertoire-store";
import { hasMoves, sourceFromSavedGame } from "../repertoire/add-from-game";

/** The Library tab lists every game, newest first. */
const LIBRARY: GameListParams = { search: "", filter: "all", excludeId: null };

/**
 * The workspace's Library tab. Opening a game goes through App (`onOpenGame`: history, engine
 * teardown); "Add to repertoire…" reads the saved game and opens the dialog without loading it.
 */
export function RecentGames({ onOpenGame }: { onOpenGame: (id: string) => void }) {
  const games = useGamePagesQuery(LIBRARY);
  const list = useMemo(() => gamesOfPages(games.data?.pages), [games.data]);
  const removeGame = useDeleteGameMutation();
  const resetBoard = useGameStore((state) => state.reset);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const repertoiresAvailable = Boolean(window.chaturanga?.repertoires);

  async function deleteGame(id: string, event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!window.chaturanga) return;
    if (
      !window.confirm(
        "Remove this saved game? All moves, PGN, and any stored engine review for it will be deleted."
      )
    )
      return;
    setDeleteError(null);
    try {
      await removeGame.mutateAsync(id);
    } catch (error) {
      // Still saved: the board keeps it.
      setDeleteError(`Couldn't delete that game: ${ipcErrorMessage(error) || "unknown error"}`);
      return;
    }
    // Deleted while open: the board (and its review) go with it.
    if (useGameStore.getState().gameId === id) {
      void cancelActiveReview();
      resetBoard();
      useReviewStore.getState().reset();
    }
  }

  /** Reads the saved game (the board keeps its own) and asks to add the whole game. */
  async function addToRepertoire(id: string) {
    setDeleteError(null);
    const saved = await window.chaturanga?.games.get(id).catch(() => null);
    if (!saved) {
      setDeleteError("Couldn't read that game.");
      return;
    }
    const source = sourceFromSavedGame(saved);
    if (!hasMoves(source.tree)) {
      setDeleteError("That game has no moves to add.");
      return;
    }
    useAddToRepertoireStore
      .getState()
      .open({ source, initialScope: { kind: "whole-game" }, entry: "library" });
  }

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-col gap-2" aria-label="Library">
      {deleteError ? <Notice tone="danger">{deleteError}</Notice> : null}
      {games.isPending ? (
        <div className="grid gap-1.5" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : games.isError ? (
        // A failed read is not an empty library.
        <Notice
          tone="danger"
          title="Couldn't load your games"
          action={
            <Button type="button" variant="outline" size="xs" onClick={() => void games.refetch()}>
              <RotateCcw />
              Try again
            </Button>
          }
        >
          {ipcErrorMessage(games.error) || "The library couldn't be read."}
        </Notice>
      ) : list.length ? (
        <ul
          className="scroll-area -mr-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1"
          aria-label="Saved games"
        >
          {list.map((game) => (
            <li
              key={game.id}
              className={cn(
                listRow,
                "gap-1 py-1 pl-0 pr-1 transition-colors focus-within:border-line-strong hover:border-line-strong hover:bg-control"
              )}
            >
              <button
                type="button"
                className="grid min-w-0 flex-1 gap-0.5 rounded-md px-3 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                onClick={() => onOpenGame(game.id)}
              >
                <span className="truncate font-medium text-fg-secondary">
                  {game.white || "White"} vs {game.black || "Black"}
                </span>
                <span className="truncate text-xs text-fg-muted">
                  {game.event || game.source} · {game.result || "*"}
                </span>
              </button>
              <OverflowMenu
                label="Game actions"
                items={[
                  { label: "Open", icon: <FolderOpen />, onSelect: () => onOpenGame(game.id) },
                  repertoiresAvailable && {
                    label: "Add to repertoire…",
                    icon: <BookPlus />,
                    onSelect: () => void addToRepertoire(game.id)
                  }
                ]}
              />
              <IconButton
                label="Delete saved game"
                icon={<Trash2 />}
                variant="ghost-destructive"
                size="icon-xs"
                tooltipSide="left"
                disabled={!window.chaturanga || removeGame.isPending}
                onClick={(e) => void deleteGame(game.id, e)}
              />
            </li>
          ))}
          {games.hasNextPage ? (
            <li className="flex justify-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={games.isFetchingNextPage}
                onClick={() => void games.fetchNextPage()}
              >
                {games.isFetchingNextPage ? "Loading…" : "Show more"}
              </Button>
            </li>
          ) : null}
        </ul>
      ) : (
        <EmptyState compact title="Saved games will appear here." />
      )}
    </section>
  );
}
