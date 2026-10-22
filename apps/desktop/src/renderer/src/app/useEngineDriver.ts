import { useEffect, useRef } from "react";
import { statusForFen } from "@chaturanga/shared/chess/position";
import type { ChaturangaApi } from "@chaturanga/shared/ipc/chaturanga-api";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { EngineInfo } from "@chaturanga/shared/types/engine";
import type { PlayerRatings } from "@chaturanga/shared/types/ratings";
import { currentLineUcis } from "../features/analysis/engine-game-helpers";
import {
  liveAnalysisSubject,
  type AnalysisSubject,
  type AnalysisTarget
} from "../features/analysis/live-analysis";
import { maiaGameRatings } from "../features/play/engine-game";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useAnalysisStore } from "../stores/analysis-store";
import {
  clockNow,
  latestPlayedNode,
  noteSystemResumed,
  remainingClockMs,
  useGameStore
} from "../stores/game-store";
import { selectLiveGameInProgress, useLichessStore } from "../stores/lichess-store";

/** Live analysis always asks for the top three lines. */
const CLOCK_TICK_MS = 200;
/** Engine lines update the UI at most this often (~6–7 Hz): readable, and cheap to render. */
const ENGINE_INFO_FLUSH_MS = 150;

function reportEngineError(error: unknown): void {
  const analysis = useAnalysisStore.getState();
  analysis.setStatus("error");
  analysis.setError(ipcErrorMessage(error) || String(error));
}

/**
 * The searches whose output is wanted: the engine's move in an engine game, and the live analysis.
 * Engine events carry the id of the search they belong to; output of any other (older) search is
 * dropped, so a best move computed for another position can never be played on this one.
 */
export const engineSearches = {
  move: null as string | null,
  /** The position (node) the engine's move search is for: its move is played there. */
  moveNodeId: null as string | null,
  analysis: null as string | null,
  isCurrent(searchId: string | undefined): boolean {
    return searchId !== undefined && (searchId === this.move || searchId === this.analysis);
  }
};

function newSearchId(): string {
  return crypto.randomUUID();
}

/**
 * Applies a flushed batch of engine lines. The search is rechecked here, not only on arrival: a
 * search replaced on the same position (restartSearch) leaves its lines in the buffer, and they
 * must not refill the cleared analysis.
 */
export function applyEngineInfos(batch: readonly EngineInfo[]): void {
  useAnalysisStore
    .getState()
    .setInfos(batch.filter((info) => engineSearches.isCurrent(info.searchId)));
}

/**
 * The engine's search for its move failed (the engine quit during it): no move is coming, so its
 * clock stops (a dead engine doesn't lose on time). The same position isn't searched again by
 * itself (an engine that quits on it would quit again); stepping away and back asks again.
 */
function endFailedEngineMove(): void {
  engineSearches.move = null;
  engineSearches.moveNodeId = null;
  pauseEnginesClock();
}

/** No search for the engine's move is running (it failed): its clock stops with it. */
function pauseEnginesClock(): void {
  const game = useGameStore.getState();
  if (game.engineClockLive?.sideToMove === game.engineSide) game.pauseEngineClock();
}

/** The engine's move, played where it was asked for (the user may be looking at an earlier move). */
function playEngineMove(move: string, nodeId: string | null): void {
  useAnalysisStore.getState().setBestMove(move);
  if (!useGameStore.getState().makeUciMove(move, nodeId ?? undefined))
    useAnalysisStore.getState().setError(`Illegal engine move: ${move}`);
}

/** Whether `nodeId` is `descendantId` or one of the moves before it (a step back along the game). */
function isOnPathTo(moveTree: readonly MoveNode[], nodeId: string, descendantId: string): boolean {
  const byId = new Map(moveTree.map((node) => [node.id, node]));
  for (let node = byId.get(descendantId); node; node = byId.get(node.parentId ?? "")) {
    if (node.id === nodeId) return true;
  }
  return false;
}

type GameState = ReturnType<typeof useGameStore.getState>;
type PositionStatus = ReturnType<typeof statusForFen>;

/**
 * The user looks at another move while the engine thinks (stepped back through the game, or a
 * timed game's earlier line): it goes on thinking about the game's position, the clock runs on,
 * and its move is played there (playEngineMove). A move of the user's elsewhere (a takeback) makes
 * that the game's position instead. `gameNodeId`: a timed game's latest move (see
 * `syncEngineMove`); `sameMatch`: the running move search belongs to this match.
 */
