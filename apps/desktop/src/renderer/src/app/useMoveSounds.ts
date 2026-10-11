import { useEffect } from "react";
import { userSide } from "../features/analysis/post-game";
import { clockNow, remainingClockMs } from "../stores/game-clock";
import { isMatchMode, useGameStore } from "../stores/game-store";
import {
  configureSounds,
  keepAudioAwake,
  playMoveSound,
  playSound,
  type SoundPreferences
} from "../sounds/sounds";
import { lowTimeThresholdMs, resultSound } from "../sounds/sound-events";

type GameState = ReturnType<typeof useGameStore.getState>;

/** How often a live timed game's clock is looked at for the low-time warning. */
const LOW_TIME_POLL_MS = 250;

/** Board steps being made without their move sound (withoutMoveSounds). */
let silentSteps = 0;

/**
 * Makes the board step `step` takes (a store update) without its move sound: a running review's
 * board catching up on moves analysed faster than it can step through them, or Back/Forward
 * putting a game back the way it was.
 */
export function withoutMoveSounds(step: () => void): void {
  silentSteps += 1;
  try {
    step();
  } finally {
    silentSteps -= 1;
  }
}

/**
 * The board's sounds, with the sound settings: a move's sound on every step forward, and for a
 * live game (engine or Lichess) its start, low time, a refused move and its result.
 */
export function useMoveSounds({ enabled, volume, set, silentCheck }: SoundPreferences): void {
  useEffect(() => {
    void configureSounds({ enabled, volume, set, silentCheck });
  }, [enabled, volume, set, silentCheck]);
  // The output kept awake from launch, so the first moves aren't silent.
  useEffect(() => (enabled ? keepAudioAwake() : undefined), [enabled]);
  useEffect(() => (enabled ? watchBoardSounds() : undefined), [enabled]);
}

/** Follows the game store, playing what each change sounds like. Returns the cleanup. */
export function watchBoardSounds(): () => void {
  const live = liveGameSounds();
  const unsubscribe = useGameStore.subscribe((state, previous) => {
    playStepSound(state, previous);
    // Refused (an illegal move, or one played away from an online game's end); not a move after
    // the end, nor the one that lost on time.
    if (state.rejectedMoves > previous.rejectedMoves && !state.gameOutcome) playSound("error");
    live.update(state);
  });
  live.update(useGameStore.getState(), { initial: true });
  return () => {
    unsubscribe();
    live.stop();
  };
}

/**
 * A step one move forward plays that move's sound; nothing else does (a step back, a jump to
 * another move, a game loaded or put back), as on Lichess. So every sound is the move just shown.
 */
function playStepSound(state: GameState, previous: GameState): void {
  if (state.currentNodeId === previous.currentNodeId || silentSteps) return;
  // Another game on the board (loaded, or a new one): its first position, not a move.
  if (state.board !== previous.board) return;
  const node = state.moveTree.find((item) => item.id === state.currentNodeId);
  if (node?.san && node.parentId === previous.currentNodeId) playMoveSound(node.san);
}

/** Being played: an engine or Lichess game against the app's opponent, with no result yet. */
function isLiveGame(state: GameState): boolean {
  return isMatchMode(state.mode) && Boolean(state.engineSide) && !state.gameOutcome;
}

/**
 * A live game's start, low time and result. A game counts as live once it has stayed live past
 * the task that set it up: a Lichess game opened when it had already ended is set up and ended in
 * one go, and so plays neither its start nor its result. Only a result decided while it was live
 * plays (a mate, a resignation, a flag, a draw agreed, the Lichess server's end), never a finished
 * game being loaded, put back or browsed.
 */
function liveGameSounds() {
  /** The board (GameStore.board) whose game is live, its start confirmed. */
  let liveBoard: number | null = null;
  /** A game set up just now, confirmed live once its setup task is over. */
  let arming: { board: number; timer: ReturnType<typeof setTimeout> } | null = null;
  const cancelArming = () => {
    if (arming) clearTimeout(arming.timer);
    arming = null;
  };
  const lowTime = lowTimeWarning();
  const disarm = () => {
    cancelArming();
    liveBoard = null;
    lowTime.stop();
  };
  const arm = (board: number, announce: boolean) => {
    liveBoard = board;
    if (announce) playSound("start");
    lowTime.start();
  };
  return {
    update(state: GameState, { initial = false }: { initial?: boolean } = {}): void {
      if (liveBoard === state.board && state.gameOutcome) {
        disarm();
        const user = userSide(state.mode, state.engineSide);
        const sound = user && resultSound(state.gameOutcome.result, user);
        if (sound) playSound(sound);
        return;
      }
      if (!isLiveGame(state)) {
        disarm();
        return;
      }
      if (liveBoard === state.board || arming?.board === state.board) return;
      cancelArming();
      if (initial) {
        // Sounds switched on during a game: it is live already, without a start.
        arm(state.board, false);
        return;
      }
      const board = state.board;
      const timer = setTimeout(() => {
        arming = null;
        const now = useGameStore.getState();
        if (isLiveGame(now) && now.board === board) arm(board, true);
      }, 0);
      arming = { board, timer };
    },
    stop: disarm
  };
}

/**
 * Warns once when the user's clock, running on their turn, falls under the low-time mark
 * (lowTimeThresholdMs); again only after an increment has taken it back above.
 */
function lowTimeWarning() {
  let poll: ReturnType<typeof setInterval> | null = null;
  let warned = false;
  const check = () => {
    const state = useGameStore.getState();
    const live = state.engineClockLive;
    const user = userSide(state.mode, state.engineSide);
    if (!live || !state.engineClock || !user) return;
    const left = remainingClockMs(live, user, clockNow());
    if (left > lowTimeThresholdMs(state.engineClock.initialMs)) warned = false;
    else if (!warned && live.sideToMove === user && live.stoppedAt === undefined && left > 0) {
      warned = true;
      playSound("lowTime");
    }
  };
  return {
    start() {
      warned = false;
      poll ??= setInterval(check, LOW_TIME_POLL_MS);
    },
    stop() {
      if (poll !== null) clearInterval(poll);
      poll = null;
    }
  };
}
