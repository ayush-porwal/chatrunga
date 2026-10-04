/**
 * "Review as": the side a game is reviewed for. It turns the board to that side, picks which
 * errors become key moments, is "You" in the charts and the commentary, and rates the review
 * (chess/review-rating.ts).
 *
 * - The shown analysis says which side it was made for (`GameReview.side`, saved with it).
 * - Engine games and Lichess games know the user's side: the side played against the engine, or the
 *   one whose name is the connected Lichess account.
 * - Any other game asks before its first review, the side whose name is the Lichess username
 *   preselected (else the Settings side); the choice is saved with the review it starts.
 * - The review settings can switch sides: the shown analysis is then the other side's.
 */
import { useMemo } from "react";
import { create } from "zustand";
import type { Color, GameHeaders, GameSource } from "@chaturanga/shared/types/chess";
import { useGameStore } from "../../stores/game-store";
import { useLichessStore } from "../../stores/lichess-store";
import { useReviewStore } from "../../stores/review-store";
import { suggestedSide } from "./opening-comparison";

export type ReviewSide =
  /** The side is settled: the review is made for (and shown as) `side`. */
  | { status: "known"; side: Color }
  /** No side yet: the panel asks before the review starts, with `preselect` picked. */
  | { status: "ask"; preselect: Color };

export type ReviewSideInput = {
  /** The side picked for this board in this session (the prompt, or the settings' switch). */
  chosen: Color | null;
  /** The shown analysis's side (null: none shown, or it predates Review as). */
  reviewSide: Color | null;
  /** An analysis is shown (one from before Review as never asks again). */
  hasReview: boolean;
  source: GameSource;
  headers: Pick<GameHeaders, "white" | "black">;
  lichessUsername: string | null;
  /** The engine's side in a game being played against it. */
  engineSide: Color | null;
  /** The Settings side: the last resort, and the preselection when no name matches. */
  fallback: Color;
};

/** The side whose name is the Lichess username (either player, whatever the game's source). */
export function sideNamed(
  headers: Pick<GameHeaders, "white" | "black">,
  username: string | null
): Color | null {
  if (!username) return null;
  const name = username.trim().toLowerCase();
  const white = headers.white?.trim().toLowerCase() === name;
  const black = headers.black?.trim().toLowerCase() === name;
  return white === black ? null : white ? "white" : "black";
}

/** Which side the game is reviewed as, or that it must be asked (see the file comment). */
export function resolveReviewSide(input: ReviewSideInput): ReviewSide {
  if (input.chosen) return { status: "known", side: input.chosen };
  if (input.reviewSide) return { status: "known", side: input.reviewSide };
  const known = suggestedSide({
    source: input.source,
    headers: input.headers,
    lichessUsername: input.lichessUsername,
    engineSide: input.engineSide
  });
  if (known) return { status: "known", side: known.color };
  if (input.hasReview) return { status: "known", side: input.fallback };
  return {
    status: "ask",
    preselect: sideNamed(input.headers, input.lichessUsername) ?? input.fallback
  };
}

/** The side picked for a board (the game store's `board` count), kept for this session. */
type ChosenSide = { board: number; side: Color };

export const useReviewSideStore = create<{
  chosen: ChosenSide | null;
  choose: (board: number, side: Color) => void;
}>((set) => ({
  chosen: null,
  choose: (board, side) => set({ chosen: { board, side } })
}));

/** The side picked for `board`, or null when none was (or it was for another board). */
export function chosenSideFor(chosen: ChosenSide | null, board: number): Color | null {
  return chosen && chosen.board === board ? chosen.side : null;
}

type SideStores = {
  game: Pick<
    ReturnType<typeof useGameStore.getState>,
    "board" | "source" | "headers" | "engineSide"
  >;
  review: ReturnType<typeof useReviewStore.getState>["review"];
  chosen: ChosenSide | null;
  lichessUsername: string | null;
};

function sideFromStores(stores: SideStores, fallback: Color): ReviewSide {
  const { game, review } = stores;
  return resolveReviewSide({
    chosen: chosenSideFor(stores.chosen, game.board),
    reviewSide: review?.side ?? null,
    hasReview: Boolean(review),
    source: game.source,
    headers: game.headers,
    lichessUsername: stores.lichessUsername,
    engineSide: game.engineSide,
    fallback
  });
}

/** The loaded game's review side, read once (starting a review). */
export function currentReviewSide(fallback: Color): ReviewSide {
  return sideFromStores(
    {
      game: useGameStore.getState(),
      review: useReviewStore.getState().review,
      chosen: useReviewSideStore.getState().chosen,
      lichessUsername: useLichessStore.getState().status.account?.username ?? null
    },
    fallback
  );
}

/** The loaded game's review side (see the file comment). */
export function useReviewSide(fallback: Color): ReviewSide {
  const board = useGameStore((state) => state.board);
  const source = useGameStore((state) => state.source);
  const headers = useGameStore((state) => state.headers);
  const engineSide = useGameStore((state) => state.engineSide);
  const review = useReviewStore((state) => state.review);
  const chosen = useReviewSideStore((state) => state.chosen);
  const lichessUsername = useLichessStore((state) => state.status.account?.username ?? null);
  return useMemo(
    () =>
      sideFromStores(
        { game: { board, source, headers, engineSide }, review, chosen, lichessUsername },
        fallback
      ),
    [board, chosen, engineSide, fallback, headers, lichessUsername, review, source]
  );
}

/**
 * Reviews the loaded game as `side`: kept for this board, and saved with the shown analysis (the
 * autosave writes it), so the game opens as that side next time.
 */
export function chooseReviewSide(side: Color): void {
  useReviewSideStore.getState().choose(useGameStore.getState().board, side);
  useReviewStore.getState().setReviewSide(side);
}

/** The side a known review is made for; the preselected one while it asks. */
export function reviewSideColor(side: ReviewSide): Color {
  return side.status === "known" ? side.side : side.preselect;
}