function engineThinkingAhead(
  game: GameState,
  gameNodeId: string | undefined,
  sameMatch: boolean
): boolean {
  const searchNodeId = engineSearches.moveNodeId;
  return (
    game.mode === "engine" &&
    Boolean(game.engineSide) &&
    !game.gameOutcome &&
    engineSearches.move !== null &&
    searchNodeId !== null &&
    sameMatch &&
    game.currentNodeId !== searchNodeId &&
    (gameNodeId === undefined
      ? isOnPathTo(game.moveTree, game.currentNodeId, searchNodeId)
      : gameNodeId === searchNodeId)
  );
}

/** Whether the engine moves in the position shown (at the game's latest move, in a timed game). */
function isEnginesTurn(
  game: GameState,
  status: PositionStatus,
  gameNodeId: string | undefined
): boolean {
  return (
    game.mode === "engine" &&
    status.turn === game.engineSide &&
    !status.isEnd &&
    !game.gameOutcome &&
    (gameNodeId === undefined || gameNodeId === game.currentNodeId)
  );
}

/** A clock and a timer whose start returns its cancel (tests pass fake ones). */
type Timers = {
  now: () => number;
  start: (callback: () => void, ms: number) => () => void;
};

const defaultTimers: Timers = {
  now: () => performance.now(),
  start: (callback, ms) => {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  }
};

/**
 * Throttles the engine's info stream (dozens of lines a second across MultiPV) into at most one
 * store update per `intervalMs`: the first info after a quiet spell shows at once, the rest are
 * batched into a trailing flush.
 */
export function createEngineInfoBuffer(
  flush: (infos: EngineInfo[]) => void,
  intervalMs = ENGINE_INFO_FLUSH_MS,
  timers: Timers = defaultTimers
) {
  let pending: EngineInfo[] = [];
  let cancelTimer: (() => void) | null = null;
  let lastFlushAt = -Infinity;
  const flushNow = () => {
    cancelTimer?.();
    cancelTimer = null;
    const infos = pending;
    pending = [];
    if (!infos.length) return;
    lastFlushAt = timers.now();
    flush(infos);
  };
  return {
    push(info: EngineInfo) {
      pending.push(info);
      if (cancelTimer) return;
      const wait = intervalMs - (timers.now() - lastFlushAt);
      if (wait <= 0) flushNow();
      else cancelTimer = timers.start(flushNow, wait);
    },
    flushNow,
    discard() {
      cancelTimer?.();
      cancelTimer = null;
      pending = [];
    }
  };
}

/**
 * Runs the engine for the game view: plays the engine's moves in an engine game (with its clock),
 * streams live analysis in analysis mode, and stops the engine once the game is decided.
 * Needs the desktop API; without it (plain-browser preview) engine features are unavailable.
 *
 * It follows the game store with a subscription instead of React state, so the component that
 * mounts it (the app shell) never re-renders because a move was made or the clock ticked.
 */
/** How live analysis runs: which engine, how many lines, and how far (neither depth nor time: until stopped). */
export type AnalysisOptions = {
  engineId: string | null;
  multipv: number;
  depth: number | null;
  moveTimeMs: number | null;
  /** Threads and Hash: the engine process is restarted with them, so a change restarts analysis. */
  resources: string;
};

/**
 * What an engine game's move needs besides the game: your ratings per mode (the rating Maia plays
 * against when the game has none).
 */
type EngineGameContext = { ratings: PlayerRatings | undefined };

