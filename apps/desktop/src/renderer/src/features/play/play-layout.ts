import type { PlayOpponent } from "@chaturanga/shared/types/settings";

/** Columns of the Play page's top row (Play card + board cards) and of the row under it. */
export const PLAY_COLUMNS = 4;

/**
 * How many of the newest games the page reads: the Recent games table's rows (10) plus the one the
 * In progress card may take out of it. The table and the page share this query (one key).
 */
export const RECENT_GAMES_FETCH = 11;

export type TopSlot =
  | { kind: "play"; span: 1 | 2 }
  | { kind: "in-progress" }
  | { kind: "repertoire" }
  | { kind: "puzzle" }
  /** The "Your move" illustration, filling the columns nothing else takes. */
  | { kind: "your-move"; span: number };

/**
 * The top row, left to right: the Play card (two columns, with its preview board, when nothing is in
 * progress), then the board cards that have something to show, in a fixed order, then the "Your
 * move" card across whatever columns are left.
 */
export function topRowSlots(cards: {
  inProgress: boolean;
  repertoire: boolean;
  puzzle: boolean;
}): TopSlot[] {
  const slots: TopSlot[] = [{ kind: "play", span: cards.inProgress ? 1 : 2 }];
  if (cards.inProgress) slots.push({ kind: "in-progress" });
  if (cards.repertoire) slots.push({ kind: "repertoire" });
  if (cards.puzzle) slots.push({ kind: "puzzle" });
  const used = slots.reduce((sum, slot) => sum + ("span" in slot ? slot.span : 1), 0);
  if (used < PLAY_COLUMNS) slots.push({ kind: "your-move", span: PLAY_COLUMNS - used });
  return slots;
}

const LICHESS_MODES: readonly PlayOpponent[] = ["pool", "friend", "ai"];

export function isLichessMode(mode: PlayOpponent): boolean {
  return LICHESS_MODES.includes(mode);
}

/**
 * The opponent the Play card shows: the one chosen this session (Back/Forward and detours keep it),
 * else the saved Play settings choice when it can be used (a Lichess mode needs an account), else
 * Quick pairing when Lichess is connected, else the engine.
 */
export function resolvePlayMode({
  session,
  saved,
  hasAccount,
  connected
}: {
  session: PlayOpponent | null;
  saved: PlayOpponent | null;
  /** A Lichess account is linked (its token may have been rejected since). */
  hasAccount: boolean;
  /** Linked and its token still accepted. */
  connected: boolean;
}): PlayOpponent {
  if (session) return session;
  if (saved && (!isLichessMode(saved) || hasAccount)) return saved;
  return connected ? "pool" : "engine";
}

/** First run: no engine installed and no Lichess account, so there is no opponent yet. */
export function isFirstRun({
  engineCount,
  hasAccount
}: {
  engineCount: number;
  hasAccount: boolean;
}): boolean {
  return engineCount === 0 && !hasAccount;
}

/**
 * Engines in the order Play settings lists them: Stockfish and other engines first (by name), then
 * the Maia levels from the weakest up — not the registry's creation order.
 */
export function playEngineOrder<T extends { name: string }>(engines: readonly T[]): T[] {
  const maia = (engine: T) => /^maia\b/i.test(engine.name.trim());
  return [...engines].sort(
    (a, b) =>
      Number(maia(a)) - Number(maia(b)) ||
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
  );
}
