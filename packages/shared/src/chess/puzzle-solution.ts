/**
 * A game puzzle's checks once its position is a candidate (docs/puzzles-from-games.md, "Finding
 * puzzles" 3, 4, 6 and 7): the clear-cut rule, the solution line, the difficulty curve from Maia 3
 * and the themes. The engine comes in as a search function (chess/puzzle-generator.ts makes it), so
 * everything here runs against scripted lines in tests.
 */
import type { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { squareRank, makeSquare, parseUci } from "chessops/util";
import {
  MAIA3_RATINGS,
  nearestMaia3Rating,
  type Maia3Evaluator,
  type Maia3Output
} from "../engine/maia3";
import type { AnalysisLine, EngineScore } from "../types/engine";
import type { GamePuzzleContent } from "../types/game-puzzles";
import { legalMoveCount, sideToMoveWin } from "./move-assessment";
import { positionFromFen } from "./position";
import { standardCastlingUci } from "./review";
import { analyzeTacticsForPosition } from "./tactics";

/** Clear-cut: the best move is at least this many win-% points ahead of the second best. */
const ONLY_MOVE_GAP = 35;
/** A mate with an alternative mate is clear-cut while the best non-mating move stays under this. */
const NON_MATING_WIN_CEILING = 80;
/** Chance kinds: the solver must stand at least this well (centipawns, +2 pawns) or mate. */
const CHANCE_ADVANTAGE_CP = 200;
/** A solution has at most this many solver moves. */
const MAX_SOLUTION_MOVES = 8;
/** Difficulty: the lowest rating at which the whole solution is found at least this often. */
const DIFFICULTY_CHANCE = 0.5;
/** Mate themes are tagged up to this length (as Lichess's are). */
const MAX_MATE_THEME = 5;

/** One engine line as the generator reads it: score from the side to move, moves in UCI. */
export type PuzzleEngineLine = Pick<AnalysisLine, "multipv" | "score" | "pv">;

export type PuzzleEngineSearch = {
  depth: number;
  multipv: number;
  /** Restricts the search to these moves (UCI `searchmoves`). */
  searchmoves?: readonly string[];
};

/**
 * One search for the generator: its lines best first, each with a first move (in standard UCI
 * castling, `e1g1`); the generator's version honours cancellation and the yield hook.
 */
export type PuzzleSearch = (fen: string, search: PuzzleEngineSearch) => Promise<PuzzleEngineLine[]>;

/** The Maia 3 port: one output per query, in order (main's evaluator fits). */
export type PuzzleMaia = Pick<Maia3Evaluator, "evaluate">;

/** The side to move has a forced mate. */
export function mates(score: EngineScore): boolean {
  return score.type === "mate" && score.value > 0;
}

/** The side to move stands at +2 pawns or better, or mates (what a chance kind must keep). */
export function standsWinning(score: EngineScore): boolean {
  return mates(score) || (score.type === "cp" && score.value >= CHANCE_ADVANTAGE_CP);
}

/** `uci` played on `pos` (mutated); false when it isn't a legal move there. */
function playUci(pos: Chess, uci: string): boolean {
  const move = parseUci(uci);
  if (!move || !pos.isLegal(move)) return false;
  pos.play(move);
  return true;
}

function fenOf(pos: Chess): string {
  return makeFen(pos.toSetup());
}

/** Every legal move at `fen` in standard UCI (`e1g1` castling; one per promotion piece). */
function legalMoves(fen: string): string[] {
  const pos = positionFromFen(fen);
  const moves: string[] = [];
  for (const [from, dests] of pos.allDests()) {
    const pawn = pos.board.get(from)?.role === "pawn";
    for (const to of dests) {
      const uci = standardCastlingUci(fen, `${makeSquare(from)}${makeSquare(to)}`);
      const last = squareRank(to) === 0 || squareRank(to) === 7;
      if (pawn && last) for (const piece of "qrbn") moves.push(`${uci}${piece}`);
      else moves.push(uci);
    }
  }
  return moves;
}

/** Where a clear-cut check is asked: the position, its legal move count and the search depth. */
type ClearCutPosition = {
  fen: string;
  legal: number;
  depth: number;
  /** The puzzle's first move: an only legal move doesn't count there. */
  first: boolean;
};

/**
 * Whether the best of `lines` (MultiPV 2 at `at.fen`, best first) is clear-cut: it is at least
 * {@link ONLY_MOVE_GAP} win-% ahead of the second best; or it mates and either the second best
 * doesn't, or it mates at once and the best move that doesn't mate leaves the side to move under
 * 80 win-% (the trainer takes any mating move, but only one line of a longer mate); or it is the
 * only legal move (never the first move of a puzzle).
 */
export async function isClearCut(
  search: PuzzleSearch,
  at: ClearCutPosition,
  lines: readonly PuzzleEngineLine[]
): Promise<boolean> {
  if (at.legal === 1) return !at.first;
  const best = lines.at(0);
  const second = lines.at(1);
  if (!best || !second) return false;
  if (!mates(best.score))
    return sideToMoveWin(best.score) - sideToMoveWin(second.score) >= ONLY_MOVE_GAP;
  if (!mates(second.score)) return true;
  if (best.score.value !== 1) return false;
  const mating = new Set(lines.filter((line) => mates(line.score)).map((line) => line.pv.at(0)));
  return (await bestNonMatingWin(search, at, mating)) < NON_MATING_WIN_CEILING;
}

/**
 * The side to move's win-% after its best move that doesn't mate: the moves found to mate are
 * left out of the search one by one until its best line doesn't mate. 0 when every move mates; an
 * engine that ignores `searchmoves` counts as a winning alternative (100).
 */
async function bestNonMatingWin(
  search: PuzzleSearch,
  at: ClearCutPosition,
  mating: Set<string | undefined>
): Promise<number> {
  const moves = legalMoves(at.fen);
  for (let round = 0; round < moves.length; round += 1) {
    const rest = moves.filter((move) => !mating.has(move));
    if (!rest.length) return 0;
    const lines = await search(at.fen, { depth: at.depth, multipv: 1, searchmoves: rest });
    const line = lines.at(0);
    const move = line?.pv.at(0);
    if (!line || !move || mating.has(move)) return 100;
    if (!mates(line.score)) return sideToMoveWin(line.score);
    mating.add(move);
  }
  return 100;
}

/** The rules a solution is built by, from the puzzle's kind and how it came about. */
export type SolutionRules = {
  /** Chance kinds: every solver move must keep the solver at +2 pawns or a mate. */
  chance: boolean;
  /** Fewest solver moves the solution may have. */
  minMoves: number;
};

/** One opponent reply and the solver's answer to it, when the line goes on. */
type NextPair = { reply: string; move: string; forced: boolean; pos: Chess };

/**
 * The solution from a candidate position (`start.fen`), given its deep lines (MultiPV 2 at the
 * verify depth, best first, already found clear-cut): the best move, then alternately the
 * opponent's best reply (MultiPV 1) and the solver's best move, kept only while it is clear-cut and,
 * for chance kinds, the solver still stands at +2 pawns or mates; at most 8 solver moves. A mating
 * line must reach the mate. Trailing solver moves that were the only legal move are dropped. Null
 * when no puzzle comes of it: the first move fails the chance rule, a mating line stops short of the
 * mate, or the line has fewer than `rules.minMoves` solver moves.
 */
export async function buildSolution(
  search: PuzzleSearch,
  start: { fen: string; depth: number },
  lines: readonly PuzzleEngineLine[],
  rules: SolutionRules
): Promise<string[] | null> {
  const first = lines.at(0);
  const firstMove = first?.pv.at(0);
  if (!first || !firstMove || (rules.chance && !standsWinning(first.score))) return null;
  let pos = positionFromFen(start.fen);
  if (!playUci(pos, firstMove)) return null;
  const moves = [firstMove];
  const forced = [false];
  while (forced.length < MAX_SOLUTION_MOVES && !pos.isEnd()) {
    const next = await nextPair(search, pos, start.depth, rules);
    if (!next) break;
    moves.push(next.reply, next.move);
    forced.push(next.forced);
    pos = next.pos;
  }
  if (mates(first.score) && !pos.isCheckmate()) return null;
  if (!pos.isCheckmate()) dropForcedTail(moves, forced);
  return forced.length >= rules.minMoves ? moves : null;
}

/**
 * Drops the solver's trailing only moves (and the replies before them), keeping the first move. A
 * line that ends in mate keeps them: the mate is the point.
 */
function dropForcedTail(moves: string[], forced: boolean[]): void {
  while (forced.length > 1 && forced.at(-1)) {
    forced.pop();
    moves.splice(-2);
  }
}

/** The opponent's best reply at `pos` and the solver's move after it, if the line goes on. */
async function nextPair(
  search: PuzzleSearch,
  pos: Chess,
  depth: number,
  rules: SolutionRules
): Promise<NextPair | null> {
  const replies = await search(fenOf(pos), { depth, multipv: 1 });
  const reply = replies.at(0)?.pv.at(0);
  const next = pos.clone();
  if (!reply || !playUci(next, reply) || next.isEnd()) return null;
  const fen = fenOf(next);
  const legal = legalMoveCount(fen);
  const lines = await search(fen, { depth, multipv: 2 });
  const best = lines.at(0);
  const move = best?.pv.at(0);
  if (!best || !move || (rules.chance && !standsWinning(best.score))) return null;
  if (!(await isClearCut(search, { fen, legal, depth, first: false }, lines))) return null;
  if (!playUci(next, move)) return null;
  return { reply, move, forced: legal === 1, pos: next };
}

/** The position before each of the solver's moves in `solution` (from `fen`), with that move. */
function solverTurns(fen: string, solution: readonly string[]): { fen: string; uci: string }[] {
  const pos = positionFromFen(fen);
  const turns: { fen: string; uci: string }[] = [];
  solution.forEach((uci, index) => {
    if (index % 2 === 0) turns.push({ fen: fenOf(pos), uci });
    playUci(pos, uci);
  });
  return turns;
}

/** Maia's probability of `uci` in `output` (castling compared in standard UCI); 0 when absent. */
export function maiaProbability(fen: string, output: Maia3Output, uci: string): number {
  const target = standardCastlingUci(fen, uci);
  for (const [move, probability] of Object.entries(output.policy))
    if (standardCastlingUci(fen, move) === target) return probability;
  return 0;
}

type PuzzleDifficulty = Pick<
  GamePuzzleContent,
  "difficulty" | "difficultyCapped" | "userChance" | "chanceRating"
>;

/**
 * The puzzle's difficulty from Maia 3: for each grid rating r (600–2600), the chance players at r
 * find the whole solution, the product over the solver's moves of Maia's probability of that move
 * (both sides read at r). Difficulty is the lowest r whose chance is at least 50%; capped (2600+)
 * when none is. The chance at the user's rating (snapped to the grid) is kept too.
 */
export async function puzzleDifficulty(
  maia: PuzzleMaia,
  puzzle: { fen: string; solution: readonly string[] },
  userRating: number,
  signal?: AbortSignal
): Promise<PuzzleDifficulty> {
  const turns = solverTurns(puzzle.fen, puzzle.solution);
  const queries = MAIA3_RATINGS.flatMap((rating) =>
    turns.map((turn) => ({ fen: turn.fen, eloSelf: rating, eloOppo: rating }))
  );
  signal?.throwIfAborted();
  const outputs = await maia.evaluate(queries, { signal });
  if (outputs.length !== queries.length)
    throw new Error("Maia 3 answered a different number of positions.");
  const chances = MAIA3_RATINGS.map((rating, ratingIndex) =>
    turns.reduce((chance, turn, turnIndex) => {
      const output = outputs.at(ratingIndex * turns.length + turnIndex);
      return chance * (output ? maiaProbability(turn.fen, output, turn.uci) : 0);
    }, 1)
  );
  const found = chances.findIndex((chance) => chance >= DIFFICULTY_CHANCE);
  const chanceRating = nearestMaia3Rating(userRating);
  return {
    difficulty: found >= 0 ? (MAIA3_RATINGS[found] ?? null) : null,
    difficultyCapped: found < 0,
    userChance: chances[MAIA3_RATINGS.indexOf(chanceRating)] ?? null,
    chanceRating
  };
}

/**
 * Lichess theme names for the solution from `fen`: a fork, pin or skewer the solver's moved piece
 * makes (chess/tactics.ts, only what the move created; never the mating move), and `mate` /
 * `mateInN` when it ends in checkmate.
 */
export function solutionThemes(fen: string, solution: readonly string[]): string[] {
  const pos = positionFromFen(fen);
  const solver = pos.turn;
  const themes = new Set<string>();
  solution.forEach((uci, index) => {
    const before = fenOf(pos);
    if (!playUci(pos, uci) || index % 2 !== 0 || pos.isCheckmate()) return;
    const to = uci.slice(2, 4);
    for (const fact of analyzeTacticsForPosition(fenOf(pos), solver, { fenBefore: before })) {
      if (fact.kind === "fork" && fact.attacker.square === to) themes.add("fork");
      if (fact.kind === "pin" && fact.pinner.square === to) themes.add("pin");
      if (fact.kind === "skewer" && fact.attacker.square === to) themes.add("skewer");
    }
  });
  if (pos.isCheckmate()) {
    themes.add("mate");
    const length = Math.ceil(solution.length / 2);
    if (length <= MAX_MATE_THEME) themes.add(`mateIn${length}`);
  }
  return [...themes];
}
