import { useEffect } from "react";
import { statusForFen } from "@chaturanga/shared/chess/position";
import type { EngineInfo } from "@chaturanga/shared/types/engine";
import { currentLineUcis } from "../features/analysis/engine-game-helpers";
import { useAnalysisStore } from "../stores/analysis-store";
import { remainingClockMs, useGameStore } from "../stores/game-store";

/** Live analysis always asks for the top three lines. */
const ANALYSIS_MULTIPV = 3;
const CLOCK_TICK_MS = 200;
/** Engine lines update the UI at most this often (~6–7 Hz): readable, and cheap to render. */
export const ENGINE_INFO_FLUSH_MS = 150;

function reportEngineError(error: unknown): void {
  const analysis = useAnalysisStore.getState();
  analysis.setStatus("error");
  analysis.setError(error instanceof Error ? error.message : String(error));
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
export function useEngineDriver(defaultEngineId: string | null): void {
  // Engine search output from main.
  useEffect(() => {
    const events = window.chaturanga?.events;
    if (!events) return;
    const infos = createEngineInfoBuffer((batch) => useAnalysisStore.getState().setInfos(batch));
    // A new position discards lines still buffered for the previous one.
    const unsubscribePosition = useGameStore.subscribe((state, previous) => {
      if (state.currentNodeId !== previous.currentNodeId || state.mode !== previous.mode) infos.discard();
    });
    const unsubscribers = [
      events.onEngineInfo((info) => infos.push(info)),
      events.onEngineBestMove((bestMove) => {
        infos.flushNow();
        const game = useGameStore.getState();
        if (game.mode !== "engine" || game.gameOutcome) {
          useAnalysisStore.getState().setBestMove(bestMove.move);
          return;
        }
        playEngineMove(bestMove.move);
      }),
      events.onEngineError((error) => useAnalysisStore.getState().setError(error.message))
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
      if (remainingClockMs(live, live.sideToMove, Date.now()) <= 0) game.resolveTimeout(live.sideToMove);
    };

    const stopAnalysis = () => {
      if (analysisKey === null) return;
      analysisKey = null;
      void engines?.stop();
    };

    const sync = () => {
      scheduled = false;
      if (disposed) return;
      const game = useGameStore.getState();
      const status = statusForFen(game.currentFen);

      // A decided game (mate, resignation, draw, flag) stops any search.
      if (game.gameOutcome && game.gameOutcome !== lastOutcome) {
        analysisKey = null;
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

      // Engine game: ask for a move whenever it is the engine's turn (once per position).
      const enginesTurn =
        game.mode === "engine" && game.engineSide && status.turn === game.engineSide && !status.isEnd && !game.gameOutcome;
      if (engines && enginesTurn && game.engineSide) {
        const key = `${game.rootFen}|${game.currentNodeId}|${game.currentFen}|${game.engineSide}`;
        const engineId = useAnalysisStore.getState().activeEngineId;
        if (key !== engineMoveKey && engineId) {
          engineMoveKey = key;
          const clock = game.getClockForEngineGo();
          useAnalysisStore.getState().setStatus("thinking");
          engines
            .startGame({
              engineId,
              side: game.engineSide,
              fen: game.rootFen,
              moves: currentLineUcis(game.moveTree, game.currentNodeId),
              moveTimeMs: clock ? null : game.moveTimeMs,
              depth: clock ? null : game.depth,
              clock
            })
            .catch(reportEngineError);
        }
      } else {
        engineMoveKey = null;
      }

      // Live analysis of the current position (restarted only when the position changes — not
      // when an arrow is drawn or a header edited).
      if (engines && game.mode === "analysis" && !status.isEnd && !game.gameOutcome) {
        const key = `${game.rootFen}|${game.currentNodeId}|${game.currentFen}|${defaultEngineId ?? ""}`;
        if (key === analysisKey || key === missingEngineKey) return;
        const analysis = useAnalysisStore.getState();
        const engineId = analysis.activeEngineId ?? defaultEngineId;
        if (!engineId) {
          stopAnalysis();
          missingEngineKey = key;
          analysis.setStatus("idle");
          analysis.setError("Configure an engine to start live analysis.");
          return;
        }
        if (analysisKey !== null) void engines.stop();
        analysisKey = key;
        missingEngineKey = null;
        analysis.setActiveEngine(engineId);
        analysis.setError(null);
        analysis.startSearch();
        engines
          .startAnalysis({ engineId, fen: game.rootFen, moves: currentLineUcis(game.moveTree, game.currentNodeId), multipv: ANALYSIS_MULTIPV })
          .catch(reportEngineError);
      } else {
        missingEngineKey = null;
        stopAnalysis();
      }
    };

    // Store updates that belong together (a move, then its clock update) are handled once.
    const unsubscribe = useGameStore.subscribe(() => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(sync);
    });
    sync();
    return () => {
      disposed = true;
      unsubscribe();
      if (clockTimer !== null) clearInterval(clockTimer);
      stopAnalysis();
    };
  }, [defaultEngineId]);
}
