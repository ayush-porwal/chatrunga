/**
 * An engine game's names and ratings: the headers a new game is saved with, and Maia's rating
 * (Maia 3 plays at any rating 600–2600; one engine row, `runtime: "maia3"`) when it is the
 * opponent, at the start and when a saved game is played on.
 */
import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import { MAIA3_DEFAULT_RATING, nearestMaia3Rating } from "@chaturanga/shared/engine/maia3";
import {
  parseGameRating,
  resolveReviewRating,
  resolveReviewSideRatings
} from "@chaturanga/shared/chess/review-rating";
import type { Color, GameHeaders } from "@chaturanga/shared/types/chess";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import type { PlayerRatings } from "@chaturanga/shared/types/ratings";

/** Maia as a player: "Maia 1500" (as Play names it), also a Maia 1 game's "Maia 1500 (managed)". */
const MAIA_PLAYER = /^Maia (\d{3,4})$/;

/** Maia 3's engine row (the one Maia opponent). */
export function isMaiaEngine(engine: Partial<Pick<EngineConfig, "runtime">> | null | undefined) {
  return engine?.runtime === "maia3";
}

/** Maia's player name at a rating: "Maia 1500". */
export function maiaPlayerName(rating: number): string {
  return `Maia ${rating}`;
}

/** A player named as Maia at a rating ("Maia 1500", "Maia 1500 (managed)"). */
export function isMaiaPlayer(name: string | null | undefined): boolean {
  return MAIA_PLAYER.test(engineDisplayName(name?.trim() ?? ""));
}

/** An engine game's PGN TimeControl tag for its clock: `300+3`, or `-` without one. */
export function clockTag(clock: { initialMs: number; incrementMs: number } | null): string {
  return clock
    ? `${Math.floor(clock.initialMs / 1000)}+${Math.floor(clock.incrementMs / 1000)}`
    : "-";
}

/**
 * Maia's rating in Play: the one last chosen (`playMaiaRating`), else your Settings rating for the
 * clock's mode (no clock counts as rapid), else 1500; on Maia's 100-point grid. Game review reads
 * a side without a game rating the same way (resolveReviewSideRatings).
 */
export function playMaiaRating({
  saved,
  ratings,
  timeControl
}: {
  saved: number | null | undefined;
  ratings: PlayerRatings | null | undefined;
  timeControl: string;
}): number {
  return resolveReviewSideRatings({ timeControl, ratings, override: saved ?? null }).white.rating;
}

/** Your Settings rating for the clock's mode (no clock counts as rapid); null without ratings. */
export function yourRating(
  ratings: PlayerRatings | null | undefined,
  timeControl: string | null | undefined
): number | null {
  return ratings ? resolveReviewRating({ side: "white", timeControl, ratings }).rating : null;
}

/**
 * A new engine game's headers: a casual game against the engine at its clock. Against Maia
 * (`maia`), Maia is named with its rating, and the Elo tags carry its rating and yours (when
 * known), which a review of the game and playing it on later read.
 */
export function engineGameHeaders({
  engine,
  engineColor,
  clock,
  maia
}: {
  engine: Pick<EngineConfig, "id" | "name">;
  engineColor: Color;
  clock: { initialMs: number; incrementMs: number } | null;
  maia: { rating: number; yourRating: number | null } | null;
}): GameHeaders {
  const name = maia ? maiaPlayerName(maia.rating) : engineDisplayName(engine.name);
  const engineElo = maia ? String(maia.rating) : null;
  const yourElo = maia?.yourRating ? String(maia.yourRating) : null;
  return {
    event: "Casual game",
    site: "?",
    result: "*",
    timeControl: clockTag(clock),
    // Named sides: the titlebar, board labels and saved game keep the engine's name after the game ends.
    white: engineColor === "white" ? name : "You",
    black: engineColor === "black" ? name : "You",
    whiteElo: engineColor === "white" ? engineElo : yourElo,
    blackElo: engineColor === "black" ? engineElo : yourElo,
    // Which engine it was, so rejoining finds it again even when two share a name.
    engineId: engine.id
  };
}

/**
 * The rating Maia plays a saved game's `maiaSide` at: that side's Elo tag, else the rating in its
 * name ("Maia 1500", a Maia 1 game's "Maia 1500 (managed)"), else 1500; on Maia's grid.
 */
export function savedMaiaRating(
  headers: Pick<GameHeaders, "white" | "black" | "whiteElo" | "blackElo">,
  maiaSide: Color
): number {
  const elo = parseGameRating(maiaSide === "white" ? headers.whiteElo : headers.blackElo);
  const named = MAIA_PLAYER.exec(engineDisplayName(headers[maiaSide]?.trim() ?? ""))?.[1];
  const rating = elo ?? (named ? Number(named) : null);
  return rating === null ? MAIA3_DEFAULT_RATING : nearestMaia3Rating(rating);
}

/**
 * What Maia plays a game's move with (`engines.startGame`'s `maia`): its rating (savedMaiaRating)
 * against yours, from your side's Elo tag, else your Settings rating for the game's clock, else
 * 1500; on Maia's grid.
 */
export function maiaGameRatings(
  headers: Pick<GameHeaders, "white" | "black" | "whiteElo" | "blackElo" | "timeControl">,
  maiaSide: Color,
  ratings: PlayerRatings | null | undefined
): { rating: number; opponentRating: number } {
  const yourElo = parseGameRating(maiaSide === "white" ? headers.blackElo : headers.whiteElo);
  const opponent = yourElo ?? yourRating(ratings, headers.timeControl) ?? MAIA3_DEFAULT_RATING;
  return {
    rating: savedMaiaRating(headers, maiaSide),
    opponentRating: nearestMaia3Rating(opponent)
  };
}
