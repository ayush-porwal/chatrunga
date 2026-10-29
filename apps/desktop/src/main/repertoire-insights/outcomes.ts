/**
 * One game against one repertoire, as Insights stores it (docs/repertoire-games-and-practice.md
 * §5.1), and which of a game's rows its outcome comes from. Pure.
 */
import { makeFen } from "chessops/fen";
import { makeSanAndPlay } from "chessops/san";
import { parseUci } from "chessops/util";
import { sideToMoveWin } from "@chaturanga/shared/chess/move-assessment";
import { rootPly } from "@chaturanga/shared/chess/pgn";
import { positionFromFen } from "@chaturanga/shared/chess/position";
import { positionKey } from "@chaturanga/shared/chess/repertoire-position";
import type { Color } from "@chaturanga/shared/types/chess";
import type { EngineScore } from "@chaturanga/shared/types/engine";
import { isRecord } from "@chaturanga/shared/types/guards";
import type {
  ComparisonIssueStatus,
  RepertoireComparison
} from "@chaturanga/shared/types/repertoire";
import type { InsightsOutcome } from "@chaturanga/shared/types/repertoire-insights";
import type { OutcomeRecord, StoredMove, StoredOutcome } from "./repository";

/** Bumped when what a comparison stores changes: every game is compared again. */
export const INSIGHTS_ALGO_VERSION = 1;
/** The opening is what matters: games are compared over their first 30 moves. */
export const COMPARED_PLIES = 60;
/** "After leaving book" reads the user's win-% this many plies after the move that left it. */
const AFTER_BOOK_PLIES = 10;

const OUTCOME_OF_ISSUE: Record<ComparisonIssueStatus, StoredOutcome> = {
  "player-deviation": "forgot",
  "uncovered-opponent": "new-reply",
  "preparation-ends": "ended-in-book",
  "no-applicable-chapter": "not-covered"
};

/** A compared game: its id, colour, play time, content stamp, and its main line. */
export type ComparedGameInput = {
  id: string;
  color: Color;
  rootFen: string;
  moves: readonly string[];
  playedAt: number | null;
  hash: string;
};

/** A review move's plies and evaluations, as the after-book loss reads them. */
type ReviewedMove = {
  ply: number;
  fenBefore: string;
  fenAfter: string;
  evalBefore: EngineScore | null;
  evalAfter: EngineScore | null;
};

const isScore = (value: unknown): value is EngineScore =>
  isRecord(value) &&
  (value.type === "cp" || value.type === "mate") &&
  typeof value.value === "number" &&
  Number.isFinite(value.value);

/** A stored review's moves, as far as they can be read (a damaged move is left out). */
export function reviewedMoves(review: unknown): ReviewedMove[] {
  if (!isRecord(review) || !Array.isArray(review.moves)) return [];
  const moves: ReviewedMove[] = [];
  for (const move of review.moves) {
    if (!isRecord(move) || !Number.isInteger(move.ply)) continue;
    if (typeof move.fenBefore !== "string" || typeof move.fenAfter !== "string") continue;
    moves.push({
      ply: Number(move.ply),
      fenBefore: move.fenBefore,
      fenAfter: move.fenAfter,
      evalBefore: isScore(move.evalBefore) ? move.evalBefore : null,
      evalAfter: isScore(move.evalAfter) ? move.evalAfter : null
    });
  }
  return moves;
}

const turnOf = (fen: string): Color => (fen.split(" ")[1] === "b" ? "black" : "white");

/** The user's win-% in a position from a side-to-move score. */
function userWin(score: EngineScore, fen: string, color: Color): number {
  const win = sideToMoveWin(score);
  return turnOf(fen) === color ? win : 100 - win;
}

/**
 * The win-% the user lost from just before the move at `ply` (the one that left the repertoire)
 * to 10 plies later (or the game's last reviewed move before that); null without the evaluations.
 */
export function afterBookLoss(
  moves: readonly ReviewedMove[],
  ply: number,
  color: Color
): number | null {
  const byPly = new Map(moves.map((move) => [move.ply, move]));
  const first = byPly.get(ply);
  if (!first?.evalBefore) return null;
  let last: ReviewedMove | undefined;
  for (let at = ply + AFTER_BOOK_PLIES - 1; at >= ply && !last?.evalAfter; at -= 1) {
    last = byPly.get(at);
  }
  if (!last?.evalAfter) return null;
  return (
    userWin(first.evalBefore, first.fenBefore, color) -
    userWin(last.evalAfter, last.fenAfter, color)
  );
}

