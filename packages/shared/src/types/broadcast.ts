/**
 * Lichess broadcasts (relays of over-the-board events, main/broadcasts). The data is public: no
 * account is needed. The main process makes every request to lichess.org and checks the answers;
 * the renderer sees these shapes over IPC and follows `events.onBroadcastEvent` for live moves.
 */

/** The FIDE time-control category Lichess gives a tournament. */
export type BroadcastFideTimeControl = "standard" | "rapid" | "blitz";

export type BroadcastTourInfo = {
  format: string | null;
  /** The time control as the organiser writes it ("90 min + 30 sec / move"). */
  timeControl: string | null;
  fideTimeControl: BroadcastFideTimeControl | null;
  location: string | null;
  /** Notable players, as the organiser lists them. */
  players: string | null;
  website: string | null;
  standings: string | null;
  /** IANA time zone of the venue. */
  timeZone: string | null;
};

export type BroadcastTour = {
  id: string;
  name: string;
  slug: string;
  /** Banner image on Lichess's image host (https://image.lichess1.org/…), or null. */
  image: string | null;
  /** The organiser's description (Markdown), or null. */
  description: string | null;
  /** Lichess's ranking of official broadcasts (higher is more prominent); null for others. */
  tier: number | null;
  /** First and last day (epoch ms); `end` is null for a one-day event. */
  dates: { start: number; end: number | null } | null;
  info: BroadcastTourInfo;
  url: string;
};

export type BroadcastRound = {
  id: string;
  name: string;
  slug: string;
  url: string;
  /** Scheduled start (epoch ms), or null when not announced. */
  startsAt: number | null;
  /** Games of this round are being played now. */
  ongoing: boolean;
  /** Every game of this round has ended. */
  finished: boolean;
};

/** A tournament in a list (the top broadcasts, search), with the round it points to. */
export type BroadcastListing = {
  tour: BroadcastTour;
  /** The current, next or last round; null when the tournament has none yet. */
  round: BroadcastRound | null;
  /** The group (a series of tournaments) it belongs to, by name. */
  group: string | null;
};

export type BroadcastTopPage = {
  /** Tournaments in progress (a round live now, or the next one coming). */
  active: BroadcastListing[];
  /** Finished tournaments, most recent first. */
  past: BroadcastListing[];
  /** The next page of `past` (for `top(page)`), or null on the last one. */
  nextPastPage: number | null;
};

export type BroadcastTourDetail = {
  tour: BroadcastTour;
  rounds: BroadcastRound[];
  /** The round Lichess opens the tournament on (the live or next one). */
  defaultRoundId: string | null;
};

export type BroadcastPlayer = {
  name: string;
  title: string | null;
  rating: number | null;
  /** FIDE federation code ("NOR"). */
  federation: string | null;
  fideId: number | null;
};

/** A result as Lichess writes it; `*` is a game still being played (or not started). */
export type BroadcastResult = "*" | "1-0" | "0-1" | "½-½";

/** A game of a round, as the round's summary has it (one request for every board). */
export type BroadcastGame = {
  /** The game's id (the round study's chapter id). */
  id: string;
  name: string;
  white: BroadcastPlayer;
  black: BroadcastPlayer;
  /** Remaining time (ms) as of the last move, when the source sends clocks. */
  whiteClockMs: number | null;
  blackClockMs: number | null;
  fen: string;
  /** UCI of the last move, or null before the first one. */
  lastMove: string | null;
  /** Seconds since the last move while the game is in progress, or null. */
  thinkTimeSec: number | null;
  result: BroadcastResult;
};

export type BroadcastRoundDetail = {
  tour: BroadcastTour;
  round: BroadcastRound;
  games: BroadcastGame[];
};

/** A player's line in a tournament's standings. */
export type BroadcastStanding = BroadcastPlayer & {
  rank: number | null;
  score: number | null;
  played: number | null;
  performance: number | null;
  /** Rating change over the event so far. */
  ratingDiff: number | null;
};

export type BroadcastMove = {
  uci: string;
  san: string;
  /** The mover's remaining time after it, as `[%clk]` writes it ("1:02:03"), or null. */
  clock: string | null;
};

/** A game of a watched round as the live stream last sent it (its whole move list). */
export type BroadcastLiveGame = {
  id: string;
  roundId: string;
  white: BroadcastPlayer;
  black: BroadcastPlayer;
  /** The starting position (the standard one for most games). */
  initialFen: string;
  moves: BroadcastMove[];
  /** The position after the last move. */
  fen: string;
  lastMove: string | null;
  result: BroadcastResult;
  /** PGN tags worth keeping with an analysed copy. */
  headers: {
    event: string | null;
    round: string | null;
    date: string | null;
    timeControl: string | null;
    site: string | null;
  };
};

export type BroadcastEvent =
  /** A game of a watched round changed (or was sent when the watch started). */
  | { type: "game"; game: BroadcastLiveGame }
  /**
   * A watched round's stream dropped (or failed to open) or came back. The main process retries on
   * its own (`retrying`) unless Lichess refused it for good, when it stops and `error` says why.
   */
  | {
      type: "connection";
      roundId: string;
      connected: boolean;
      error: string | null;
      retrying: boolean;
    };

/** A desktop notification about a broadcast game ("Carlsen – Gukesh: 1–0"). */
export type BroadcastAlert = { title: string; body: string };
