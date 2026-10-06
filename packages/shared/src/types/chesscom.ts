/**
 * Chess.com account and game import (main/chesscom). Chess.com's Published-Data API is read-only
 * and needs no sign-in: an account is just a username, whose public games and ratings the main
 * process reads. Chess.com games can't be played from the app. The renderer sees these shapes over
 * IPC and follows `events.onChesscomEvent`.
 */

/** The ratings chess.com keeps for standard chess (`/stats`: `chess_rapid`, …). */
export const CHESSCOM_RATING_KEYS = ["rapid", "blitz", "bullet", "daily"] as const;
export type ChesscomRatingKey = (typeof CHESSCOM_RATING_KEYS)[number];
export type ChesscomRatings = Partial<Record<ChesscomRatingKey, number>>;

/** How far back the first import reaches; later imports bring in only new games. */
export const CHESSCOM_IMPORT_WINDOWS = ["3months", "year", "all"] as const;
export type ChesscomImportWindow = (typeof CHESSCOM_IMPORT_WINDOWS)[number];
export const DEFAULT_CHESSCOM_IMPORT_WINDOW: ChesscomImportWindow = "year";

/** A chess.com username as chess.com allows it (letters, digits, `_` and `-`). */
export const CHESSCOM_USERNAME = /^[A-Za-z0-9_-]{2,50}$/;

export type ChesscomAccount = {
  /** The username as the API names it (lowercase): the account's id. */
  id: string;
  /** The username as chess.com shows it. */
  username: string;
  title: string | null;
  ratings: ChesscomRatings;
  connectedAt: number;
  /** When games were last imported (epoch ms), null before the first import. */
  lastSyncAt: number | null;
};

export type ChesscomStatus = {
  account: ChesscomAccount | null;
  /** The account is being looked up on chess.com. */
  connecting: boolean;
};

export type ChesscomConnectInput = { username: string; firstImport: ChesscomImportWindow };

export type ChesscomSyncResult = { imported: number; skipped: number };

export type ChesscomEvent =
  | { type: "status"; status: ChesscomStatus }
  | { type: "sync"; running: boolean; imported: number; error: string | null };
