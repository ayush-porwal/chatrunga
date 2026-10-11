import { formatClockForDisplay } from "@chaturanga/shared/chess/clock-display";
import { clocksOnPathToNode } from "@chaturanga/shared/chess/pgn";
import type { Color, MoveNode } from "@chaturanga/shared/types/chess";

/** Each side's clock beside the board at one move, as displayed ("02:45", "1:02:03"). */
export type BoardClocks = Record<Color, string>;

/** Shown for a side whose time isn't known yet (no move with a clock, no time control to start from). */
const UNKNOWN_CLOCK = "--:--";

/**
 * The time each side starts with, in the `[%clk]` form ("0:03:00"), from a PGN TimeControl of the
 * `base+increment` or `base` form in seconds ("180+2", "600"). Null for any other form ("-", "?",
 * the multi-stage "40/7200:3600"), which has no single start to show.
 */
export function startingClock(timeControl: string | null | undefined): string | null {
  const match = /^(\d+)(?:\+\d+)?$/.exec(timeControl?.trim() ?? "");
  if (!match) return null;
  const seconds = Number(match[1]);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${hours}:${pad(minutes)}:${pad(seconds % 60)}`;
}

/**
 * A PGN TimeControl as players write it: minutes + increment seconds ("120+1" → "2+1", "600" →
 * "10+0", "90+0" → "1.5+0"). The raw text for any other form ("40/7200:3600"); null for none.
 */
export function timeControlLabel(timeControl: string | null | undefined): string | null {
  const text = timeControl?.trim() ?? "";
  if (!text || text === "-" || text === "?") return null;
  const match = /^(\d+)(?:\+(\d+))?$/.exec(text);
  if (!match) return text;
  const minutes = Math.round((Number(match[1]) / 60) * 10) / 10;
  // The increment is an optional group: absent in a bare "600".
  return `${minutes}+${match.at(2) ?? "0"}`;
}

/**
 * Each side's remaining time at `nodeId`: the last `[%clk]` that side recorded on the path from the
 * start to that move (so at Black's move, White's clock is the one White left after its own move
 * before it). Before a side's first move it shows the time control's starting time. Null for a
 * game whose moves record no clock at all, which shows no clocks.
 */
export function boardClocksAt(
  moveTree: MoveNode[],
  nodeId: string,
  timeControl: string | null | undefined
): BoardClocks | null {
  if (!moveTree.some((node) => node.clockAfter)) return null;
  const { white, black } = clocksOnPathToNode(moveTree, nodeId);
  const start = startingClock(timeControl);
  const show = (clock: string | null) => {
    const raw = clock ?? start;
    return raw ? formatClockForDisplay(raw) : UNKNOWN_CLOCK;
  };
  return { white: show(white), black: show(black) };
}

/** The side to move in a FEN (its second field), whose clock is the one running. */
export function sideToMove(fen: string): Color {
  return fen.trim().split(/\s+/)[1] === "b" ? "black" : "white";
}
