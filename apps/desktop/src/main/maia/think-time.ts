/**
 * How long Maia "thinks" before it plays in a timed game: our own design (maiachess.com's server
 * sends a move delay, but its formula isn't public). Pure, so it is tested with a seeded random.
 *
 * The idea is a human's time management:
 *
 * 1. **Budget.** The time left spread over the moves still to come, plus most of the increment
 *    (it comes back after the move): `remaining / movesLeft + 0.6 × increment`, where
 *    `movesLeft = max(15, 40 − moveNumber / 2)` — a player expects about 40 more moves at the
 *    start and never fewer than 15.
 * 2. **Opening.** Known moves come quickly: the budget is scaled from ×0.4 on move 1 up to ×1 by
 *    move 15.
 * 3. **Clarity.** Maia's own top-move probability says how obvious the position is to a player
 *    of that rating. Unclear positions (low top probability) take longer, up to ×1.6; one that a
 *    single move dominates (above 0.8, a recapture or the only move) is played quickly, down to
 *    ×0.3. The factor is `1.6 − 1.25 × p` up to p = 0.8 (×0.6), then falls linearly to ×0.3 at 1.
 * 4. **Jitter.** ×0.75–1.25 at random, so equal positions don't take equal time.
 * 5. **Bounds.** At least {@link MIN_THINK_MS} (no instant replies), at most
 *    {@link MAX_THINK_MS} (an opponent who sits longer reads as stuck), and never more than
 *    10% of the time left plus half the increment, nor half of the time left: Maia never loses
 *    on time by thinking. When that cap is below the floor (a scramble), the cap wins.
 *
 * Untimed games (no clock running) get no delay at all.
 */

/** No reply comes sooner than this in a timed game. */
export const MIN_THINK_MS = 400;
/** No reply takes longer than this, whatever the clock allows. */
export const MAX_THINK_MS = 30_000;

export type MaiaThinkInput = {
  /** Maia's own time left (ms); null when no clock is running (untimed game). */
  remainingMs: number | null;
  /** Maia's increment per move (ms). */
  incrementMs: number;
  /** The full-move number Maia is about to play (1 for the first move). */
  moveNumber: number;
  /** Probability of Maia's likeliest move in this position (0–1). */
  topProb: number;
  /** Returns [0, 1); Math.random in the app. */
  random: () => number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** How unclear the position is to Maia: ×1.6 when nothing stands out, ×0.3 for a forced move. */
function clarityFactor(topProb: number): number {
  const p = clamp(Number.isFinite(topProb) ? topProb : 0, 0, 1);
  return p <= 0.8 ? 1.6 - 1.25 * p : 0.6 - 1.5 * (p - 0.8);
}

/** Known opening moves come quickly: ×0.4 on move 1, up to ×1 by move 15. */
function openingFactor(moveNumber: number): number {
  return clamp(0.4 + ((moveNumber - 1) * 0.6) / 14, 0.4, 1);
}

/** Milliseconds Maia waits before playing (see the module comment); 0 in an untimed game. */
export function maiaThinkMs(input: MaiaThinkInput): number {
  const { remainingMs } = input;
  if (remainingMs === null || !Number.isFinite(remainingMs) || remainingMs <= 0) return 0;
  const increment = Number.isFinite(input.incrementMs) ? Math.max(0, input.incrementMs) : 0;
  const moveNumber = Number.isFinite(input.moveNumber) ? Math.max(1, input.moveNumber) : 1;
  const movesLeft = Math.max(15, 40 - moveNumber / 2);
  const budget = remainingMs / movesLeft + 0.6 * increment;
  const jitter = 0.75 + 0.5 * clamp(input.random(), 0, 1);
  const wanted = budget * openingFactor(moveNumber) * clarityFactor(input.topProb) * jitter;
  const cap = Math.min(0.1 * remainingMs + 0.5 * increment, 0.5 * remainingMs, MAX_THINK_MS);
  return Math.floor(Math.min(Math.max(wanted, MIN_THINK_MS), cap));
}
