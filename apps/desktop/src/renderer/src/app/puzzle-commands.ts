import { statusForFen } from "@chaturanga/shared/chess/position";
import { createGameFromFen } from "@chaturanga/shared/chess/pgn";
import { DEFAULT_PUZZLE_RATING } from "@chaturanga/shared/chess/puzzle-rating";
import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import { PUZZLE_CONTINUATION_EVENT } from "@chaturanga/shared/types/chess";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import { ipcErrorMessage } from "@/lib/ipc-error";
import type { PuzzleSessionConfig } from "../features/puzzles/PuzzlePage";
import {
  puzzleDatabasesOf,
  puzzleSetConfig,
  selectedPuzzleDatabase
} from "../features/puzzles/puzzle-set";
import type { useSamplePuzzleMutation } from "../queries/api";
import { useAnalysisStore } from "../stores/analysis-store";
import { useGameStore } from "../stores/game-store";
import { usePuzzleDraftStore } from "../stores/puzzle-draft-store";
import { useReviewStore } from "../stores/review-store";
import { currentGame, type AppNavigation } from "./app-navigation";
import type { HistoryMode } from "./history-navigation";
import { nextPuzzleInput, puzzleBoard, type PuzzleSetStart } from "./puzzle-session-controller";
import { cancelActiveReview } from "./useReviewRunner";

/** What the puzzle commands need from the shell besides its navigation. */
type PuzzleCommandDeps = {
  engines: readonly EngineConfig[] | undefined;
  defaultEngineId: string | null;
  /** Samples the set's next puzzle (the sample-puzzle mutation). */
  sampleNextPuzzle: ReturnType<typeof useSamplePuzzleMutation>["mutate"];
  /** The board is a game played on from a puzzle: Next puzzle (after it) resumes the set. */
  puzzleSetContinues: boolean;
};

/** The commands that put a puzzle on the board, go on to the next one or play on from one. */
export function usePuzzleCommands(nav: AppNavigation, deps: PuzzleCommandDeps) {
  const { latestNavigation, commitCurrent, stopEngineWork, puzzleSession, showGame, showView } =
    nav;

  /**
   * Play's Puzzle of the day: Puzzles with that puzzle first, then the set the Puzzles page's
   * choices draw (its Next puzzle), on the database they use (this puzzle's when none is found).
   */
  async function solvePuzzleOfTheDay(puzzle: PuzzleSample) {
    const api = window.chaturanga;
    if (!api) return;
    const request = ++latestNavigation.current;
    const [databases, rating] = await Promise.all([
      api.databases.list().catch(() => []),
      api.puzzles.ratingSummary().catch(() => null)
    ]);
    if (request !== latestNavigation.current) return;
    const draft = usePuzzleDraftStore.getState().draft;
    const database = selectedPuzzleDatabase(puzzleDatabasesOf(databases), draft.databaseId) ?? {
      id: puzzle.databaseId,
      sourceId: puzzle.sourceId
    };
    const config: PuzzleSessionConfig = {
      ...puzzleSetConfig(draft, database, rating?.rating ?? DEFAULT_PUZZLE_RATING.rating),
      puzzleOfTheDayId: puzzle.id
    };
    startPuzzle(puzzle, { config });
  }

  function playEngineFromCurrentPuzzlePosition() {
    if (!nav.desktopApiAvailable) return;
    const engine =
      deps.engines?.find((item) => item.id === deps.defaultEngineId) ?? deps.engines?.[0];
    if (!engine) {
      void cancelActiveReview();
      commitCurrent();
      showView("settings");
      return;
    }
    const fen = useGameStore.getState().currentFen;
    const position = statusForFen(fen);
    if (position.isEnd) {
      currentGame().setMatchFeedback("This puzzle position is already finished.");
      return;
    }
    const engineSide = position.turn;
    const humanSide = engineSide === "white" ? "black" : "white";
    commitCurrent();
    // Not endBoardActivity: the puzzle set stays, so Next puzzle resumes it once this game ends.
    stopEngineWork();
    useReviewStore.getState().reset();
    currentGame().loadGame(
      createGameFromFen({
        fen,
        source: "engine-game",
        headers: {
          event: PUZZLE_CONTINUATION_EVENT,
          site: "?",
          result: "*",
          white: engineSide === "white" ? engineDisplayName(engine.name) : "You",
          black: engineSide === "black" ? engineDisplayName(engine.name) : "You",
          orientationHint: humanSide
        }
      })
    );
    puzzleSession.continueOnBoard(currentGame().board);
    currentGame().setOrientation(humanSide);
    currentGame().setMode("engine");
    currentGame().setEngineSide(engineSide);
    currentGame().setEngineMatchClock(null);
    currentGame().clearEngineMatchExtras();
    currentGame().setMatchFeedback("Playing engine from puzzle position.");
    const analysis = useAnalysisStore.getState();
    analysis.setActiveEngine(engine.id);
    analysis.setStatus("ready");
    analysis.setError(null);
    nav.setFocusMode(false);
    showGame();
  }

  /**
   * Loads a puzzle onto the board. `set` starts a puzzle set (a new one: a history step; or one
   * history brings back); without it the set continues (the next puzzle takes the current entry's place).
   */
  function startPuzzle(
    puzzle: PuzzleSample,
    set?: PuzzleSetStart,
    history: HistoryMode = set ? "push" : "replace"
  ) {
    if (history === "push") commitCurrent();
    stopEngineWork();
    useReviewStore.getState().reset();
    puzzleSession.begin(puzzle, set);
    currentGame().loadGame(puzzleBoard(puzzle));
    currentGame().setMode("puzzle");
    currentGame().setGameSource("puzzle");
    currentGame().setOrientation(puzzle.sideToMove);
    showGame("notation", history);
  }

  function loadNextPuzzle() {
    void cancelActiveReview();
    const input = nextPuzzleInput(puzzleSession.config, puzzleSession.shownIds);
    if (!input) {
      commitCurrent();
      showView("puzzles");
      return;
    }
    // The next puzzle takes over only if nothing else was opened while it loaded.
    const request = latestNavigation.current;
    // After a game played on from a puzzle, that game stays a step of its own (Back returns to it).
    const fromGame = deps.puzzleSetContinues;
    deps.sampleNextPuzzle(input, {
      onSuccess: (puzzle) => {
        if (request === latestNavigation.current)
          startPuzzle(puzzle, undefined, fromGame ? "push" : "replace");
      },
      onError: (error) => {
        // The puzzle card shows the error on a puzzle; the game's titlebar does after a game.
        if (fromGame && request === latestNavigation.current) {
          currentGame().setMatchFeedback(
            `Couldn't load the next puzzle: ${ipcErrorMessage(error) || "unknown error"}`
          );
        }
      }
    });
  }

  return { solvePuzzleOfTheDay, playEngineFromCurrentPuzzlePosition, startPuzzle, loadNextPuzzle };
}

export type PuzzleCommands = ReturnType<typeof usePuzzleCommands>;
