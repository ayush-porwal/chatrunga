/**
 * Time spent on each move, from the clocks a PGN records (`[%clk]`) and its TimeControl tag. The
 * review stores it per move (main) and the review's charts draw it (renderer), from the same rules.
 */

/** A `[%clk]` value ("0:04:58", "4:58", "0:00:09.5") in milliseconds; null when unreadable. */
export function parseClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const parts = value.trim().split(":").map(Number);
  if (parts.length < 2 || parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 2) return Math.round(parts[0] * 60_000 + parts[1] * 1000);
  if (parts.length === 3)
    return Math.round(parts[0] * 3_600_000 + parts[1] * 60_000 + parts[2] * 1000);
  return null;
}

/** PGN TimeControl `base[+inc]` in seconds (e.g. "600+5"); null for "-", "?" or multi-period controls. */
export function parseTimeControl(
  value: string | null | undefined
): { baseMs: number; incrementMs: number } | null {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)(?:\+(\d+(?:\.\d+)?))?$/);
  if (!match) return null;
  return {
    baseMs: Math.round(Number(match[1]) * 1000),
    incrementMs: Math.round(Number(match[2] ?? 0) * 1000)
  };
}

/**
 * Time the mover spent on move `index` (of the main line, from the start): their previous clock
 * (two plies back, or the base time for their first move) minus their clock now, plus the
 * increment they received for this move. Undefined when either clock is unknown.
 */
export function timeSpentForMove(
  moves: readonly { clockAfter?: string | null }[],
  index: number,
  timeControl: { baseMs: number; incrementMs: number } | null
): number | undefined {
  const current = parseClock(moves[index]?.clockAfter);
  if (current === null) return undefined;
  const previous =
    index >= 2 ? parseClock(moves[index - 2]?.clockAfter) : (timeControl?.baseMs ?? null);
  if (previous === null) return undefined;
  return Math.max(0, previous - current + (timeControl?.incrementMs ?? 0));
}

/**
 * Time spent on every move of a main line (index 0 is the first move), in milliseconds; null for a
 * move whose time can't be told (no clock on it or on the mover's move before it).
 */
export function moveTimes(
  moves: readonly { clockAfter?: string | null }[],
  timeControl: string | null | undefined
): (number | null)[] {
  const control = parseTimeControl(timeControl);
  return moves.map((_, index) => timeSpentForMove(moves, index, control) ?? null);
}
