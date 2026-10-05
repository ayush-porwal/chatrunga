import { useEffect } from "react";
import { statusForFen } from "@chaturanga/shared/chess/position";
import type { Color, MoveNode } from "@chaturanga/shared/types/chess";
import { keepAudioAwake, playSound, type SoundKind } from "../sounds/sounds";
import { useGameStore } from "../stores/game-store";

/** Board steps being made without their sound (withoutMoveSounds). */
let silentSteps = 0;

/**
 * Makes the board step `step` takes (a store update) without its move sound: a running review's
 * board catching up on moves analysed faster than it can step through them.
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
 * Plays a move / capture / check sound (or the game-over sound) whenever the board steps one
 * move — forwards or backwards — and the sound setting is on.
 */
export function useMoveSounds({ enabled, volume }: { enabled: boolean; volume: number }): void {
  // Sounds loaded and the output kept awake from launch, so the first moves aren't silent.
  useEffect(() => (enabled ? keepAudioAwake() : undefined), [enabled]);
  useEffect(() => {
    if (!enabled) return;
    return useGameStore.subscribe((state, previous) => {
      if (state.currentNodeId === previous.currentNodeId || silentSteps) return;
      const moved = movedNodeBetween(state.moveTree, previous.currentNodeId, state.currentNodeId);
      if (!moved) return;
      const status = statusForFen(state.currentFen);
      const sound = pickSound({
        san: moved.san ?? "",
        result: status.result,
        isEnd: status.isEnd,
        engineSide: state.engineSide,
        orientation: state.orientation
      });
      playSound(sound, volume);
    });
  }, [enabled, volume]);
}

/**
 * The move that took the board from `fromNodeId` to `toNodeId`: the new node when stepping
 * forwards, the undone node when stepping back, else the first move below `fromNodeId` on the
 * path to `toNodeId`. Null when the two nodes are not on one line.
 */
export function movedNodeBetween(
  moveTree: readonly MoveNode[],
  fromNodeId: string,
  toNodeId: string
): MoveNode | null {
  const byId = new Map(moveTree.map((node) => [node.id, node]));
  const to = byId.get(toNodeId);
  if (to?.parentId === fromNodeId) return to;
  const from = byId.get(fromNodeId);
  if (from?.parentId === toNodeId) return from;
  const seen = new Set<string>();
  for (
    let cursor = to;
    cursor && !seen.has(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
  ) {
    seen.add(cursor.id);
    if (cursor.parentId === fromNodeId) return cursor;
  }
  return null;
}

export function pickSound(input: {
  san: string;
  result: string;
  isEnd: boolean;
  engineSide: Color | null;
  orientation: Color;
}): SoundKind {
  if (input.isEnd) {
    const winner = input.result === "1-0" ? "white" : input.result === "0-1" ? "black" : null;
    if (!winner) return "draw";
    // Against an engine the user plays the other side; otherwise the side at the bottom.
    const userColor = input.engineSide
      ? input.engineSide === "white"
        ? "black"
        : "white"
      : input.orientation;
    return winner === userColor ? "victory" : "defeat";
  }
  if (input.san.includes("+") || input.san.includes("#")) return "check";
  if (input.san.includes("x")) return "capture";
  return "move";
}
