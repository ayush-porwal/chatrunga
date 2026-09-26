import { useEffect, useMemo } from "react";
import { statusForFen } from "@chaturanga/shared/chess/position";
import { currentLineUcis } from "../features/analysis/engine-game-helpers";
import { useAnalysisStore } from "../stores/analysis-store";
import { useGameStore } from "../stores/game-store";

/** Live analysis always asks for the top three lines. */
const ANALYSIS_MULTIPV = 3;
const CLOCK_TICK_MS = 200;

function reportEngineError(error: unknown): void {
  const analysis = useAnalysisStore.getState();
  analysis.setStatus("error");
  analysis.setError(error instanceof Error ? error.message : String(error));
}

function playEngineMove(move: string): void {
  useAnalysisStore.getState().setBestMove(move);
  if (!useGameStore.getState().makeUciMove(move)) useAnalysisStore.getState().setError(`Illegal engine move: ${move}`);
}

/**
 * Runs the engine for the game view: plays the engine's moves in an engine game (with its clock),
 * streams live analysis in analysis mode, and stops the engine once the game is decided.
 * Needs the desktop API; without it (plain-browser preview) engine features are unavailable.
 */
export function useEngineDriver(defaultEngineId: string | null): void {
  const currentFen = useGameStore((state) => state.currentFen);
  const currentNodeId = useGameStore((state) => state.currentNodeId);
  const moveTree = useGameStore((state) => state.moveTree);
  const rootFen = useGameStore((state) => state.rootFen);
  const mode = useGameStore((state) => state.mode);
  const engineSide = useGameStore((state) => state.engineSide);
  const moveTimeMs = useGameStore((state) => state.moveTimeMs);
  const depth = useGameStore((state) => state.depth);
  const engineClock = useGameStore((state) => state.engineClock);
  const engineClockLive = useGameStore((state) => state.engineClockLive);
  const gameOutcome = useGameStore((state) => state.gameOutcome);
  const status = useMemo(() => statusForFen(currentFen), [currentFen]);

  // Engine search output from main.
  useEffect(() => {
    const events = window.chaturanga?.events;
    if (!events) return;
    const unsubscribers = [
      events.onEngineInfo((info) => useAnalysisStore.getState().setInfo(info)),
      events.onEngineBestMove((bestMove) => {
        const game = useGameStore.getState();
        if (game.mode !== "engine" || game.gameOutcome) {
          useAnalysisStore.getState().setBestMove(bestMove.move);
          return;
        }
        playEngineMove(bestMove.move);
      }),
      events.onEngineError((error) => useAnalysisStore.getState().setError(error.message))
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  // A decided game (mate, resignation, draw, flag) stops any search.
  useEffect(() => {
    if (!gameOutcome) return;
    void window.chaturanga?.engines.stop();
    useAnalysisStore.getState().reset();
  }, [gameOutcome]);

  // Engine-game clock: flag the side to move when its time runs out.
  useEffect(() => {
    if (mode !== "engine" || !engineClock || !engineClockLive || gameOutcome) return;
    const tick = window.setInterval(() => {
      const game = useGameStore.getState();
      const live = game.engineClockLive;
      if (!live || game.gameOutcome) return;
      const budget = live.sideToMove === "white" ? live.whiteMs : live.blackMs;
      if (budget - (Date.now() - live.turnStartedAt) <= 0) game.resolveTimeout(live.sideToMove);
    }, CLOCK_TICK_MS);
    return () => window.clearInterval(tick);
  }, [mode, engineClock, engineClockLive, gameOutcome, currentFen]);

  // Engine game: ask for a move whenever it is the engine's turn.
  useEffect(() => {
    const engines = window.chaturanga?.engines;
    if (!engines || mode !== "engine" || !engineSide || status.turn !== engineSide || status.isEnd || gameOutcome) return;
    const engineId = useAnalysisStore.getState().activeEngineId;
    if (!engineId) return;
    const clock = useGameStore.getState().getClockForEngineGo();
    useAnalysisStore.getState().setStatus("thinking");
    engines
      .startGame({
        engineId,
        side: engineSide,
        fen: rootFen,
        moves: currentLineUcis(moveTree, currentNodeId),
        moveTimeMs: clock ? null : moveTimeMs,
        depth: clock ? null : depth,
        clock
      })
      .catch(reportEngineError);
  }, [currentFen, currentNodeId, depth, engineClock, engineClockLive, engineSide, gameOutcome, mode, moveTimeMs, moveTree, rootFen, status.isEnd, status.turn]);

  // Live analysis of the current position.
  useEffect(() => {
    const engines = window.chaturanga?.engines;
    if (!engines || mode !== "analysis" || status.isEnd || gameOutcome) return;
    const analysis = useAnalysisStore.getState();
    const engineId = analysis.activeEngineId ?? defaultEngineId;
    if (!engineId) {
      analysis.setStatus("idle");
      analysis.setError("Configure an engine to start live analysis.");
      return;
    }
    analysis.setActiveEngine(engineId);
    analysis.setError(null);
    analysis.setStatus("thinking");
    engines
      .startAnalysis({ engineId, fen: rootFen, moves: currentLineUcis(moveTree, currentNodeId), multipv: ANALYSIS_MULTIPV })
      .catch(reportEngineError);
    return () => {
      void engines.stop();
    };
  }, [currentFen, currentNodeId, defaultEngineId, gameOutcome, mode, moveTree, rootFen, status.isEnd]);
}
