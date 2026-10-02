import { useEffect, useRef } from "react";
import { statusForFen } from "@chaturanga/shared/chess/position";
import type { EngineInfo } from "@chaturanga/shared/types/engine";
import { currentLineUcis } from "../features/analysis/engine-game-helpers";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useAnalysisStore } from "../stores/analysis-store";
import { clockNow, noteSystemResumed, remainingClockMs, useGameStore } from "../stores/game-store";

/** Live analysis always asks for the top three lines. */
const CLOCK_TICK_MS = 200;
/** Engine lines update the UI at most this often (~6–7 Hz): readable, and cheap to render. */
export const ENGINE_INFO_FLUSH_MS = 150;

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
  useAnalysisStore.getState().setInfos(batch.filter((info) => engineSearches.isCurrent(info.searchId)));
}

function playEngineMove(move: string): void {
  useAnalysisStore.getState().setBestMove(move);
  if (!useGameStore.getState().makeUciMove(move)) useAnalysisStore.getState().setError(`Illegal engine move: ${move}`);
}

type Timers = {
  now: () => number;
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const defaultTimers: Timers = {
  now: () => performance.now(),
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
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
  let timer: unknown = null;
  let lastFlushAt = -Infinity;
  const flushNow = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
    const infos = pending;
    pending = [];
    if (!infos.length) return;
    lastFlushAt = timers.now();
    flush(infos);
  };
  return {
    push(info: EngineInfo) {
      pending.push(info);
      if (timer !== null) return;
      const wait = intervalMs - (timers.now() - lastFlushAt);
      if (wait <= 0) flushNow();
      else timer = timers.set(flushNow, wait);
    },
    flushNow,
    discard() {
      if (timer !== null) timers.clear(timer);
      timer = null;
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
};

export function useEngineDriver(analysis: AnalysisOptions): void {
  const { engineId: analysisEngineId, multipv, depth, moveTimeMs } = analysis;
  // Read by the driver below when it starts a search. Kept out of its dependencies: changing an
  // analysis setting must not tear down an engine game's search (and pause its clock); it only
  // restarts live analysis, through restartSearch.
  const analysisRef = useRef(analysis);
  useEffect(() => {
    const previous = analysisRef.current;
    analysisRef.current = { engineId: analysisEngineId, multipv, depth, moveTimeMs };
    const changed =
      previous.engineId !== analysisEngineId ||
      previous.multipv !== multipv ||
      previous.depth !== depth ||
      previous.moveTimeMs !== moveTimeMs;
    if (changed && useGameStore.getState().mode === "analysis") useAnalysisStore.getState().restartSearch();
  }, [analysisEngineId, multipv, depth, moveTimeMs]);
  // Engine search output from main.
  useEffect(() => {
    const events = window.chaturanga?.events;
    if (!events) return;
    const infos = createEngineInfoBuffer(applyEngineInfos);
    // A new position discards lines still buffered for the previous one.
    const unsubscribePosition = useGameStore.subscribe((state, previous) => {
      if (state.currentNodeId !== previous.currentNodeId || state.mode !== previous.mode) infos.discard();
    });
    const unsubscribers = [
      window.chaturanga?.system?.onResumed?.(noteSystemResumed) ?? (() => {}),
      events.onEngineInfo((info) => {
        if (engineSearches.isCurrent(info.searchId)) infos.push(info);
      }),
      events.onEngineBestMove((bestMove) => {
        if (!engineSearches.isCurrent(bestMove.searchId)) return;
        infos.flushNow();
        const game = useGameStore.getState();
        if (bestMove.searchId !== engineSearches.move || game.mode !== "engine" || game.gameOutcome) {
          useAnalysisStore.getState().setBestMove(bestMove.move);
          return;
        }
        engineSearches.move = null;
        playEngineMove(bestMove.move);
      }),
      events.onEngineError((error) => {
        if (error.searchId && !engineSearches.isCurrent(error.searchId)) return;
        useAnalysisStore.getState().setError(error.message);
      })
    ];
    return () => {
      infos.discard();
      unsubscribePosition();
      unsubscribers.forEach((unsubscribe) => unsubscribe());
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
    /** Last analysis attempt that failed for want of an engine (reported once, not on every update). */
    let missingEngineKey: string | null = null;
    let scheduled = false;
    let disposed = false;

    const checkFlag = () => {
      const game = useGameStore.getState();
      const live = game.engineClockLive;
      if (!live || game.gameOutcome || live.stoppedAt !== undefined) return;
      if (remainingClockMs(live, live.sideToMove, clockNow()) <= 0) game.resolveTimeout(live.sideToMove);
    };

    const stopAnalysis = () => {
      if (analysisKey === null) return;
      analysisKey = null;
      engineSearches.analysis = null;
      void engines?.stop();
    };
    /**
     * The engine was thinking about a position that is no longer the one on the board (the user
     * stepped back). Its search stops, and so does its clock until it's asked to move again.
     */
    const abandonEngineMove = () => {
      engineMoveKey = null;
      if (engineSearches.move === null) return;
      engineSearches.move = null;
      void engines?.stop();
      const game = useGameStore.getState();
      if (game.engineClockLive?.sideToMove === game.engineSide) game.pauseEngineClock();
    };
    /** Identifies the match, so the engine resets for a new one even from the same position. */
    let gameKey = newSearchId();

    const sync = () => {
      scheduled = false;
      if (disposed) return;
      const game = useGameStore.getState();
      const status = statusForFen(game.currentFen);

      // A decided game (mate, resignation, draw, flag) stops any search.
      if (game.gameOutcome && game.gameOutcome !== lastOutcome) {
        analysisKey = null;
        engineSearches.move = null;
        engineSearches.analysis = null;
        void engines?.stop();
        useAnalysisStore.getState().reset();
      }
      lastOutcome = game.gameOutcome;

      // Engine-game clock: flag the side to move when its time runs out.
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

      // Leaving live analysis (e.g. for an engine game) stops it first: its `stop` ends the latest
      // search in main, which would otherwise be the game search asked for just below.
      if (game.mode !== "analysis") stopAnalysis();

      // Engine game: ask for a move whenever it is the engine's turn (once per position).
      const enginesTurn =
        game.mode === "engine" && game.engineSide && status.turn === game.engineSide && !status.isEnd && !game.gameOutcome;
      if (engines && enginesTurn && game.engineSide) {
        // The match too: a new game from the same position (and side) still needs its first move.
        const key = `${gameKey}|${game.rootFen}|${game.currentNodeId}|${game.currentFen}|${game.engineSide}`;
        const engineId = useAnalysisStore.getState().activeEngineId;
        if (key !== engineMoveKey && engineId) {
          engineMoveKey = key;
          const searchId = newSearchId();
          engineSearches.move = searchId;
          game.resumeEngineClock();
          const clock = useGameStore.getState().getClockForEngineGo();
          useAnalysisStore.getState().setStatus("thinking");
          engines
            .startGame({
              engineId,
              searchId,
              gameKey,
              side: game.engineSide,
              fen: game.rootFen,
              moves: currentLineUcis(game.moveTree, game.currentNodeId),
              moveTimeMs: clock ? null : game.moveTimeMs,
              depth: clock ? null : game.depth,
              clock
            })
            .catch((error: unknown) => {
              if (engineSearches.move !== searchId) return;
              // No search is running: the engine's clock stops with it (no flag for a failed start).
              abandonEngineMove();
              reportEngineError(error);
            });
        }
      } else {
        // Not the engine's turn here (its move was played, or the user stepped to another move):
        // a search still running is for a position the engine no longer moves in.
        abandonEngineMove();
      }

      // Live analysis of the current position (restarted only when the position changes — not
      // when an arrow is drawn or a header edited).
      if (engines && game.mode === "analysis" && !status.isEnd && !game.gameOutcome) {
        const options = analysisRef.current;
        const key = `${game.rootFen}|${game.currentNodeId}|${game.currentFen}|${options.engineId ?? ""}|${options.multipv}|${options.depth ?? ""}|${options.moveTimeMs ?? ""}|${useAnalysisStore.getState().searchEpoch}`;
        if (key === analysisKey || key === missingEngineKey) return;
        const analysis = useAnalysisStore.getState();
        // The engine chosen for analysis (or the default), never an engine-game opponent left over.
        const engineId = options.engineId;
        if (!engineId) {
          stopAnalysis();
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
        analysis.startSearch();
        engines
          .startAnalysis({
            engineId,
            searchId,
            fen: game.rootFen,
            moves: currentLineUcis(game.moveTree, game.currentNodeId),
            multipv: options.multipv,
            depth: options.depth,
            moveTimeMs: options.moveTimeMs
          })
          .catch((error: unknown) => {
            if (engineSearches.analysis === searchId) reportEngineError(error);
          });
      } else {
        missingEngineKey = null;
        stopAnalysis();
      }
    };

    // Store updates that belong together (a move, then its clock update) are handled once.
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(sync);
    };
    const unsubscribe = useGameStore.subscribe((state, previous) => {
      // A new board (reset / load replaces headers and tree together) is a new match.
      if (state.headers !== previous.headers && state.moveTree !== previous.moveTree) gameKey = newSearchId();
      schedule();
    });
    // A requested restart (restartSearch) re-runs the analysis for the same position.
    const unsubscribeRestart = useAnalysisStore.subscribe((state, previous) => {
      if (state.searchEpoch !== previous.searchEpoch) schedule();
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