/** The compared moves up to and including the issue's (all of them without one). */
function storedLine({ moves, issue }: RepertoireComparison): StoredMove[] {
  const end = issue ? moves.findIndex((move) => move.ply === issue.ply) : -1;
  return moves
    .slice(0, end === -1 ? undefined : end + 1)
    .map((move) => ({ uci: move.uci, san: move.san, key: move.positionKey }));
}

/**
 * The row a comparison of `game` with a repertoire stores. `review` reads the game's reviewed
 * moves; it is called only for a game that left the book.
 */
export function outcomeRecord(
  game: ComparedGameInput,
  comparison: RepertoireComparison,
  review: () => readonly ReviewedMove[],
  now: number
): OutcomeRecord {
  const { issue } = comparison;
  const leftBook = issue && issue.status !== "no-applicable-chapter";
  return {
    gameId: game.id,
    repertoireId: comparison.repertoireId,
    color: game.color,
    outcome: issue ? OUTCOME_OF_ISSUE[issue.status] : "in-book",
    ply: issue?.ply ?? null,
    positionKey: issue?.positionKey ?? null,
    playedUci: issue?.playedUci ?? null,
    expectedUcis: issue?.expectedUcis ?? [],
    chapterId: issue?.chapterId ?? null,
    matchedPlies: comparison.matchedPlies,
    moves: storedLine(comparison),
    rootFen: game.rootFen,
    playedAt: game.playedAt,
    afterBookLoss: leftBook ? afterBookLoss(review(), issue.ply, game.color) : null,
    gameHash: game.hash,
    revision: comparison.revision,
    algoVersion: INSIGHTS_ALGO_VERSION,
    comparedAt: now
  };
}

/**
 * A game's first `count` moves as a stored line (a game without a repertoire of its colour keeps
 * them for "Openings not in your repertoire"); it stops at a move that can't be played.
 */
export function firstMoves(rootFen: string, ucis: readonly string[], count: number): StoredMove[] {
  const moves: StoredMove[] = [];
  try {
    const position = positionFromFen(rootFen);
    for (const uci of ucis.slice(0, count)) {
      const move = parseUci(uci);
      if (!move || !position.isLegal(move)) break;
      const key = positionKey(makeFen(position.toSetup()));
      moves.push({ uci, san: makeSanAndPlay(position, move), key });
    }
  } catch {
    // A start that can't be read has no moves to show.
  }
  return moves;
}

/** The row of a game that isn't compared: no user side, or no repertoire of its colour. */
export function uncomparedRecord(
  game: Omit<ComparedGameInput, "color" | "moves"> & { color: Color | null },
  outcome: "no-user-side" | "no-repertoire",
  now: number,
  moves: StoredMove[] = []
): OutcomeRecord {
  return {
    gameId: game.id,
    repertoireId: null,
    color: game.color,
    outcome,
    ply: null,
    positionKey: null,
    playedUci: null,
    expectedUcis: [],
    chapterId: null,
    matchedPlies: 0,
    moves,
    rootFen: game.rootFen,
    playedAt: game.playedAt,
    afterBookLoss: null,
    gameHash: game.hash,
    revision: 0,
    algoVersion: INSIGHTS_ALGO_VERSION,
    comparedAt: now
  };
}

/**
 * The row a game's outcome comes from: the repertoire it followed longest (most matched plies),
 * ties to the first created. `createdAt` gives each repertoire's creation time.
 */
export function bestRecord<T extends Pick<OutcomeRecord, "repertoireId" | "matchedPlies">>(
  records: readonly T[],
  createdAt: (repertoireId: string) => number
): T | null {
  let best: T | null = null;
  for (const record of records) {
    if (!best) {
      best = record;
      continue;
    }
    if (record.repertoireId === null || best.repertoireId === null) {
      if (best.repertoireId === null && record.repertoireId !== null) best = record;
      continue;
    }
    const longer = record.matchedPlies - best.matchedPlies;
    if (
      longer > 0 ||
      (longer === 0 && createdAt(record.repertoireId) < createdAt(best.repertoireId))
    )
      best = record;
  }
  return best;
}

/** The issue is one side's first move of the game: not a slip, another opening (§5.2). */
export function leftAtFirstMoves(record: Pick<OutcomeRecord, "ply" | "rootFen">): boolean {
  return record.ply !== null && record.ply - (rootPly(record.rootFen ?? "") + 1) < 2;
}

/** The outcome shown for a game's row: a slip or reply at the very first moves is another opening. */
export function shownOutcome(
  record: Pick<OutcomeRecord, "outcome" | "ply" | "rootFen">
): InsightsOutcome {
  if ((record.outcome === "forgot" || record.outcome === "new-reply") && leftAtFirstMoves(record))
    return "not-covered";
  return record.outcome;
}