export function useEngineDriver(
  analysis: AnalysisOptions,
  gameContext: EngineGameContext = { ratings: undefined }
): void {
  const { engineId: analysisEngineId, multipv, depth, moveTimeMs, resources } = analysis;
  // Read when the engine's move is asked for; never a reason to restart a search.
  const gameContextRef = useRef(gameContext);
  useEffect(() => {
    gameContextRef.current = gameContext;
  });
  // Read by the driver below when it starts a search. Kept out of its dependencies: changing an
  // analysis setting must not tear down an engine game's search (and pause its clock); it only
  // restarts live analysis, through restartSearch.
  const analysisRef = useRef(analysis);
  useEffect(() => {
    const previous = analysisRef.current;
    analysisRef.current = { engineId: analysisEngineId, multipv, depth, moveTimeMs, resources };
    const changed =
      previous.engineId !== analysisEngineId ||
      previous.multipv !== multipv ||
      previous.depth !== depth ||
      previous.moveTimeMs !== moveTimeMs ||
      previous.resources !== resources;
    const analysing =
      useGameStore.getState().mode === "analysis" || useAnalysisStore.getState().target !== null;
    if (changed && analysing) useAnalysisStore.getState().restartSearch();
    // Paused lines are the old engine's: they go, so the new engine's name never heads them.
    if (previous.engineId !== analysisEngineId && useAnalysisStore.getState().paused)
      useAnalysisStore.getState().endPause();
  }, [analysisEngineId, multipv, depth, moveTimeMs, resources]);
  // Engine search output from main.
  useEffect(() => {
    const events = window.chaturanga?.events;
    if (!events) return;
    const infos = createEngineInfoBuffer(applyEngineInfos);
    // A new position discards lines still buffered for the previous one.
    const unsubscribePosition = useGameStore.subscribe((state, previous) => {
      if (state.currentNodeId !== previous.currentNodeId || state.mode !== previous.mode)
        infos.discard();
    });
    // So does another analysis target (the study's next move, or none).
    const unsubscribeTarget = useAnalysisStore.subscribe((state, previous) => {
      if (state.target !== previous.target) infos.discard();
    });
    const unsubscribers = [
      window.chaturanga?.system.onResumed(noteSystemResumed),
      events.onEngineInfo((info) => {
        if (engineSearches.isCurrent(info.searchId)) infos.push(info);
      }),
      events.onEngineBestMove((bestMove) => {
        if (!engineSearches.isCurrent(bestMove.searchId)) return;
        infos.flushNow();
        const game = useGameStore.getState();
        if (
          bestMove.searchId !== engineSearches.move ||
          game.mode !== "engine" ||
          game.gameOutcome
        ) {
          useAnalysisStore.getState().setBestMove(bestMove.move);
          return;
        }
        const nodeId = engineSearches.moveNodeId;
        engineSearches.move = null;
        engineSearches.moveNodeId = null;
        playEngineMove(bestMove.move, nodeId);
      }),
      events.onEngineError((error) => {
        if (error.searchId && !engineSearches.isCurrent(error.searchId)) return;
        // The lines the engine sent before it failed go first: applied after the error, they
        // would show its search as running again.
        infos.flushNow();
        if (error.searchId && error.searchId === engineSearches.move) endFailedEngineMove();
        useAnalysisStore.getState().setError(error.message);
      })
    ];
    return () => {
      infos.discard();
      unsubscribePosition();
      unsubscribeTarget();
      unsubscribers.forEach((unsubscribe) => unsubscribe?.());
    };
  }, []);

  useEffect(() => {
    const engines = window.chaturanga?.engines;
    let lastOutcome = useGameStore.getState().gameOutcome;
    let clockTimer: ReturnType<typeof setInterval> | null = null;
    /** Position the engine was last asked to move in (engine game). */
    let engineMoveKey: string | null = null;
    /** Position being analysed (live analysis), or null when no search of ours runs. */
    let analysisKey: string | null = null;
    /** The analysis target in effect at the last sync (see AnalysisTarget). */
    let lastTarget: AnalysisTarget | null = null;
    /** A search of an analysis target was started (its lines are in the analysis store). */
    let searchedTarget = false;
    /** The searchEpoch when the current target was set (none: the last one's). */
    let targetSetAt = 0;
    /** Last analysis attempt that failed for want of an engine (reported once, not on every update). */
    let missingEngineKey: string | null = null;
    let scheduled = false;
    let disposed = false;

    const checkFlag = () => {
      const game = useGameStore.getState();
      const live = game.engineClockLive;
      if (!live || game.gameOutcome || live.stoppedAt !== undefined) return;
      if (remainingClockMs(live, live.sideToMove, clockNow()) <= 0)
        game.resolveTimeout(live.sideToMove);
    };

    const stopAnalysis = () => {
      if (analysisKey === null) return;
      analysisKey = null;
      engineSearches.analysis = null;
      void engines?.stop();
    };
    /**
     * The engine was thinking about a position that is no longer the game's (a takeback, another
     * board, the match over): its search stops. Its clock is the game's business (it runs on).
     */
    const abandonEngineMove = () => {
      engineMoveKey = null;
      engineMoveGameKey = null;
      if (engineSearches.move === null) return;
      engineSearches.move = null;
      engineSearches.moveNodeId = null;
      void engines?.stop();
    };
    /** Identifies the match, so the engine resets for a new one even from the same position. */
    let gameKey = newSearchId();
    /** The match the running move search belongs to. */
    let engineMoveGameKey: string | null = null;

    const optionsKey = (options: AnalysisOptions) =>
      `${options.engineId ?? ""}|${options.multipv}|${options.depth ?? ""}|${options.moveTimeMs ?? ""}|${useAnalysisStore.getState().searchEpoch}`;

    // A target cleared (the study's engine panel closed, Study left): its search stops and its
    // lines go (an engine game's own state stays). The engine goes back to the board: its
    // analysis searches again if the board was asked for since the target was set (Back to an
    // analysis board, Analyze on it: restartBoardSearch, before or after the panel unmounts).
    // Otherwise it doesn't resume behind Study: it was stopped when the board was left, and
    // searches again when the board is shown or its position changes.
    const followTarget = (game: GameState, target: AnalysisTarget | null) => {
      if (lastTarget && !target) {
        if (searchedTarget) {
          stopAnalysis();
          useAnalysisStore.getState().reset();
        }
        searchedTarget = false;
        missingEngineKey = null;
        const boardWanted = useAnalysisStore.getState().boardSearchEpoch > targetSetAt;
        const board = boardWanted ? null : liveAnalysisSubject(game);
        analysisKey = board ? `${board.key}|${optionsKey(analysisRef.current)}` : null;
      }
      lastTarget = target;
    };

    // A decided game (mate, resignation, draw, flag) stops any search.
    const stopOnDecidedGame = (game: GameState) => {
      if (game.gameOutcome && game.gameOutcome !== lastOutcome) {
        analysisKey = null;
        engineSearches.move = null;
        engineSearches.moveNodeId = null;
        engineSearches.analysis = null;
        void engines?.stop();
        useAnalysisStore.getState().reset();
      }
      lastOutcome = game.gameOutcome;
    };

    // Engine-game clock: flag the side to move when its time runs out.
    const syncClock = (game: GameState) => {
      const clockRunning =
        game.mode === "engine" &&
        Boolean(game.engineClock && game.engineClockLive) &&
        !game.gameOutcome &&
        game.engineClockLive?.stoppedAt === undefined;
      if (clockRunning && clockTimer === null) clockTimer = setInterval(checkFlag, CLOCK_TICK_MS);
      if (!clockRunning && clockTimer !== null) {
        clearInterval(clockTimer);
        clockTimer = null;
      }
    };

    const syncEngineMove = (game: GameState, status: PositionStatus) => {
      // A timed game is played at its latest move: another one looked at isn't a position to move in.
      const gameNodeId = game.engineClock ? latestPlayedNode(game.moveTree)?.id : undefined;
      if (engineThinkingAhead(game, gameNodeId, engineMoveGameKey === gameKey)) {
        // Its search stays as it is.
      } else if (engines && game.engineSide && isEnginesTurn(game, status, gameNodeId)) {
        requestEngineMove(engines, game, game.engineSide);
      } else {
        // Not the engine's turn here (its move was played, or the user stepped to another move):
        // a search still running is for a position the engine no longer moves in.
        abandonEngineMove();
      }
    };

    // Engine game: ask for a move whenever it is the engine's turn (once per position).
    const requestEngineMove = (
      engines: ChaturangaApi["engines"],
      game: GameState,
      engineSide: NonNullable<GameState["engineSide"]>
    ) => {
      // The match too: a new game from the same position (and side) still needs its first move.
      const key = `${gameKey}|${game.rootFen}|${game.currentNodeId}|${game.currentFen}|${engineSide}`;
      const engineId = useAnalysisStore.getState().activeEngineId;
      if (key === engineMoveKey || !engineId) return;
      engineMoveKey = key;
      engineMoveGameKey = gameKey;
      const searchId = newSearchId();
      engineSearches.move = searchId;
      engineSearches.moveNodeId = game.currentNodeId;
      game.resumeEngineClock();
      const clock = useGameStore.getState().getClockForEngineGo();
      useAnalysisStore.getState().setStatus("thinking");
      // Maia plays at the rating the game names it with, against yours. Sent with every engine
      // game (main reads it only for the Maia row), so it never depends on the engine list having
      // loaded: without it Maia would play at its default rating.
      const maia = maiaGameRatings(game.headers, engineSide, gameContextRef.current.ratings);
      engines
        .startGame({
          engineId,
          searchId,
          gameKey,
          side: engineSide,
          fen: game.rootFen,
          moves: currentLineUcis(game.moveTree, game.currentNodeId),
          moveTimeMs: clock ? null : game.moveTimeMs,
          depth: clock ? null : game.depth,
          clock,
          maia
        })
        .catch((error: unknown) => {
          if (engineSearches.move !== searchId) return;
          // No search is running: the engine's clock stops with it (no flag for a failed start).
          abandonEngineMove();
          pauseEnginesClock();
          reportEngineError(error);
        });
    };

    // Live analysis of the current position (restarted only when the position changes — not
    // when an arrow is drawn or a header edited).
    const syncAnalysis = (subject: AnalysisSubject | null, target: AnalysisTarget | null) => {
      if (!engines || !subject) {
        missingEngineKey = null;
        stopAnalysis();
        // Nothing searches now: a Restart pending since doesn't carry over to a later search.
        useAnalysisStore.getState().cancelFreshSearch();
        return;
      }
      const options = analysisRef.current;
      const key = `${subject.key}|${optionsKey(options)}`;
      if (key === analysisKey || key === missingEngineKey) return;
      if (target) searchedTarget = true;
      const analysis = useAnalysisStore.getState();
      // The engine chosen for analysis (or the default), never an engine-game opponent left over.
      const engineId = options.engineId;
      if (!engineId) {
        stopAnalysis();
        analysis.cancelFreshSearch();
        missingEngineKey = key;
        analysis.setStatus("idle");
        analysis.setError("Configure an engine to start live analysis.");
        return;
      }
      // The main process stops the previous search before it starts this one.
      analysisKey = key;
      missingEngineKey = null;
      const searchId = newSearchId();
      engineSearches.analysis = searchId;
      analysis.setActiveEngine(engineId);
      analysis.setError(null);
      // Restart asked for a search from scratch: the engine clears its hash too.
      const fresh = analysis.freshSearch;
      // Lines already found for this position (with this engine, line count and search limit)
      // show at once; only this search's own lines are remembered.
      analysis.startSearch(
        `${subject.fen}|${engineId}|${options.multipv}|${options.depth ?? ""}|${options.moveTimeMs ?? ""}`,
        searchId,
        subject.fen
      );
      engines
        .startAnalysis({
          engineId,
          searchId,
          fen: subject.rootFen,
          moves: subject.moves(),
          multipv: options.multipv,
          depth: options.depth,
          moveTimeMs: options.moveTimeMs,
          fresh
        })
        .catch((error: unknown) => {
          if (engineSearches.analysis === searchId) reportEngineError(error);
        });
    };

    const sync = () => {
      scheduled = false;
      if (disposed) return;
      const game = useGameStore.getState();
      const status = statusForFen(game.currentFen);
      const target = useAnalysisStore.getState().target;
      followTarget(game, target);
      const subject = liveAnalysisSubject(game, {
        target,
        onlineGameLive: selectLiveGameInProgress(useLichessStore.getState())
      });
      stopOnDecidedGame(game);
      syncClock(game);
      // Leaving live analysis (e.g. for an engine game) stops it first: its `stop` ends the latest
      // search in main, which would otherwise be the game search asked for just below. A target's
      // search goes on whatever the board's mode (it only runs while no game holds the engine).
      if (game.mode !== "analysis" && !(target && subject)) stopAnalysis();
      syncEngineMove(game, status);
      syncAnalysis(subject, target);
    };

    // Store updates that belong together (a move, then its clock update) are handled once.
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(sync);
    };
    const unsubscribe = useGameStore.subscribe((state, previous) => {
      // A new board (reset / load replaces headers and tree together) is a new match.
      const newBoard = state.headers !== previous.headers && state.moveTree !== previous.moveTree;
      if (newBoard) gameKey = newSearchId();
      // A pause belongs to its board and move: it ends when the board is replaced (by any path)
      // or the paused move is deleted.
      const { paused } = useAnalysisStore.getState();
      if (
        paused &&
        state.moveTree !== previous.moveTree &&
        (newBoard || !state.moveTree.some((node) => node.id === paused.nodeId))
      )
        useAnalysisStore.getState().endPause();
      schedule();
    });
    // A requested restart (restartSearch) re-runs the analysis for the same position; a target set,
    // moved or cleared changes what it searches.
    const unsubscribeRestart = useAnalysisStore.subscribe((state, previous) => {
      if (state.target && !previous.target) targetSetAt = state.searchEpoch;
      if (state.searchEpoch !== previous.searchEpoch || state.target !== previous.target)
        schedule();
    });
    sync();
    return () => {
      disposed = true;
      unsubscribe();
      unsubscribeRestart();
      if (clockTimer !== null) clearInterval(clockTimer);
      stopAnalysis();
      abandonEngineMove();
    };
  }, []);
}
