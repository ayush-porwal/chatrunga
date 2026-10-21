import type { EngineConfig } from "@chaturanga/shared/types/engine";
import type { PlayOpponent } from "@chaturanga/shared/types/settings";
import { isMaiaEngine } from "./engine-game";

/**
 * How many of the newest games the page reads: the Recent games table's rows (10) plus the one the
 * In progress card may take out of it. The table and the page share this query (one key).
 */
export const RECENT_GAMES_FETCH = 11;

/** A board card beside the Play card. */
export type BoardCardKind = "in-progress" | "repertoire" | "puzzle";

/**
 * The board cards with something to show, in their order: In progress, Repertoire, Puzzle of the
 * day. When the row has no room for all of them the last ones are left out.
 */
export function boardCardKinds(cards: {
  inProgress: boolean;
  repertoire: boolean;
  puzzle: boolean;
}): BoardCardKind[] {
  const kinds: BoardCardKind[] = [];
  if (cards.inProgress) kinds.push("in-progress");
  if (cards.repertoire) kinds.push("repertoire");
  if (cards.puzzle) kinds.push("puzzle");
  return kinds;
}

/*
 * The sizes below are px at the default 16px rem: the cards' padding, text, buttons and the page's
 * gap (`gap-4`, 1rem) are rem-based, and app.css steps the rem up in large windows, so playGrid
 * scales them by the rem it is given.
 */
/**
 * The top row's height: this share of the page's visible height, within its bounds. The floor is
 * what the Play card needs at its tallest (New game / This position, the time control).
 */
const ROW_SHARE = 0.44;
const ROW_MIN = 372;
const ROW_MAX = 420;
/**
 * A board card beyond its board: its padding and border, the tag, title and details, the button.
 * The tallest card's: the Repertoire card's review, whose positions-due line is a second detail.
 */
const BOARD_CARD_CHROME = 164;
/** A board card's padding (p-3, 1.5rem across) and its border (2px, which doesn't scale). */
const BOARD_CARD_PADDING = 24;
const BOARD_CARD_BORDER = 2;
/** The Play column (the Play card, Recent games under it) is never narrower. */
const PLAY_MIN = 340;
/** The Play card's border (1px each side, which doesn't scale). */
const PLAY_CARD_BORDER = 2;
/** The wide Play card body's padding: py-3 down, pl-3 + pr-4 across. */
const WIDE_PADDING_Y = 24;
const WIDE_PADDING_X = 28;

/** The Play page's grid: two columns shared by both rows, and the top row's height. */
export type PlayGrid = {
  /** The top row's height: every card in it is this tall. */
  rowHeight: number;
  /** A board card's width (its board is that less its frame, square). */
  cardWidth: number;
  /** How many board cards fit (the first ones of boardCardKinds). */
  cards: number;
  /** The Play card's column, Recent games' too. */
  playWidth: number;
  /** The board cards' column (the filler's when there are none), the side cards' too. */
  sideWidth: number;
  /**
   * The Play card has room for its preview board at full height (as tall as the card's inside)
   * beside the controls' minimum: the board is shown whole or not at all, never shrunk.
   */
  wide: boolean;
  /**
   * Too narrow for the board cards beside the Play column's minimum (a window zoomed in): one
   * column, the Play card, the board cards, Recent games and the side cards one under the other.
   */
  stacked: boolean;
};

/**
 * The page's grid for its content box (`width` × the visible `height`), the board cards to show
 * (`cards`) and the root font size (`rem`, the page's gap). One row height for the whole top row, from the window's height, so every board
 * is square at it; as many board cards as leave the Play column its minimum (the filler takes one
 * card's place when there are none); the side column exactly as wide as the cards above it, so
 * both rows' edges line up; the Play column takes the rest of the width. Where even one card
 * beside the Play column's minimum doesn't fit, everything goes in one column instead.
 */
export function playGrid({
  width,
  height,
  cards,
  rem = 16
}: {
  width: number;
  height: number;
  cards: number;
  rem?: number;
}): PlayGrid {
  const scaled = (px: number) => (px * rem) / 16;
  const gap = rem;
  const rowHeight = Math.round(
    Math.min(scaled(ROW_MAX), Math.max(scaled(ROW_MIN), height * ROW_SHARE))
  );
  const cardWidth = Math.round(
    rowHeight - scaled(BOARD_CARD_CHROME) + scaled(BOARD_CARD_PADDING) + BOARD_CARD_BORDER
  );
  const across = (count: number) => count * cardWidth + (count - 1) * gap;
  const playMin = scaled(PLAY_MIN);
  const fullBoard = rowHeight - PLAY_CARD_BORDER - scaled(WIDE_PADDING_Y);
  const playWide =
    fullBoard + WIDE_GAP + scaled(WIDE_CONTROLS_MIN) + scaled(WIDE_PADDING_X) + PLAY_CARD_BORDER;
  if (width - cardWidth - gap < playMin) {
    const fit = Math.max(1, Math.floor((width + gap) / (cardWidth + gap)));
    return {
      rowHeight,
      cardWidth,
      cards: Math.min(cards, fit),
      playWidth: width,
      sideWidth: width,
      wide: width >= playWide,
      stacked: true
    };
  }
  let slots = Math.max(1, cards);
  while (slots > 1 && width - across(slots) - gap < playMin) slots -= 1;
  const sideWidth = across(slots);
  const playWidth = Math.max(0, width - sideWidth - gap);
  return {
    rowHeight,
    cardWidth,
    cards: Math.min(cards, slots),
    playWidth,
    sideWidth,
    wide: playWidth >= playWide,
    stacked: false
  };
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

/**
 * Play settings' choice: the opponent, the engine for engine games, and Maia's rating when it was
 * changed there (null: left as it was, so it keeps following your rating for the clock).
 */
export type PlaySettingsChoice = {
  opponent: PlayOpponent;
  engineId: string | null;
  maiaRating: number | null;
};

type PlaySettingsPatch = {
  playOpponent: PlayOpponent;
  playEngineId: string | null;
  playMaiaRating?: number;
};

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
  write: (variables: { patch: PlaySettingsPatch }, options: { onError: () => void }) => void
): void {
  const { opponent, engineId, maiaRating } = choice;
  const before = session().playOpponent;
  session().setPlayOpponent(opponent);
  write(
    {
      patch: {
        playOpponent: opponent,
        playEngineId: engineId,
        ...(maiaRating === null ? {} : { playMaiaRating: maiaRating })
      }
    },
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
 * Engines in the order Play settings lists them: by name (not the registry's creation order), Maia
 * last.
 */
export function playEngineOrder<T extends Pick<EngineConfig, "name" | "runtime">>(
  engines: readonly T[]
): T[] {
  return [...engines].sort(
    (a, b) =>
      Number(isMaiaEngine(a)) - Number(isMaiaEngine(b)) ||
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
  );
}

/** The wide Play card's gap between the preview board and the controls (px). */
export const WIDE_GAP = 24;
/** The controls column never gets narrower than this (the slider's labels must fit). */
const WIDE_CONTROLS_MIN = 300;

/**
 * The wide Play card's preview board edge: as tall as the card's inside. `playGrid` only makes the
 * card wide where that fits beside the controls; the width only trims a rounding pixel or two.
 */
export function widePreviewBoardSize(width: number, height: number): number {
  return Math.floor(Math.max(0, Math.min(height, width - WIDE_GAP - WIDE_CONTROLS_MIN)));
}
