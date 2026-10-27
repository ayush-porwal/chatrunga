import { exportGameToPgn } from "@chaturanga/shared/chess/pgn";
import type { ImportedGame } from "@chaturanga/shared/types/chess";
import type { GamePuzzle } from "@chaturanga/shared/types/game-puzzles";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { positionStatus } from "@/lib/position-status";
import { pausedAnalysisAt } from "../features/analysis/live-analysis";
import { boardResultPatch } from "../features/analysis/post-game";
import type { ReviewTab } from "../features/game-review/review-utils";
import { mainlineEnd } from "../features/game/move-tree-model";
import { openSavedGame } from "../features/game/saved-game";
import { gamePuzzleNodeId } from "../features/puzzles/game-puzzle-set";
import { useAnalysisStore } from "../stores/analysis-store";
import { useAppNoticeStore } from "../stores/app-notice-store";
import { useGameStore } from "../stores/game-store";
import {
  selectDisplayedMoves,
  selectDisplayedOpening,
  useReviewStore
} from "../stores/review-store";
import { compatibleReviewMoves } from "../stores/review-validity";
import { currentGame, type AppNavigation } from "./app-navigation";
import { ENGINE_MOVE_TIME_MS, planRejoin } from "./rejoin-saved-game";
import { flushGameAutosave, IMPORT_NEEDS_SAVE } from "./useGameAutosave";

/** What the board commands need from the shell besides its navigation. */
type BoardCommandDeps = {
  engines: readonly EngineConfig[] | undefined;
  setReviewTab: (tab: ReviewTab) => void;
  setImportOpen: (open: boolean) => void;
  setGameReviewPickerOpen: (open: boolean) => void;
  startReview: () => Promise<void>;
};

/**
 * The commands that put a game on the board or change what it does there: files in and out,
 * saved games, live analysis and Game review.
 *
 * Not a React hook (it calls none): it rebuilds its commands every render like the nested functions
 * it replaced, and takes the use- name only because the React Compiler's lint (react/refs) lets a
 * hook, not a plain function, receive the shell's refs during render.
 */
