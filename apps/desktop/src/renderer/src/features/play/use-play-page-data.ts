import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import type { Color, SavedGame } from "@chaturanga/shared/types/chess";
import { useDatabasesQuery, useSaveGameMutation } from "../../queries/api";
import { usePuzzleOfTheDayQuery } from "../../queries/puzzles";
import { useGameStore, type GameOutcome } from "../../stores/game-store";
import { useLichessStore } from "../../stores/lichess-store";
import { savedEngineClock, timeForfeitSave } from "../../app/rejoin-saved-game";
import { sessionFromSavedGame } from "../game/saved-game";
import { clockLabel, playerLabel } from "../lichess/lichess-game";
import { puzzleDatabasesKey, puzzleDatabasesOf } from "../puzzles/puzzle-set";
import { localDateKey, msUntilNextDay } from "./board-card-text";
import {
  mainlineSummary,
  pickInProgress,
  type BoardMatchInput,
  type InProgressCard,
  type LiveGameInput,
  type SavedGameInput
} from "./in-progress";

/** The longest wait before a saved game's clock is looked at again (timers cap far above it). */
const MAX_FLAG_WAIT_MS = 24 * 60 * 60 * 1000;

/**
 * The In progress card's game (see pickInProgress) and whether everything it depends on has been
 * read (`settled`), so the page shows its final layout at once.
 */
export function useInProgressCard(): { card: InProgressCard | null; settled: boolean } {
  const live = useLichessStore((state) => (state.live && !state.live.over ? state.live : null));
  const ongoingGameIds = useLichessStore((state) => state.ongoingGameIds);
  const board = useGameStore(
    useShallow((state) => ({
      gameId: state.gameId,
      mode: state.mode,
      engineSide: state.engineSide,
      over: Boolean(state.gameOutcome),
      white: state.headers.white,
      black: state.headers.black,
      moveTree: state.moveTree,
      currentFen: state.currentFen
    }))
  );
  const end = useMemo(() => mainlineSummary(board.moveTree), [board.moveTree]);

  // Lichess games of yours in progress elsewhere: only asked for when there are some.
  const playingEnabled = ongoingGameIds.length > 0 && Boolean(window.chaturanga);
  const playing = useQuery({
    queryKey: ["lichess", "playing", ongoingGameIds],
    queryFn: async () => (await window.chaturanga?.lichess.playing()) ?? [],
    enabled: playingEnabled,
    staleTime: 15_000
  });

  // The newest saved engine game still in progress (read on its own: it may be older than the
  // games Recent games shows). A save of any game reads it again.
  const latest = useQuery({
    queryKey: ["games", "latest-unfinished-engine-game"],
    queryFn: async (): Promise<SavedGame | null> =>
      (await window.chaturanga?.games.latestUnfinishedEngineGame()) ?? null,
    enabled: Boolean(window.chaturanga),
    staleTime: 5_000
  });
  const latestGame = latest.data ?? null;
  // Its clocks now. One that ran out while it was away is no longer in progress: it is saved
  // lost on time (see useEndSavedGameOnTime) and the card skips it.
  const now = useNow(latestGame);
  const latestClock = useMemo(
    () =>
      latestGame
        ? savedEngineClock(
            latestGame.moveTree,
            sessionFromSavedGame(latestGame).headers.timeControl,
            now
          )
        : null,
    [latestGame, now]
  );
  const flagged = Boolean(latestClock?.flagged);
  useEndSavedGameOnTime(latestGame, latestClock?.flagged ?? null);

  const liveInput: LiveGameInput | null = live
    ? {
        savedId: board.gameId,
        opponent: playerLabel(live.yourColor === "white" ? live.full.black : live.full.white),
        clock: live.full.clock ? clockLabel(live.full.clock) : null,
        speed: live.full.speed,
        rated: live.full.rated,
        yourColor: live.yourColor,
        fen: end?.fen ?? board.currentFen,
        lastMove: end?.lastMove ?? null
      }
    : null;
  const engineSide = board.engineSide;
  const boardMatch: BoardMatchInput | null =
    board.mode === "engine" && engineSide && !board.over
      ? {
          savedId: board.gameId,
          engineName: (engineSide === "white" ? board.white : board.black) ?? "",
          humanColor: (engineSide === "white" ? "black" : "white") satisfies Color,
          fen: end?.fen ?? board.currentFen,
          lastMove: end?.lastMove ?? null
        }
      : null;
  const savedEnd = latestGame ? mainlineSummary(latestGame.moveTree) : null;
  const saved: SavedGameInput | null =
    latestGame && savedEnd && !flagged
      ? {
          id: latestGame.id,
          white: latestGame.white,
          black: latestGame.black,
          fen: savedEnd.fen,
          lastMove: savedEnd.lastMove,
          plies: savedEnd.plies
        }
      : null;

  const card = pickInProgress({
    live: liveInput,
    playing: (playing.data ?? []).filter((game) => ongoingGameIds.includes(game.id)),
    boardMatch,
    saved
  });
  const settled =
    (!window.chaturanga || !latest.isPending) && (!playingEnabled || !playing.isPending);
  return { card, settled };
}

