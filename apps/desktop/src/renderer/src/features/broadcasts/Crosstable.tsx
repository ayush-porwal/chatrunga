import { useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import type {
  BroadcastRound,
  BroadcastRoundDetail,
  BroadcastStanding
} from "@chaturanga/shared/types/broadcast";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { roundQueryOptions } from "../../queries/broadcasts";
import { useBroadcastStore } from "../../stores/broadcast-store";
import { scoreText } from "./broadcast-text";
import { crosstable, type CrossCell } from "./crosstable-model";

/** A round being played is read again this often while the crosstable is open. */
const LIVE_ROUND_REFRESH_MS = 3 * 60_000;
/**
 * The pause after a round read from Lichess before the next is asked for: the rounds come one
 * after another, not in a burst (round and tournament reads share a budget of about 30 per 3
 * minutes). Rounds read before come at once.
 */
const ROUND_GAP_MS = 1500;

/**
 * Every player's game of every round (the started ones), opponents by their place in the
 * standings; a game opens on the board. Each round is read once (finished ones are kept), in
 * turn; the streamed games' results are the latest.
 */
export function Crosstable({
  standings,
  rounds,
  onOpenGame
}: {
  standings: readonly BroadcastStanding[];
  rounds: readonly BroadcastRound[];
  onOpenGame: (detail: BroadcastRoundDetail, gameId: string) => void;
}) {
  const [unlocked, setUnlocked] = useState(1);
  const streamed = useBroadcastStore((state) => state.games);
  const reads = useQueries({
    queries: rounds.map((round, index) => ({
      ...roundQueryOptions(round.id),
      enabled: index < unlocked,
      staleTime: round.finished ? Number.POSITIVE_INFINITY : LIVE_ROUND_REFRESH_MS,
      refetchInterval: round.finished ? false : LIVE_ROUND_REFRESH_MS
    })),
    combine: (results) => ({
      details: results.map((result) => result.data ?? null),
      failed: results.map((result) => result.isError),
      settled: results.map((result) => result.data !== undefined || result.isError),
      fetched: results.map((result) => result.isFetchedAfterMount)
    })
  });
  const { details, failed } = reads;
  const lastSettled = reads.settled[unlocked - 1] ?? false;
  const lastFetched = reads.fetched[unlocked - 1] ?? false;
  useEffect(() => {
    if (unlocked >= rounds.length || !lastSettled) return;
    const timer = setTimeout(
      () => setUnlocked((count) => count + 1),
      lastFetched ? ROUND_GAP_MS : 0
    );
    return () => clearTimeout(timer);
  }, [unlocked, rounds.length, lastSettled, lastFetched]);
  const rows = crosstable(standings, details, streamed);
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full border-collapse text-[0.8125rem]">
        <thead>
          <tr className="h-9 border-b border-line-subtle text-left text-xs text-fg-subtle">
            <th scope="col" className="w-10 pl-4 font-normal">
              #
            </th>
            <th scope="col" className="min-w-44 font-normal">
              Player
            </th>
            {rounds.map((round, index) => (
              <th
                key={round.id}
                scope="col"
                title={round.name}
                className="w-14 text-center font-normal"
              >
                R{index + 1}
              </th>
            ))}
            <th scope="col" className="w-14 pr-4 text-right font-normal">
              Points
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.player.fideId ?? row.player.name}
              className="h-9 border-b border-line-subtle last:border-b-0"
            >
              <td className="pl-4 text-fg-subtle tabular-nums">{row.place}</td>
              <td className="truncate font-semibold text-fg">
                {row.player.title ? (
                  <span className="mr-1.5 text-2xs font-semibold text-warn">
                    {row.player.title}
                  </span>
                ) : null}
                {row.player.name}
              </td>
              {row.cells.map((cell, index) => {
                const detail = details[index];
                return (
                  <td key={rounds[index]?.id ?? index} className="text-center">
                    {detail === null && failed[index] ? (
                      <span className="text-fg-subtle" title="Couldn't load this round">
                        ?
                      </span>
                    ) : detail === null ? (
                      <Skeleton className="mx-auto h-3 w-8" />
                    ) : cell ? (
                      <CrossCellButton
                        cell={cell}
                        round={rounds[index]?.name ?? ""}
                        onOpen={() => onOpenGame(detail, cell.game.id)}
                      />
                    ) : (
                      <span className="text-fg-subtle">–</span>
                    )}
                  </td>
                );
              })}
              <td className="pr-4 text-right font-semibold tabular-nums">
                {row.player.score === null ? "" : scoreText(row.player.score)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CrossCellButton({
  cell,
  round,
  onOpen
}: {
  cell: CrossCell;
  round: string;
  onOpen: () => void;
}) {
  const opponent = cell.color === "white" ? cell.game.black : cell.game.white;
  const outcome = cell.score === null ? "being played" : cell.score;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${round}: against ${opponent.name} with ${cell.color}, ${outcome}. Open in analysis.`}
      title={`${round}: against ${opponent.name}`}
      className="inline-flex h-6.5 items-center gap-1 rounded-md px-1.5 tabular-nums outline-none transition-colors hover:bg-control focus-visible:ring-2 focus-visible:ring-accent/70"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 shrink-0 rounded-full",
          cell.color === "white" ? "bg-piece-white" : "border border-line-strong bg-piece-black"
        )}
      />
      <span className="text-2xs text-fg-subtle">{cell.opponent ?? "?"}</span>
      <span
        className={cn(
          "font-semibold",
          cell.score === "1" ? "text-accent" : cell.score === null ? "text-danger" : "text-fg"
        )}
      >
        {cell.score ?? "•"}
      </span>
    </button>
  );
}
