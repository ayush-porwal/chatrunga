/**
 * Lichess account, play and game import (main/lichess). The main process owns the OAuth token and
 * every request to lichess.org; the renderer sees these shapes over IPC and follows
 * `events.onLichessEvent`.
 */

export type LichessSpeed =
  | "ultraBullet"
  | "bullet"
  | "blitz"
  | "rapid"
  | "classical"
  | "correspondence";

export type LichessPerf = { rating: number; games: number; provisional: boolean };

export type LichessAccount = {
  /** Lichess user id (lowercase username). */
  id: string;
  username: string;
  title: string | null;
  perfs: Partial<Record<LichessSpeed, LichessPerf>>;
  connectedAt: number;
  /** When games were last imported (epoch ms), null before the first import. */
  lastSyncAt: number | null;
};

export type LichessStatus = {
  account: LichessAccount | null;
  /** The browser sign-in is in progress. */
  connecting: boolean;
  /** Lichess rejected the saved token (revoked or expired): reconnect. The account is kept for its name. */
  tokenRejected: boolean;
};

export type LichessPlayer = {
  /** Lichess user id; null for the Lichess AI. */
  id: string | null;
  name: string;
  rating: number | null;
  title: string | null;
  /** Lichess AI level 1–8 when the player is the AI. */
  aiLevel: number | null;
};

/**
 * Lichess game status names (a subset matters to us): `created`, `started`, `aborted`, `mate`,
 * `resign`, `stalemate`, `timeout`, `draw`, `outoftime`, `cheat`, `noStart`, `unknownFinish`,
 * `variantEnd`. Anything but `created` / `started` means the game is over.
 */
export type LichessGameStatus = string;

export type LichessGameState = {
  /** Every move so far, in UCI. */
  moves: string[];
  /** Remaining clock time (ms), as of this state. */
  wtime: number;
  btime: number;
  winc: number;
  binc: number;
  status: LichessGameStatus;
  winner: "white" | "black" | null;
  /** Side currently offering a draw, if any. */
  drawOffer: "white" | "black" | null;
};

export type LichessGameFull = {
  id: string;
  /** Lichess variant key: `standard`, `fromPosition`, `chess960`, `atomic`, … (Chaturanga plays the first two). */
  variant: string;
  rated: boolean;
  speed: LichessSpeed;
  /** Null for correspondence / unlimited games. */
  clock: { initialMs: number; incrementMs: number } | null;
  white: LichessPlayer;
  black: LichessPlayer;
  /** Starting FEN (the standard position for normal games). */
  initialFen: string;
  state: LichessGameState;
  createdAt: number;
};

export type LichessChallenge = {
  id: string;
  /** "in": someone challenges you; "out": your challenge waiting for an answer. */
  direction: "in" | "out";
  /** The other player. */
  opponent: LichessPlayer;
  rated: boolean;
  speed: LichessSpeed;
  timeControl: { minutes: number; incrementSec: number } | null;
  /** The side YOU would play. */
  yourColor: "white" | "black" | "random";
};

/** Quick pairing (a lobby seek). Lichess only allows rapid and slower for apps. */
export type LichessSeekInput = {
  minutes: number;
  incrementSec: number;
  rated: boolean;
  /** Opponent rating range, absolute (e.g. [1600, 2000]); null for any. */
  ratingRange: [number, number] | null;
};

export type LichessChallengeInput = {
  username: string;
  minutes: number;
  incrementSec: number;
  rated: boolean;
  color: "white" | "black" | "random";
};

export type LichessAiChallengeInput = {
  level: number;
  minutes: number;
  incrementSec: number;
  color: "white" | "black" | "random";
};

export type LichessSyncResult = { imported: number; skipped: number };

export type LichessEvent =
  | { type: "status"; status: LichessStatus }
  | { type: "seek"; searching: boolean; error: string | null }
  | { type: "challenge"; challenge: LichessChallenge }
  | { type: "challengeGone"; challengeId: string; reason: "accepted" | "declined" | "canceled" }
  /** A game of yours started (seek paired, challenge accepted, AI game, or found on reconnect). */
  | { type: "gameStart"; gameId: string }
  | { type: "gameFull"; game: LichessGameFull }
  | { type: "gameState"; gameId: string; state: LichessGameState }
  /** The game stream closed before the game ended (network); the main process retries on its own. */
  | { type: "gameConnection"; gameId: string; connected: boolean }
  | { type: "sync"; running: boolean; imported: number; error: string | null };
