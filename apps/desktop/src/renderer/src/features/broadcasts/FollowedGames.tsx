import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBroadcastStore } from "../../stores/broadcast-store";
import { BoardThumbnail } from "../settings/board-thumbnail";
import { LiveDot } from "./broadcast-parts";
import { useFollowedPlayers } from "./followed-players";
import type { TournamentTarget } from "./navigation";
import { playsIn, roundGamesWhere, useRoundsRead } from "./round-games";

/**
 * The hub's "Your players": the games of the players you follow (a star on a tournament's
 * standings) in the live rounds the hub reads, each opening its round with its board outlined.
 * Nothing when you follow nobody.
 */
export function FollowedGames({
  roundIds,
  onOpen
}: {
  roundIds: readonly string[];
  onOpen: (target: TournamentTarget) => void;
}) {
  const { followed } = useFollowedPlayers();
  const rounds = useRoundsRead(roundIds, followed.length > 0);
  const streamed = useBroadcastStore((state) => state.games);
  if (!followed.length) return null;
  const games = roundGamesWhere(rounds, streamed, (game) => playsIn(game, followed));
  return (
    <section
      aria-labelledby="broadcasts-followed"
      className="flex shrink-0 items-center gap-3 overflow-hidden rounded-xl border border-line bg-surface py-2 pr-2 pl-4"
    >
      <h2
        id="broadcasts-followed"
        className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-fg"
      >
        <Star aria-hidden="true" className="size-3.5 fill-current text-warn" />
        Your players
      </h2>
      {games.length ? (
        <div className="scroll-area flex min-w-0 flex-1 gap-2 overflow-x-auto">
          {games.map((game) => (
            <button
              key={game.key}
              type="button"
              onClick={() => onOpen(game.target)}
              className="group flex w-64 shrink-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-control focus-visible:ring-2 focus-visible:ring-accent/70"
            >
              <span className="w-10 shrink-0">
                <BoardThumbnail fen={game.fen} lastMove={game.lastMove} rounded="md" />
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-[0.8125rem] font-semibold text-fg">
                  {game.white} – {game.black}
                </span>
                <span className="truncate text-xs text-fg-muted">{game.where}</span>
              </span>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold",
                  game.live ? "text-danger" : "text-fg-secondary"
                )}
              >
                {game.live ? <LiveDot /> : null}
                {game.status}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="truncate py-1.5 text-xs text-fg-muted">
          None of them is playing in the live rounds shown here.
        </p>
      )}
    </section>
  );
}
