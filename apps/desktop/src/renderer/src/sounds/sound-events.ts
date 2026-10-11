import { applyUserMove } from "@chaturanga/shared/chess/position";
import type { Color, UserMove } from "@chaturanga/shared/types/chess";
import { userMoveBetween } from "@/lib/uci";

/*
 * What the board sounds like: which recording a move, a step or a game's end plays. Pure, so the
 * main board, the repertoire boards and the tests agree on one definition (sounds.ts plays them).
 */

export type SoundKind =
  | "move"
  | "capture"
  | "check"
  | "castle"
  | "victory"
  | "defeat"
  | "draw"
  /** A live game begins. */
  | "start"
  /** The user's clock runs low in a live timed game. */
  | "lowTime"
  /** A puzzle is solved. */
  | "correct"
  /** A move refused: illegal, not the puzzle's, or played where it can't be. */
  | "error";

/** The recordings a sound set has, by kind (a set without one plays nothing, or a fallback). */
export type SoundFiles = Partial<Record<SoundKind, string>>;

/**
 * Sounds of a piece moving: one at a time, a newer one within the stacking window replacing it.
 * The rest (a result, a game start, a solved puzzle) are announcements that wait for it to land.
 */
export function isBoardSound(kind: SoundKind): boolean {
  return (
    kind === "move" ||
    kind === "capture" ||
    kind === "check" ||
    kind === "castle" ||
    kind === "error"
  );
}

/**
 * The sounds a move (in SAN) may play, best first: the set plays the first it has. A check comes
 * first (unless checks are silent, as in Lichess's standard set), then castling, then a capture
 * or a plain move; a capture falls back to the move sound. So `Qxe2+` is a check, or with
 * silent checks a capture.
 */
export function moveSoundChain(san: string, silentCheck: boolean): SoundKind[] {
  const chain: SoundKind[] = [];
  if (!silentCheck && /[+#]/.test(san)) chain.push("check");
  if (san.startsWith("O-O")) chain.push("castle");
  if (san.includes("x")) chain.push("capture");
  chain.push("move");
  return chain;
}

/** The result's sound for the side the user played: a win, a loss or a draw (null: no result). */
export function resultSound(result: string, user: Color): SoundKind | null {
  if (result === "1/2-1/2") return "draw";
  if (result !== "1-0" && result !== "0-1") return null;
  return (result === "1-0") === (user === "white") ? "victory" : "defeat";
}

/**
 * When the user's clock counts as low (ms), from the game's starting time: an eighth of it, at
 * least 10 seconds and at most a minute (Lichess's own rule).
 */
export function lowTimeThresholdMs(initialMs: number): number {
  return Math.min(60_000, Math.max(10_000, initialMs * 0.125));
}

const PROMOTIONS: readonly UserMove["promotion"][] = [
  undefined,
  "queen",
  "rook",
  "bishop",
  "knight"
];

/** Placement, side to move, castling and en passant: the position, whatever its move counters. */
const positionKey = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

/**
 * The SAN of the move that takes a board from `fenBefore` to `fenAfter`, when `lastMove` (its
 * squares) is that one move: a step forward. Null for anything else (a step back, a jump, a new
 * position), which plays no sound.
 */
export function sanOfStep(
  fenBefore: string,
  fenAfter: string,
  lastMove: readonly [string, string] | null
): string | null {
  if (!lastMove || fenBefore === fenAfter) return null;
  const target = positionKey(fenAfter);
  for (const promotion of PROMOTIONS) {
    const move = userMoveBetween(lastMove[0], lastMove[1], promotion);
    const applied = move ? safelyApplied(fenBefore, move) : null;
    if (applied && positionKey(applied.fen) === target) return applied.san;
  }
  return null;
}

function safelyApplied(fen: string, move: UserMove): { fen: string; san: string } | null {
  try {
    return applyUserMove(fen, move);
  } catch {
    return null; // Not a position (a board still loading): no sound.
  }
}
