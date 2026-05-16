import { type MouseEvent } from "react";
import { Trash2 } from "lucide-react";
import { nodeIdForBoardFen } from "@chaturanga/shared/chess/pgn";
import { useDeleteGameMutation, useGamesQuery } from "../../queries/api";
import { useGameStore } from "../../stores/game-store";
import { useReviewStore } from "../../stores/review-store";
import { cn } from "@/lib/utils";
import { panel, empty, gamePanelScrollBody } from "@/lib/ui";

export function RecentGames() {
  const games = useGamesQuery();
  const removeGame = useDeleteGameMutation();
  const loadGame = useGameStore((state) => state.loadGame);
  const resetBoard = useGameStore((state) => state.reset);

  async function openGame(id: string) {
    if (!window.chaturanga) return;
    const saved = await window.chaturanga.games.get(id);
    loadGame({
      id: saved.id,
      source: saved.source,
      headers: {
        event: saved.event,
        site: saved.site,
        date: saved.date,
        round: saved.round,
        white: saved.white,
        black: saved.black,
        result: saved.result
      },
      rootFen: saved.initialFen ?? saved.moveTree[0]?.fenAfter,
      currentFen: saved.currentFen,
      currentNodeId: nodeIdForBoardFen(saved.moveTree, saved.currentFen, "root"),
      moveTree: saved.moveTree,
      pgn: saved.pgn
    });
    useReviewStore.getState().loadReview(saved.review ?? null);
  }

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
    <div className={cn(panel, "flex min-h-0 w-full min-w-0 flex-1 flex-col p-[13px]")}>
      <h2 className="shrink-0 text-[15px] font-semibold text-[#f4f1ea]">Recent games</h2>
      {games.data?.length ? (
        <div className={gamePanelScrollBody}>
          <div className="flex w-full min-w-0 flex-col gap-2">
            {games.data.map((game) => (
              <div key={game.id} className="flex items-stretch gap-1.5">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col gap-1 rounded-[7px] border border-white/10 bg-[#171a1d] px-3 py-2 text-left text-[#f2f2f2] transition-colors hover:bg-[#303030]"
                  onClick={() => openGame(game.id)}
                >
                  <strong className="truncate">
                    {game.white || "White"} vs {game.black || "Black"}
                  </strong>
                  <span className="truncate text-[13px] text-[#a9adb4]">
                    {game.event || game.source} · {game.result || "*"}
                  </span>
                </button>
                <button
                  type="button"
                  className="inline-flex w-10 shrink-0 items-center justify-center rounded-[7px] border border-white/10 bg-[#171a1d] p-0 text-[#c77a7a] transition-colors hover:bg-[#362323] hover:text-[#e59393] disabled:cursor-not-allowed disabled:opacity-45"
                  title="Delete saved game"
                  disabled={!window.chaturanga || removeGame.isPending}
                  onClick={(e) => void deleteGame(game.id, e)}
                >
                  <Trash2 size={17} aria-hidden />
                  <span className="sr-only">Delete</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className={cn(empty, "mt-3")}>Saved games will appear here.</p>
      )}
    </div>
  );
}