export function useBoardCommands(nav: AppNavigation, deps: BoardCommandDeps) {
  const {
    latestNavigation,
    navigate,
    commitCurrent,
    record,
    historyEntry,
    stopEngineWork,
    endBoardActivity,
    clearPuzzleSession,
    puzzleSession,
    setFocusMode,
    showGame
  } = nav;

  /**
   * Play → Start: a new engine game replaces the board. The previous game's search and review end
   * here — a late best move or a finished review must not land in (or be saved with) the new game.
   */
  function beforeEngineGame() {
    commitCurrent();
    ++latestNavigation.current;
    stopEngineWork();
    useReviewStore.getState().reset();
    clearPuzzleSession();
  }

  async function exportPgn() {
    if (!window.chaturanga) return;
    try {
      // With the analysis as the move list shows it (marks, evals, best lines, the opening).
      const { headers, moveTree } = currentGame();
      const review = useReviewStore.getState();
      const moves = compatibleReviewMoves(selectDisplayedMoves(review), moveTree);
      const opening = selectDisplayedOpening(review);
      // The opening only while the game still plays the move that reached it.
      const reached = moves.some((move) => move.ply === opening?.ply);
      const pgn = exportGameToPgn({
        headers,
        moveTree,
        analysis: { moves, opening: reached ? opening : null }
      });
      await window.chaturanga.files.savePgnFile("chaturanga-game.pgn", pgn);
    } catch (error) {
      useAppNoticeStore
        .getState()
        .show(`Couldn't export the PGN: ${ipcErrorMessage(error) || "unknown error"}`);
    }
  }

  async function importPgnFile() {
    if (!window.chaturanga) return;
    const request = ++latestNavigation.current;
    try {
      const file = await window.chaturanga.files.openPgnFile();
      if (!file || request !== latestNavigation.current) return;
      // Pending edits first: the library's check for a copy must see the board as it is. If they
      // couldn't be saved, importing could add a copy of this very game: stop and say so.
      if (!(await flushGameAutosave())) {
        if (request === latestNavigation.current)
          useAppNoticeStore.getState().show(IMPORT_NEEDS_SAVE);
        return;
      }
      const imported = await window.chaturanga.games.importPgn({ pgn: file.contents });
      // A Lichess game (or another navigation) started meanwhile: it keeps the board.
      if (request !== latestNavigation.current) return;
      loadImportedGame(imported);
    } catch (error) {
      // Shown where you are (no navigation: the board didn't change).
      if (request === latestNavigation.current) {
        useAppNoticeStore
          .getState()
          .show(`Couldn't import that file: ${ipcErrorMessage(error) || "unknown error"}`);
      }
    }
  }

  /** An imported PGN (file or the paste dialog) onto the board; a warning (only the first of several games) shows on it. */
  function loadImportedGame(imported: ImportedGame) {
    // Already in the library: open that copy (with its analyses) rather than a duplicate.
    if (imported.existingGameId) {
      const existing = imported.existingGameId;
      void openSavedGameById(existing).then(() => {
        if (currentGame().gameId === existing)
          currentGame().setMatchFeedback("Already in your library: opened your copy.");
      });
      return;
    }
    commitCurrent();
    endBoardActivity();
    currentGame().loadGame(imported.game);
    currentGame().setMode("freeplay");
    if (imported.warning) currentGame().setMatchFeedback(imported.warning);
    showGame();
  }

  /** A Lichess game of yours began: clear the board's other activity, load it (`load`) and show it. */
  function startOnlineGame(load: () => void) {
    commitCurrent();
    // Close anything that could still load another game onto the board (showGame below also
    // invalidates board loads in flight: an import or a saved game resolving after this point).
    deps.setImportOpen(false);
    deps.setGameReviewPickerOpen(false);
    endBoardActivity();
    setFocusMode(false);
    load();
    showGame();
  }

  /** Play → Free board: an empty board to play both sides. */
  function startFreeBoard() {
    commitCurrent();
    endBoardActivity();
    currentGame().reset();
    currentGame().setOrientation("white");
    setFocusMode(false);
    showGame();
  }

  function startLiveAnalysis() {
    if (!nav.desktopApiAvailable) return;
    commitCurrent();
    stopEngineWork();
    // The board's review stays: it belongs to this game, and clearing it here made autosave write
    // "no review" over the saved one (the titlebar's Analyze keeps it too). A review still running
    // is left (cancelled above): its late result must not replace the saved review.
    useReviewStore.getState().detachRun();
    clearPuzzleSession();
    // An analysis board, engine off: the Moves tab's engine row offers the Analysis switch.
    currentGame().setMode("freeplay");
    // Where the game came from stays (an imported or online game keeps its library tab).
    currentGame().startAnalysisBoard();
    currentGame().setEngineSide(null);
    currentGame().clearEngineMatchExtras();
    setFocusMode(false);
    showGame("notation");
  }

  /**
   * The Analysis switch turned off: leave live analysis but keep the position and moves (not a step
   * of its own). Its search stops, paused: the lines found stay (the switch on again resumes).
   */
  function stopLiveAnalysis() {
    latestNavigation.current += 1;
    const { moveTree, currentNodeId, currentFen } = currentGame();
    useAnalysisStore.getState().pause(pausedAnalysisAt(moveTree, currentNodeId, currentFen));
    currentGame().setMode("freeplay");
    record("replace", historyEntry("game"));
  }

  /**
   * "Analyze" in the titlebar / Moves tab: analyse the loaded game in place (keeps moves and
   * review). A finished match's result and clocks are cleared (the headers keep the result): with
   * them the board refuses moves and the engine won't search. Back returns to the game as it was.
   * From a finished position (after mate or stalemate), analysis starts at the move that ended it.
   */
  function analyzeCurrentPosition() {
    if (!nav.desktopApiAvailable) return;
    commitCurrent();
    // A board still loading (Back / Forward, a saved game) must not replace this one afterwards.
    latestNavigation.current += 1;
    const { currentFen, currentNodeId, moveTree } = currentGame();
    const parentId = moveTree.find((node) => node.id === currentNodeId)?.parentId;
    if (positionStatus(currentFen).isEnd && parentId) currentGame().goToNode(parentId);
    currentGame().setEngineSide(null);
    currentGame().clearEngineMatchExtras();
    currentGame().setMode("analysis");
    useAnalysisStore.getState().restartBoardSearch();
    record("push", historyEntry("game"));
  }

  async function openSelectedGameReview(gameId: string, tab: ReviewTab = "summary") {
    commitCurrent();
    const request = ++latestNavigation.current;
    if (gameId !== "current" && gameId !== currentGame().gameId) {
      // Load the other game first and swap board + review together. Clearing the current
      // review before the new game arrives would let autosave write the current game without
      // its review, and the review route would show the wrong board meanwhile.
      const saved = await window.chaturanga?.games.get(gameId).catch(() => null);
      if (request !== latestNavigation.current) return;
      if (!saved) {
        useGameStore.setState({ lastError: "Couldn't open that game." });
        return;
      }
      stopEngineWork();
      clearPuzzleSession();
      openSavedGame(saved);
    } else {
      // Its pending changes are written first, so the URL below names a game a reload can find
      // (a failed save keeps its own Retry; the review still opens).
      await flushGameAutosave();
      if (request !== latestNavigation.current) return;
      stopEngineWork();
      // Back from the review returns to a game played on from a puzzle with its Next puzzle.
      puzzleSession.release(currentGame().board);
    }
    currentGame().setMode("freeplay");
    currentGame().setEngineSide(null);
    currentGame().clearEngineMatchExtras();
    setFocusMode(false);
    deps.setReviewTab(tab);
    deps.setGameReviewPickerOpen(false);
    // A saved game's own id, so a reload can reopen it ("current" only for one never saved).
    const routeId = currentGame().gameId ?? "current";
    nav.setView("game-review", () => void navigate(`/games/${routeId}/review`, { replace: true }));
    record("push", historyEntry("game-review"));
  }

  /**
   * Play's Recent games / the library: the board with that saved game (the loaded game is kept as
   * is). With `nodeId` (a repertoire source link), the board then shows that move when the game has
   * it. True once the game is shown; false when it couldn't be read or a newer navigation won.
   */
  async function openSavedGameById(gameId: string, nodeId: string | null = null): Promise<boolean> {
    commitCurrent();
    const request = ++latestNavigation.current;
    if (gameId !== currentGame().gameId) {
      if (!window.chaturanga) return false;
      const saved = await window.chaturanga.games.get(gameId).catch(() => null);
      if (request !== latestNavigation.current) return false;
      if (!saved) {
        useGameStore.setState({ lastError: "Couldn't open that game." });
        return false;
      }
      stopEngineWork();
      clearPuzzleSession();
      openSavedGame(saved);
      currentGame().setMode("freeplay");
      currentGame().setEngineSide(null);
      currentGame().clearEngineMatchExtras();
    }
    if (nodeId) currentGame().goToNode(nodeId);
    setFocusMode(false);
    showGame();
    return true;
  }

  /**
   * A "From my games" puzzle's Open game: its saved game on the board at the move played from the
   * puzzle position (the game's start when that move isn't found).
   */
  async function openGamePuzzleGame(puzzle: Pick<GamePuzzle, "gameId" | "ply" | "playedMove">) {
    if (!(await openSavedGameById(puzzle.gameId))) return;
    const nodeId = gamePuzzleNodeId(currentGame().moveTree, puzzle);
    if (!nodeId) return;
    currentGame().goToNode(nodeId);
    // The entry pushed when the game opened now names that move.
    record("replace", historyEntry("game"));
  }

  /**
   * Play's In progress card on a saved engine game: the game opens and, when its engine is
   * installed and available, the match goes on from its latest move against it. A timed game goes
   * on with the time each side has now (the side to move's clock ran while it was away), and one
   * whose time ran out meanwhile opens lost on time; a game saved without its clocks goes on
   * untimed, at the no-clock think time. Otherwise it is only opened, with a notice saying why.
   */
  async function rejoinSavedGame(gameId: string) {
    if (!(await openSavedGameById(gameId))) return;
    const game = currentGame();
    const plan = planRejoin(game, deps.engines ?? [], Date.now());
    if (plan.kind === "open") {
      if (plan.notice)
        useAppNoticeStore
          .getState()
          .show(plan.notice.message, { tone: "info", maia3Download: plan.notice.offerMaia3 });
      return;
    }
    game.goToNode(plan.nodeId);
    if (plan.kind === "finished") return;
    stopEngineWork();
    game.setOrientation(plan.humanSide);
    game.setGameSource("engine-game");
    game.setMode("engine");
    game.setEngineSide(plan.engineSide);
    game.setEngineLimits(ENGINE_MOVE_TIME_MS, null);
    game.setEngineMatchClock(null);
    game.clearEngineMatchExtras();
    game.setMatchFeedback(null);
    if (plan.clock) {
      game.setEngineMatchClock(plan.clock.config);
      game.setMatchClock({
        whiteMs: plan.clock.whiteMs,
        blackMs: plan.clock.blackMs,
        sideToMove: plan.clock.sideToMove,
        running: true
      });
    }
    // Out of time while away: the game ends on time now (and is saved with its result).
    if (plan.kind === "timed-out") game.resolveTimeout(plan.clock.sideToMove);
    const analysis = useAnalysisStore.getState();
    analysis.setActiveEngine(plan.engine.id);
    analysis.setError(null);
    analysis.setStatus("ready");
    // The entry pushed when the game opened now names the match.
    record("replace", historyEntry("game"));
  }

  /**
   * After an engine game (one played on from a puzzle too): Game review of it, its review started
   * at once unless it already has one.
   */
  async function reviewFinishedEngineGame() {
    const request = ++latestNavigation.current;
    // The game's library id (its first save may still be waiting) names what the review saves to.
    await flushGameAutosave();
    if (request !== latestNavigation.current) return;
    // Ended on the board (mate, stalemate): the review shows its result like a resignation's.
    const game = currentGame();
    const result = boardResultPatch({
      gameOutcome: game.gameOutcome,
      headers: game.headers,
      endFen: mainlineEnd(game.moveTree)?.fenAfter ?? game.currentFen
    });
    if (result) game.patchHeaders(result);
    const reviewed = Boolean(useReviewStore.getState().review);
    await openSelectedGameReview("current");
    if (!reviewed) void deps.startReview();
  }

  return {
    beforeEngineGame,
    exportPgn,
    importPgnFile,
    loadImportedGame,
    startOnlineGame,
    startFreeBoard,
    startLiveAnalysis,
    stopLiveAnalysis,
    analyzeCurrentPosition,
    openSelectedGameReview,
    openSavedGameById,
    openGamePuzzleGame,
    rejoinSavedGame,
    reviewFinishedEngineGame
  };
}

export type BoardCommands = ReturnType<typeof useBoardCommands>;