/**
 * The time now (epoch ms), read again when `game`'s side to move would run out of time while the
 * page is open, so its card goes then rather than at the next visit.
 */
function useNow(game: SavedGame | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!game) return;
    const clock = savedEngineClock(
      game.moveTree,
      sessionFromSavedGame(game).headers.timeControl,
      Date.now()
    );
    if (!clock || clock.flagged) return;
    const left = clock.sideToMove === "white" ? clock.whiteMs : clock.blackMs;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(left, MAX_FLAG_WAIT_MS));
    return () => window.clearTimeout(timer);
  }, [game, now]);
  return now;
}

/**
 * A saved engine game lost on time while it was away gets its result: saved with it (the library
 * and Recent games then show it). The board's own game is ended there instead, so its next save
 * keeps the result: by its live clock in a match, by its headers otherwise. Each game once.
 */
function useEndSavedGameOnTime(game: SavedGame | null, outcome: GameOutcome | null): void {
  const save = useSaveGameMutation().mutate;
  const ended = useRef(new Set<string>());
  useEffect(() => {
    if (!game || !outcome || ended.current.has(game.id)) return;
    ended.current.add(game.id);
    const board = useGameStore.getState();
    if (board.gameId === game.id) {
      // A match on the board flags by its own clock.
      if (board.mode === "engine" && board.engineSide) return;
      if (!board.gameOutcome) board.patchHeaders(outcome);
      return;
    }
    save(timeForfeitSave(game, outcome));
  }, [game, outcome, save]);
}

/** The local calendar day, moving on at local midnight while the page is open. */
function useLocalDate(): string {
  const [date, setDate] = useState(() => localDateKey(new Date()));
  useEffect(() => {
    const timer = window.setTimeout(
      () => setDate(localDateKey(new Date())),
      msUntilNextDay(new Date())
    );
    return () => window.clearTimeout(timer);
  }, [date]);
  return date;
}

/**
 * Puzzle of the day: asked for only with a puzzle database installed. `puzzle` is null without
 * one, while loading, on an error, or when the database has nothing to offer.
 */
export function usePuzzleOfTheDay() {
  const databases = useDatabasesQuery();
  const installed = puzzleDatabasesOf(databases.data ?? []).length > 0;
  const date = useLocalDate();
  const query = usePuzzleOfTheDayQuery(date, {
    enabled: installed,
    databases: puzzleDatabasesKey(databases.data ?? [])
  });
  return {
    installed,
    // Only from the puzzle databases installed now (none: none, whatever was read before).
    puzzle: !installed || query.isError ? null : (query.data ?? null),
    settled: !databases.isPending && (!installed || !query.isPending)
  };
}
