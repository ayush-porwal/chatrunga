import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import type { Color, SavedGame } from "@chaturanga/shared/types/chess";
import { useDatabasesQuery } from "../../queries/api";
import { usePuzzleOfTheDayQuery } from "../../queries/puzzles";
import { useGameStore } from "../../stores/game-store";
import { useLichessStore } from "../../stores/lichess-store";
import { decidedResult } from "../../app/game-title";
import { clockLabel, playerLabel } from "../lichess/lichess-game";
import { puzzleDatabasesOf } from "../puzzles/puzzle-set";
import { localDateKey, msUntilNextDay } from "./board-card-text";
import {
  mainlineEnd,
  pickInProgress,
  type BoardMatchInput,
  type InProgressCard,
  type LiveGameInput,
  type SavedGameInput
} from "./in-progress";
import { useRecentGamesQuery } from "./recent-games";

/** Engine games Play saves for a puzzle played on from its end: not a game to rejoin. */
const PUZZLE_CONTINUATION = "Puzzle continuation";

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
  const end = useMemo(() => mainlineEnd(board.moveTree), [board.moveTree]);

  // Lichess games of yours in progress elsewhere: only asked for when there are some.
  const playingEnabled = ongoingGameIds.length > 0 && Boolean(window.chaturanga);
  const playing = useQuery({
    queryKey: ["lichess", "playing", ongoingGameIds],
    queryFn: async () => (await window.chaturanga?.lichess.playing()) ?? [],
    enabled: playingEnabled,
    staleTime: 15_000
  });

  // The newest saved engine game without a result (from the games the page reads anyway).
  const games = useRecentGamesQuery();
  const candidate =
    games.data?.find(
      (game) =>
        game.source === "engine-game" &&
        !decidedResult(game.result) &&
        game.event !== PUZZLE_CONTINUATION
    ) ?? null;
  const candidateId = candidate?.id ?? null;
  const detail = useQuery({
    // The same key (and read) as the Recent games rows', so a save refreshes both.
    queryKey: ["games", "detail", candidateId ?? ""],
    queryFn: async (): Promise<SavedGame | null> =>
      candidateId ? ((await window.chaturanga?.games.get(candidateId)) ?? null) : null,
    enabled: candidateId !== null,
    staleTime: 5_000
  });

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
  const savedEnd = detail.data ? mainlineEnd(detail.data.moveTree) : null;
  const saved: SavedGameInput | null =
    candidate && savedEnd
      ? {
          id: candidate.id,
          white: candidate.white,
          black: candidate.black,
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
    !games.isPending &&
    (!candidate || !detail.isPending) &&
    (!playingEnabled || !playing.isPending);
  return { card, settled };
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
  const query = usePuzzleOfTheDayQuery(date, { enabled: installed });
  return {
    installed,
    puzzle: query.isError ? null : (query.data ?? null),
    settled: !databases.isPending && (!installed || !query.isPending)
  };
}
