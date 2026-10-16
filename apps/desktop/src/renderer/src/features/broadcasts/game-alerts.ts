import { useEffect } from "react";
import type { BroadcastAlert, BroadcastResult } from "@chaturanga/shared/types/broadcast";
import { useRoundStreams } from "../../queries/broadcasts";
import { useBroadcastStore, type GameAlert, type StreamedGame } from "../../stores/broadcast-store";
import { resultText } from "./broadcast-text";

type Games = Partial<Record<string, StreamedGame>>;

/** The games with an alert that have just ended: in progress before, a result now. */
export function endedAlerts(
  alerts: Partial<Record<string, GameAlert>>,
  games: Games,
  previous: Games
): { gameId: string; alert: GameAlert; result: BroadcastResult }[] {
  return Object.entries(alerts).flatMap(([gameId, alert]) => {
    const game = games[gameId];
    if (!alert || !game || game.result === "*" || previous[gameId]?.result !== "*") return [];
    return [{ gameId, alert, result: game.result }];
  });
}

/** The notification for a game that ended: its players, then its result. */
export function alertMessage(alert: GameAlert, result: BroadcastResult): BroadcastAlert {
  return { title: `${alert.white} – ${alert.black}`, body: `Game over: ${resultText(result)}` };
}

/**
 * Game-end alerts: their rounds' streams stay open whatever the view (and while the window is
 * hidden: that is when an alert is wanted), and each game that ends sends its notification once.
 * Mount once in the shell.
 */
export function useGameEndAlerts(): void {
  const roundIds = useBroadcastStore((state) =>
    Object.values(state.alerts)
      .flatMap((alert) => (alert ? [alert.roundId] : []))
      .sort()
      .join(" ")
  );
  useRoundStreams(roundIds ? roundIds.split(" ") : [], { whileHidden: true });
  useEffect(
    () =>
      useBroadcastStore.subscribe((state, previous) => {
        if (state.games === previous.games) return;
        for (const { gameId, alert, result } of endedAlerts(
          state.alerts,
          state.games,
          previous.games
        )) {
          state.setAlert(gameId, null);
          window.chaturanga?.broadcasts.notify(alertMessage(alert, result)).catch(() => undefined);
        }
      }),
    []
  );
}
