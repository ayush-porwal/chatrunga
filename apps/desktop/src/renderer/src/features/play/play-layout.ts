import type { PlayOpponent } from "@chaturanga/shared/types/settings";

/** Columns of the Play page's top row (Play card + board cards) and of the row under it. */
const PLAY_COLUMNS = 4;

/**
 * How many of the newest games the page reads: the Recent games table's rows (10) plus the one the
 * In progress card may take out of it. The table and the page share this query (one key).
 */
export const RECENT_GAMES_FETCH = 11;

export type TopSlot =
  | { kind: "play"; span: 1 | 2 | 3 }
  | { kind: "in-progress" }
  | { kind: "repertoire" }
  | { kind: "puzzle" }
  /** The knights illustration, filling the columns nothing else takes. */
  | { kind: "filler"; span: number };

/**
 * The top row, left to right: the Play card (two columns, with its preview board, when nothing is in
 * progress), then the board cards that have something to show, in a fixed order, then the filler
 * card across whatever columns are left. When the filler would take two columns or more, the Play
 * card takes one of them: its preview board then has room to fill the card's height.
 */
export function topRowSlots(cards: {
  inProgress: boolean;
  repertoire: boolean;
  puzzle: boolean;
}): TopSlot[] {
  const boardCards: TopSlot[] = [];
  if (cards.inProgress) boardCards.push({ kind: "in-progress" });
  if (cards.repertoire) boardCards.push({ kind: "repertoire" });
  if (cards.puzzle) boardCards.push({ kind: "puzzle" });
  let play: 1 | 2 | 3 = cards.inProgress ? 1 : 2;
  let left = PLAY_COLUMNS - play - boardCards.length;
  if (left >= 2) {
    play = play === 1 ? 2 : 3;
    left -= 1;
  }
  const slots: TopSlot[] = [{ kind: "play", span: play }, ...boardCards];
  if (left > 0) slots.push({ kind: "filler", span: left });
  return slots;
}

/** Columns of the top row in a narrow page: the Play card's, one between, the side column. */
const NARROW_COLUMNS = 3;

/** Where a top-row slot sits in a narrow page: its first column and span, and its grid rows. */
export type NarrowPlacement = { column: number; span: number; row: string };

/**
 * The top row of a narrow page (play.css: three columns, the last the side column): the Play card
 * keeps its preview-board layout in two columns when it had it, the board cards take a column
 * each, and when there are more of them than columns the first two share one, one above the
 * other. The filler takes the columns left (null: none are, it isn't shown).
 */
export function narrowPlacements(slots: readonly TopSlot[]): (NarrowPlacement | null)[] {
  const play = slots.find((slot) => slot.kind === "play");
  const playSpan = play ? Math.min(play.span, 2) : 1;
  const free = NARROW_COLUMNS - playSpan;
  const cards = slots.filter((slot) => slot.kind !== "play" && slot.kind !== "filler").length;
  const stacked = cards > free;
  // With two cards one above the other, everything else spans both rows.
  const full = stacked ? "1 / span 2" : "1";
  let card = 0;
  return slots.map((slot) => {
    if (slot.kind === "play") return { column: 1, span: playSpan, row: full };
    if (slot.kind === "filler")
      return cards < free ? { column: playSpan + 1 + cards, span: free - cards, row: full } : null;
    const index = card++;
    if (stacked && index < 2) return { column: playSpan + 1, span: 1, row: String(index + 1) };
    return { column: playSpan + 1 + (stacked ? index - 1 : index), span: 1, row: full };
  });
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

/** Play settings' choice: the opponent, and the engine for engine games. */
export type PlaySettingsChoice = { opponent: PlayOpponent; engineId: string | null };

/**
 * Saves Play settings' choice, optimistically: the session's opponent (`session`, the Lichess
 * store's) switches now, and the settings write goes out. A failed write puts the session's
 * previous opponent back, unless another one was chosen while it was being written (the settings
 * write rolls its own value back).
 */
export function savePlaySettings(
  choice: PlaySettingsChoice,
  session: () => {
    playOpponent: PlayOpponent | null;
    setPlayOpponent: (opponent: PlayOpponent | null) => void;
  },
  write: (
    variables: { patch: { playOpponent: PlayOpponent; playEngineId: string | null } },
    options: { onError: () => void }
  ) => void
): void {
  const { opponent, engineId } = choice;
  const before = session().playOpponent;
  session().setPlayOpponent(opponent);
  write(
    { patch: { playOpponent: opponent, playEngineId: engineId } },
    {
      onError: () => {
        const current = session();
        if (current.playOpponent === opponent) current.setPlayOpponent(before);
      }
    }
  );
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

/** The wide Play card's gap between the preview board and the controls (px). */
export const WIDE_GAP = 24;
/** The controls column never gets narrower than this (the slider's labels must fit). */
const WIDE_CONTROLS_MIN = 300;

/**
 * The wide Play card's preview board edge: as tall as the card's inside, as long as the controls
 * keep their room; never under 120px. 300px at 1440×900 (the mock), more where the card has it.
 */
export function widePreviewBoardSize(width: number, height: number): number {
  return Math.floor(Math.max(120, Math.min(height, width - WIDE_GAP - WIDE_CONTROLS_MIN)));
}
