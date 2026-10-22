import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { START_FEN } from "@chaturanga/shared/chess/position";
import { createGameFromFen } from "@chaturanga/shared/chess/pgn";
import type { Color } from "@chaturanga/shared/types/chess";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import { positionStatus } from "@/lib/position-status";
import { useEnginesQuery, useSettingsQuery } from "../../queries/api";
import { useAnalysisStore } from "../../stores/analysis-store";
import { useGameStore } from "../../stores/game-store";
import { selectLiveGameInProgress, useLichessStore } from "../../stores/lichess-store";
import { usePlayDraftStore } from "../../stores/play-draft-store";
import { useRepertoireHandoffStore } from "../../stores/repertoire-handoff-store";
import { ENGINE_MOVE_TIME_MS } from "../../app/rejoin-saved-game";
import { holdUntilChanged } from "../../app/useGameAutosave";
import { gameFromInitialSession } from "../repertoire/handoffs";
import {
  clockTag,
  engineGameHeaders,
  isMaiaEngine,
  playMaiaRating,
  yourRating
} from "./engine-game";
import { engineClockMs, engineClockPreset, type EngineClockPresetId } from "./time-control";

export type EngineGameSetup = ReturnType<typeof useEngineGameSetup>;

/**
 * The engine to play: Play settings' choice, else the last one picked, else the default, else the
 * first; an engine deleted since it was chosen falls back to the next choice.
 */
function pickEngine(
  engines: readonly EngineConfig[],
  settingsEngineId: string | null | undefined,
  draftEngineId: string | null | undefined
): EngineConfig | undefined {
  return (
    engines.find((engine) => engine.id === settingsEngineId) ??
    engines.find((engine) => engine.id === draftEngineId) ??
    engines.find((engine) => engine.isDefault) ??
    engines.at(0)
  );
}

/**
 * The rating Maia plays at (Play settings' choice, else yours for the clock's mode), and with
 * yours what a game against it is started with when it is the engine (`game`, else null).
 */
function maiaSetup(
  settings: Pick<AppSettings, "playMaiaRating" | "playerRatings"> | undefined,
  engine: EngineConfig | undefined,
  timeControl: string
) {
  const ratings = settings?.playerRatings;
  const choice = playMaiaRating({ saved: settings?.playMaiaRating, ratings, timeControl });
  const game = isMaiaEngine(engine)
    ? { rating: choice, yourRating: yourRating(ratings, timeControl) }
    : null;
  return { choice, rating: game ? choice : null, game };
}

/**
 * The Play card's engine game: which engine (Play settings' choice, else the last one picked, else
 * the default), your colour, the clock, where it starts (a new game, the board's position, or a
 * repertoire handoff) and Start. The choices live in the play draft, so detours and Back keep them.
 */
