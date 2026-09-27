import { type MouseEvent } from "react";
import { Trash2 } from "lucide-react";
import { useDeleteGameMutation, useGamesQuery } from "../../queries/api";
import { useGameStore } from "../../stores/game-store";
import { useReviewStore } from "../../stores/review-store";
import { cn } from "@/lib/utils";
import { listRow } from "@/lib/ui";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";

/** The workspace's Library tab. Opening a game goes through App (`onOpenGame`: history, engine teardown). */
export function RecentGames({ onOpenGame }: { onOpenGame: (id: string) => void }) {
  const games = useGamesQuery();
  const removeGame = useDeleteGameMutation();
  const resetBoard = useGameStore((state) => state.reset);

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
    if (useGameStore.getState().gameId === id) {
      resetBoard();
      useReviewStore.getState().reset();
    }
    await removeGame.mutateAsync(id);
  }

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-col gap-2" aria-label="Library">
      {games.data?.length ? (
        <ul className="scroll-area -mr-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1" aria-label="Saved games">
          {games.data.map((game) => (
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
        </ul>
      ) : (
        <EmptyState compact title="Saved games will appear here." />
      )}
    </section>
  );
}
