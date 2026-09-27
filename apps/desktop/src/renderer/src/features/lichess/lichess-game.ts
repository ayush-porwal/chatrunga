import { statusForFen } from "@chaturanga/shared/chess/position";
import type { Color, GameHeaders } from "@chaturanga/shared/types/chess";
import type { LichessGameFull, LichessGameState, LichessPlayer, LichessSpeed } from "@chaturanga/shared/types/lichess";

/** Your side in a Lichess game, from your account id; null when you aren't playing it. */
export function yourColor(game: Pick<LichessGameFull, "white" | "black">, accountId: string): Color | null {
  if (game.white.id === accountId) return "white";
  if (game.black.id === accountId) return "black";
  return null;
}

export function isGameOver(state: Pick<LichessGameState, "status">): boolean {
  return state.status !== "created" && state.status !== "started";
}

/**
 * The PGN result and a termination in the words the board's finale uses ("Player resign", "Time
 * forfeit", …) for a finished Lichess game; null while it's still being played. Aborted games have
 * no result ("*").
 */
export function lichessOutcome(state: Pick<LichessGameState, "status" | "winner">): { result: string; termination: string } | null {
  if (!isGameOver(state)) return null;
  const result = state.winner === "white" ? "1-0" : state.winner === "black" ? "0-1" : "1/2-1/2";
  switch (state.status) {
    case "aborted":
    case "noStart":
      return { result: "*", termination: "Game aborted" };
    case "mate":
      return { result, termination: "Checkmate" };
    case "resign":
      return { result, termination: "Player resign" };
    case "outoftime":
      return { result, termination: "Time forfeit" };
    case "timeout":
      return { result, termination: "Opponent left" };
    case "stalemate":
      return { result: "1/2-1/2", termination: "Stalemate" };
    case "draw":
      return { result: "1/2-1/2", termination: "Draw" };
    default:
      return { result, termination: "Game over" };
  }
}

/** Side to move after `plies` moves from `initialFen`. */
export function sideToMoveAfter(initialFen: string, plies: number): Color {
  const first = statusForFen(initialFen).turn;
  return plies % 2 === 0 ? first : first === "white" ? "black" : "white";
}

export function playerLabel(player: LichessPlayer): string {
  if (player.aiLevel) return `Lichess AI · level ${player.aiLevel}`;
  return player.title ? `${player.title} ${player.name}` : player.name;
}

const SPEED_LABELS: Record<LichessSpeed, string> = {
  ultraBullet: "UltraBullet",
  bullet: "Bullet",
  blitz: "Blitz",
  rapid: "Rapid",
  classical: "Classical",
  correspondence: "Correspondence"
};

export function speedLabel(speed: LichessSpeed): string {
  return SPEED_LABELS[speed];
}

export function timeControlLabel(clock: { initialMs: number; incrementMs: number } | null): string {
  if (!clock) return "Correspondence";
  const minutes = clock.initialMs / 60_000;
  return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)}+${Math.round(clock.incrementMs / 1000)}`;
}

/** PGN headers for a live Lichess game (the saved game carries them; `site` identifies it on import). */
export function lichessHeaders(game: LichessGameFull): GameHeaders {
  const date = new Date(game.createdAt);
  return {
    event: `${game.rated ? "Rated" : "Casual"} ${speedLabel(game.speed)} game`,
    site: `https://lichess.org/${game.id}`,
    date: `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`,
    white: playerLabel(game.white),
    black: playerLabel(game.black),
    whiteElo: game.white.rating ? String(game.white.rating) : null,
    blackElo: game.black.rating ? String(game.black.rating) : null,
    timeControl: game.clock ? `${Math.round(game.clock.initialMs / 1000)}+${Math.round(game.clock.incrementMs / 1000)}` : "-",
    result: "*"
  };
}

/**
 * Lichess sorts a clock into a speed by its estimated game length: minutes × 60 + 40 × increment
 * seconds. Apps may only seek Rapid (≥ 8 minutes estimated) or slower; blitz needs a challenge.
 */
export function estimatedSeconds(minutes: number, incrementSec: number): number {
  return minutes * 60 + 40 * incrementSec;
}

export function isRapidOrSlower(minutes: number, incrementSec: number): boolean {
  return estimatedSeconds(minutes, incrementSec) >= 480;
}

export function speedForClock(minutes: number, incrementSec: number): LichessSpeed {
  const seconds = estimatedSeconds(minutes, incrementSec);
  if (seconds < 30) return "ultraBullet";
  if (seconds < 180) return "bullet";
  if (seconds < 480) return "blitz";
  if (seconds < 1500) return "rapid";
  return "classical";
}

export type LichessClockPreset = { minutes: number; incrementSec: number };

/** Quick pairing: the lobby's rapid and classical pools (what apps may seek). */
export const SEEK_PRESETS: readonly LichessClockPreset[] = [
  { minutes: 10, incrementSec: 0 },
  { minutes: 10, incrementSec: 5 },
  { minutes: 15, incrementSec: 10 },
  { minutes: 30, incrementSec: 0 },
  { minutes: 30, incrementSec: 20 }
];

/** Challenges (a friend or the Lichess AI) may also be blitz. */
export const CHALLENGE_PRESETS: readonly LichessClockPreset[] = [
  { minutes: 3, incrementSec: 2 },
  { minutes: 5, incrementSec: 0 },
  { minutes: 5, incrementSec: 3 },
  { minutes: 10, incrementSec: 0 },
  { minutes: 15, incrementSec: 10 }
];

export const presetLabel = (preset: LichessClockPreset) => `${preset.minutes}+${preset.incrementSec}`;

/** Lichess (or the IPC bridge) refused a move or an action: its message, else `fallback`. */
export function lichessErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "";
  return message || fallback;
}