export function useEngineGameSetup({
  onBeforeStart,
  onStart
}: {
  /** Right before the engine game replaces the board (history keeps the board being left). */
  onBeforeStart: () => void;
  onStart: () => void;
}) {
  const engines = useEnginesQuery();
  const settings = useSettingsQuery();
  const onlineGameLive = useLichessStore(selectLiveGameInProgress);
  const draft = usePlayDraftStore((state) => state.draft);
  const updateDraft = usePlayDraftStore((state) => state.update);
  const orientation = useGameStore((state) => state.orientation);
  const list = useMemo(() => engines.data ?? [], [engines.data]);
  const selectedEngine = pickEngine(list, settings.data?.playEngineId, draft.engineId);
  // A repertoire handoff (Study → Play from here): the game starts there, as its colour.
  const initialSession = draft.initialSession ?? null;
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const humanColor: Color = initialSession?.playerColor ?? draft.humanColor ?? orientation;
  const clockPreset = engineClockPreset(draft.clockPreset);
  const custom = { minutes: draft.customMinutes, incrementSec: draft.customIncrementSec };
  const timeControl = clockTag(engineClockMs(clockPreset, custom));
  const maia = maiaSetup(settings.data, selectedEngine, timeControl);
  // The position on the board, if a game can start from it (not the start position, not over).
  const boardPosition = useGameStore(
    useShallow((state) => {
      const status = positionStatus(state.currentFen);
      return state.currentFen !== START_FEN && !status.isEnd
        ? {
            fen: state.currentFen,
            turn: status.turn,
            moveNumber: Number(state.currentFen.split(" ")[5]) || 1
          }
        : null;
    })
  );
  const [startFrom, setStartFrom] = useState<"new" | "position">("new");
  const fromPosition =
    !initialSession && startFrom === "position" && boardPosition ? boardPosition : null;

  function startGame() {
    const engine = selectedEngine;
    if (!engine?.isAvailable) return;
    // A Lichess game owns the board until it ends (checked here too, not only on the button).
    if (selectLiveGameInProgress(useLichessStore.getState())) return;
    const game = useGameStore.getState();
    const engineColor: Color = humanColor === "white" ? "black" : "white";
    const clock = engineClockMs(clockPreset, custom);
    // A repertoire handoff: its moves replayed into the new game (the position keeps its history).
    const handoffGame = initialSession ? gameFromInitialSession(initialSession, {}) : null;
    if (initialSession && !handoffGame) {
      setHandoffError("This repertoire position couldn’t be set up. Clear it to start a new game.");
      return;
    }
    setHandoffError(null);
    onBeforeStart();
    // Play from here: the game begins at the board's position (a PGN with its FEN), not move 1.
    if (handoffGame) game.loadGame(handoffGame);
    else if (fromPosition) {
      game.loadGame(createGameFromFen({ fen: fromPosition.fen, source: "engine-game" }));
    } else game.reset();
    game.setOrientation(humanColor);
    game.setGameSource("engine-game");
    game.patchHeaders(
      engineGameHeaders({
        engine,
        engineColor,
        clock,
        maia: maia.game
      })
    );
    game.setMode("engine");
    game.setEngineSide(engineColor);
    // With a clock the engine plays to it; without one it thinks a fixed time per move.
    game.setEngineLimits(ENGINE_MOVE_TIME_MS, null);
    game.setMatchFeedback(null);
    // The clock starts at the handoff position (after the replayed prefix), with its side to move.
    if (clock) {
      game.setEngineMatchClock(clock);
      game.initEngineClockLive();
    } else {
      game.setEngineMatchClock(null);
    }
    if (initialSession && handoffGame) {
      // Not in the library until a move is played; then linked to the repertoire as a played game.
      holdUntilChanged();
      useRepertoireHandoffStore.getState().begin({
        ...initialSession.repertoire,
        gameNodeId: handoffGame.currentNodeId,
        color: initialSession.playerColor,
        board: useGameStore.getState().board
      });
      // The choices from before the handoff come back for the next game (see withoutInitialSession).
      usePlayDraftStore.getState().clearInitialSession();
    }
    useAnalysisStore.getState().setActiveEngine(engine.id);
    useAnalysisStore.getState().setError(null);
    useAnalysisStore.getState().setStatus("ready");
    onStart();
  }

  return {
    engines: list,
    enginesLoaded: engines.isSuccess || engines.isError,
    selectedEngine: selectedEngine ?? null,
    /** Maia's rating when Maia is the engine (its name shows it: "Maia 1500"), else null. */
    maiaRating: maia.rating,
    /** The rating Maia would play at (what Play settings' rating shows). */
    maiaRatingChoice: maia.choice,
    canStart: Boolean(selectedEngine?.isAvailable) && !onlineGameLive,
    humanColor,
    /** Swap: the other colour (locked while a repertoire handoff sets it). */
    swapColor: () => {
      if (!initialSession) updateDraft({ humanColor: humanColor === "white" ? "black" : "white" });
    },
    clockPreset,
    setClockPreset: (value: EngineClockPresetId) => updateDraft({ clockPreset: value }),
    custom,
    setCustomMinutes: (value: number) => updateDraft({ customMinutes: value }),
    setCustomIncrementSec: (value: number) => updateDraft({ customIncrementSec: value }),
    boardPosition: initialSession ? null : boardPosition,
    initialSession,
    clearInitialSession: () => {
      setHandoffError(null);
      usePlayDraftStore.getState().clearInitialSession();
    },
    handoffError,
    startFrom: fromPosition ? ("position" as const) : ("new" as const),
    setStartFrom,
    startGame
  };
}
