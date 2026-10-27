/**
 * Finds puzzles in one of the user's games (docs/puzzles-from-games.md, "Finding puzzles"): a
 * quick scan of every position, the candidates for each puzzle kind, then a deep check and a
 * solution for each candidate (chess/puzzle-solution.ts), one puzzle per position. The rules follow
 * the ideas of Lichess's puzzle generator (lichess-puzzler); none of its code is used.
 *
 * Pure: the engine, Maia 3 and the opening book come in through small ports, so main runs it
 * against its own UCI process (holding it through `beforeSearch` while the user uses an engine) and
 * tests run it against scripted ones.
 */
import type { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { parseSquare, parseUci } from "chessops/util";
import { nearestMaia3Rating, rankedMoves, type Maia3Output } from "../engine/maia3";
import type { Color } from "../types/chess";
import type { EngineScore, GameReview, MoveReview } from "../types/engine";
import {
  MAIA_PUZZLE_KINDS,
  type GamePuzzleContent,
  type GamePuzzleDepths,
  type GamePuzzleGameProgress,
  type GamePuzzleKind
} from "../types/game-puzzles";
import {
  legalMoveCount,
  materialBalance,
  SEVERITY_THRESHOLDS,
  sideToMoveWin
} from "./move-assessment";
import { inBook, type OpeningBook } from "./opening-book";
import { rootPly } from "./pgn";
import { positionFromFen } from "./position";
import {
  buildSolution,
  isClearCut,
  maiaProbability,
  mates,
  puzzleDifficulty,
  solutionThemes,
  standsWinning,
  type PuzzleEngineLine,
  type PuzzleEngineSearch,
  type PuzzleMaia,
  type PuzzleSearch,
  type SolutionRules
} from "./puzzle-solution";
import { positionKey } from "./repertoire-position";
import { invertScore, scoreFromWhitePerspective, standardCastlingUci } from "./review";

/** Version of the rules below, stored with every puzzle: bump it whenever a rule changes. */
export const GAME_PUZZLE_GENERATOR_VERSION = 1;

/** Your mistake / Opponent's chance: the move gave up at least this much win-% (a Mistake). */
const MISTAKE_LOSS = SEVERITY_THRESHOLDS.mistake;
/** Missed chance: the opponent's move raised the mover's win-% by at least this much. */
const CHANCE_JUMP = 30;
/** Missed chance: the mover was not already winning before it (at most +3 pawns, centipawns). */
const ALREADY_WINNING_CP = 300;
/** Hard find: Maia gives the best move less than this probability at the user's rating. */
const HARD_PROBABILITY = 0.1;
/** Tricky position: Maia puts at least this much weight on moves that lose a Mistake's worth. */
const TRICKY_WEIGHT = 0.5;
/** Tricky position: Maia's likeliest moves are scored until they cover this much weight… */
const TRICKY_COVERAGE = 0.8;
/** …or this many moves. */
const TRICKY_MAX_MOVES = 5;

/** The engine port: MultiPV lines of `fen` (any order), scores from the side to move. */
export type PuzzleEngine = {
  analyse(fen: string, search: PuzzleEngineSearch): Promise<PuzzleEngineLine[]>;
};

/** One position's quick-scan result: its score from the side to move, and the best move. */
export type PuzzleScanEntry = { score: EngineScore; bestMove: string | null };

export type GeneratePuzzlesInput = {
  /** The game's start position and its main line (UCI). */
  rootFen: string;
  moves: readonly string[];
  /** The user's side ({@link userSideOfGame}). */
  userSide: Color;
  /**
   * The rating Maia reads each side at (the game's Elo, else Settings' for the game's mode);
   * snapped to Maia's grid here.
   */
  ratings: { white: number; black: number };
  kinds: readonly GamePuzzleKind[];
  depths: GamePuzzleDepths;
  engine: PuzzleEngine;
  /** Maia 3, when installed: Tricky positions, Hard finds and the difficulty need it. */
  maia?: PuzzleMaia | null;
  /** The opening book (chess/opening-book.ts): book moves never make puzzles. */
  openingBook?: OpeningBook | null;
  /**
   * Saved evaluations to use instead of the quick scan ({@link scanFromReview}), one per position
   * (the end position too); a null entry is scanned.
   */
  scan?: readonly (PuzzleScanEntry | null)[] | null;
  signal?: AbortSignal;
  onProgress?: (progress: GamePuzzleGameProgress) => void;
  /** Awaited before every engine search: main holds it while the user is using an engine. */
  beforeSearch?: () => Promise<void>;
};

/** A puzzle as the `game_puzzles` row stores it. */
export type GeneratedPuzzle = GamePuzzleContent & {
  /** The puzzle position's key (chess/repertoire-position.ts). */
  positionKey: string;
  generatorVersion: number;
  depths: GamePuzzleDepths;
};

/** A position of the game's main line. */
type GamePosition = {
  fen: string;
  turn: Color;
  /** The move played from it (standard UCI castling); null at the end of the game. */
  played: string | null;
  legal: number;
  /** Checkmate, stalemate or a dead draw: nothing to search. */
  end: boolean;
  checkmate: boolean;
  /** It stood on the board before, since the last irreversible move. */
  repeated: boolean;
};

/** One way a candidate may become a puzzle: its kind, its solution's rules, and the played move. */
type Attempt = {
  kind: GamePuzzleKind;
  rules: SolutionRules;
  /** The deep check's demand on the played move: not the best (an error), the best, or either. */
  played: "not-best" | "best" | "any";
};

const ERROR_RULES: SolutionRules = { chance: false, minMoves: 1 };
const CHANCE_RULES: SolutionRules = { chance: true, minMoves: 2 };
const FOUND_RULES: SolutionRules = { chance: false, minMoves: 1 };

type Candidate = {
  index: number;
  /** Every kind whose rule applied, in priority order (the puzzle's tags come from these). */
  applicable: GamePuzzleKind[];
  /** The ways it may become a puzzle, in priority order. */
  attempts: Attempt[];
};

type Run = {
  input: GeneratePuzzlesInput;
  positions: GamePosition[];
  search: PuzzleSearch;
  kinds: ReadonlySet<GamePuzzleKind>;
  /** Maia's reading of the user's candidate positions (by index). */
  maia: Map<number, Maia3Output>;
  scan: PuzzleScanEntry[];
  /** The side to move's win-% at each position (from the scan). */
  wins: number[];
};

/**
 * The puzzles of one game, in game order. Rejects when a move is illegal or the engine finds no
 * move in a live position; rejects with the signal's reason once it is aborted.
 */
export async function generateGamePuzzles(input: GeneratePuzzlesInput): Promise<GeneratedPuzzle[]> {
  const positions = readGame(input.rootFen, input.moves);
  const search = engineSearch(input);
  const scan = await quickScan(input, positions, search);
  const run: Run = {
    input,
    positions,
    search,
    kinds: new Set(input.kinds),
    maia: new Map(),
    scan,
    wins: scan.map((entry) => sideToMoveWin(entry.score))
  };
  run.maia = await maiaReadings(run);
  const candidates: Candidate[] = [];
  const moves = positions.length - 1;
  for (let index = 0; index < moves; index += 1) {
    input.onProgress?.({ phase: "find", done: index, total: moves });
    const candidate = await findCandidate(run, index);
    if (candidate) candidates.push(candidate);
  }
  const puzzles: GeneratedPuzzle[] = [];
  for (const [done, candidate] of candidates.entries()) {
    input.onProgress?.({ phase: "check", done, total: candidates.length });
    const puzzle = await checkCandidate(run, candidate);
    if (puzzle) puzzles.push(puzzle);
  }
  input.onProgress?.({ phase: "check", done: candidates.length, total: candidates.length });
  return puzzles;
}

/** Every position of the main line, the end position too. Throws on an illegal move. */
function readGame(rootFen: string, moves: readonly string[]): GamePosition[] {
  const pos = positionFromFen(rootFen);
  const seen = new Set<string>();
  const positions: GamePosition[] = [];
  for (let index = 0; index <= moves.length; index += 1) {
    const fen = makeFen(pos.toSetup());
    // A pawn move or capture can't be undone: no earlier position can come back.
    if (pos.halfmoves === 0) seen.clear();
    const key = positionKey(fen);
    const uci = moves.at(index);
    positions.push({
      fen,
      turn: pos.turn,
      played: uci === undefined ? null : standardCastlingUci(fen, uci),
      legal: legalMoveCount(fen),
      end: pos.isEnd(),
      checkmate: pos.isCheckmate(),
      repeated: seen.has(key)
    });
    seen.add(key);
    if (uci !== undefined) playOrThrow(pos, uci, index);
  }
  return positions;
}

function playOrThrow(pos: Chess, uci: string, index: number): void {
  const move = parseUci(uci);
  if (!move || !pos.isLegal(move)) throw new Error(`Illegal move ${uci} (move ${index + 1}).`);
  pos.play(move);
}

/** The search the generator runs: cancellable, after the yield hook, lines best first. */
function engineSearch(input: GeneratePuzzlesInput): PuzzleSearch {
  return async (fen, search) => {
    input.signal?.throwIfAborted();
    await input.beforeSearch?.();
    input.signal?.throwIfAborted();
    const lines = await input.engine.analyse(fen, search);
    input.signal?.throwIfAborted();
    return lines
      .filter((line) => line.pv.length > 0)
      .sort((a, b) => a.multipv - b.multipv)
      .map((line) => {
        const [first = "", ...rest] = line.pv;
        return { ...line, pv: [standardCastlingUci(fen, first), ...rest] };
      });
  };
}

/** Each position's score at the scan depth (MultiPV 1), or its saved one. */
async function quickScan(
  input: GeneratePuzzlesInput,
  positions: readonly GamePosition[],
  search: PuzzleSearch
): Promise<PuzzleScanEntry[]> {
  const saved = input.scan ?? null;
  if (saved && saved.length !== positions.length)
    throw new Error("The saved evaluations don't match the game's moves.");
  const entries: PuzzleScanEntry[] = [];
  for (const [index, position] of positions.entries()) {
    input.onProgress?.({ phase: "scan", done: index, total: positions.length });
    const entry = saved?.[index];
    if (position.end) entries.push(endEntry(position));
    else if (entry)
      entries.push({
        score: entry.score,
        bestMove: entry.bestMove && standardCastlingUci(position.fen, entry.bestMove)
      });
    else entries.push(await scanPosition(search, position.fen, input.depths.scan));
  }
  return entries;
}

/** A finished position's score: mated (mate 0) or a draw. */
function endEntry(position: GamePosition): PuzzleScanEntry {
  return {
    score: position.checkmate ? { type: "mate", value: 0 } : { type: "cp", value: 0 },
    bestMove: null
  };
}

async function scanPosition(
  search: PuzzleSearch,
  fen: string,
  depth: number
): Promise<PuzzleScanEntry> {
  const line = (await search(fen, { depth, multipv: 1 })).at(0);
  if (!line) throw new Error(`The engine found no move in ${fen}.`);
  return { score: line.score, bestMove: line.pv.at(0) ?? null };
}

/** Maia 3 at each of the user's positions that may be a candidate, when a Maia kind runs. */
async function maiaReadings(run: Run): Promise<Map<number, Maia3Output>> {
  const { input, positions } = run;
  const readings = new Map<number, Maia3Output>();
  if (!input.maia || !MAIA_PUZZLE_KINDS.some((kind) => run.kinds.has(kind))) return readings;
  const indexes = positions.flatMap((position, index) =>
    position.turn === input.userSide && !skipped(run, index) ? [index] : []
  );
  if (!indexes.length) return readings;
  const opponent = input.userSide === "white" ? "black" : "white";
  const eloSelf = nearestMaia3Rating(input.ratings[input.userSide]);
  const eloOppo = nearestMaia3Rating(input.ratings[opponent]);
  input.signal?.throwIfAborted();
  const outputs = await input.maia.evaluate(
    indexes.map((index) => ({ fen: positions[index].fen, eloSelf, eloOppo })),
    { signal: input.signal }
  );
  if (outputs.length !== indexes.length)
    throw new Error("Maia 3 answered a different number of positions.");
  indexes.forEach((index, at) => readings.set(index, outputs[at]));
  return readings;
}

/**
 * Positions that never make puzzles: the end of the game, fewer than two legal moves, a repeated
 * position, or a book move (the position it reaches is in the opening book).
 */
function skipped(run: Pick<Run, "input" | "positions">, index: number): boolean {
  const position = run.positions[index];
  const next = run.positions.at(index + 1);
  if (!position.played || !next || position.legal < 2 || position.repeated) return true;
  const book = run.input.openingBook;
  return Boolean(book && inBook(book, next.fen));
}

/** The mover's loss of win-% with the played move against the best (never negative). */
function lossAt(run: Run, index: number): number {
  return Math.max(0, run.wins[index] - (100 - run.wins[index + 1]));
}

/**
 * The opponent's move into this position handed the mover a chance it let go: it raised the
 * mover's win-% by {@link CHANCE_JUMP} to at least +2 pawns (or a mate), from a position where the
 * mover was not already winning (at most +3 pawns) nor up material; and the played move was not
 * the best.
 */
function isMissedChance(run: Run, index: number): boolean {
  if (index < 1) return false;
  const { positions, scan, wins } = run;
  const position = positions[index];
  const jump = wins[index] - (100 - wins[index - 1]);
  if (jump < CHANCE_JUMP || !standsWinning(scan[index].score)) return false;
  const before = invertScore(scan[index - 1].score);
  if (mates(before) || (before.type === "cp" && before.value > ALREADY_WINNING_CP)) return false;
  if (materialBalance(positionFromFen(positions[index - 1].fen), position.turn) > 0) return false;
  return position.played !== scan[index].bestMove;
}

/** The candidate a position makes, if any kind's rule applies to it. */
async function findCandidate(run: Run, index: number): Promise<Candidate | null> {
  if (skipped(run, index)) return null;
  const candidate =
    run.positions[index].turn === run.input.userSide
      ? await userCandidate(run, index)
      : opponentCandidate(run, index);
  return candidate.attempts.length ? candidate : null;
}

/** Your mistake, Missed chance, Tricky position and Hard find (the user's positions). */
async function userCandidate(run: Run, index: number): Promise<Candidate> {
  const { kinds } = run;
  const candidate: Candidate = { index, applicable: [], attempts: [] };
  const add = (attempt: Attempt) => {
    candidate.applicable.push(attempt.kind);
    candidate.attempts.push(attempt);
  };
  const mistake = lossAt(run, index) >= MISTAKE_LOSS;
  // A missed chance is nearly always a mistake too: the more telling kind goes first.
  if (kinds.has("missed-chance") && isMissedChance(run, index))
    add({ kind: "missed-chance", rules: CHANCE_RULES, played: "not-best" });
  if (kinds.has("mistake") && mistake)
    add({ kind: "mistake", rules: ERROR_RULES, played: "not-best" });
  // A mistake can't be a Tricky position itself (its user lost too much), but is tagged as one.
  if (kinds.has("tricky") && (await isTricky(run, index))) {
    candidate.applicable.push("tricky");
    if (!mistake) candidate.attempts.push({ kind: "tricky", rules: FOUND_RULES, played: "any" });
  }
  if (kinds.has("hard-find") && isHardFind(run, index))
    add({ kind: "hard-find", rules: FOUND_RULES, played: "best" });
  return candidate;
}

/** Opponent's chance: the opponent's mistake, or the chance the user gave them and they missed. */
function opponentCandidate(run: Run, index: number): Candidate {
  const candidate: Candidate = { index, applicable: [], attempts: [] };
  if (!run.kinds.has("opponent-chance")) return candidate;
  if (lossAt(run, index) >= MISTAKE_LOSS)
    candidate.attempts.push({ kind: "opponent-chance", rules: ERROR_RULES, played: "not-best" });
  if (isMissedChance(run, index))
    candidate.attempts.push({ kind: "opponent-chance", rules: CHANCE_RULES, played: "not-best" });
  if (candidate.attempts.length) candidate.applicable.push("opponent-chance");
  return candidate;
}

/** The user played the best move, which Maia gives under {@link HARD_PROBABILITY} at their rating. */
function isHardFind(run: Run, index: number): boolean {
  const position = run.positions[index];
  const output = run.maia.get(index);
  if (!output || !position.played || position.played !== run.scan[index].bestMove) return false;
  return maiaProbability(position.fen, output, position.played) < HARD_PROBABILITY;
}

/**
 * Maia (at the user's rating) puts at least {@link TRICKY_WEIGHT} of its weight on moves that lose
 * a Mistake's worth of win-%, counting its likeliest moves until they cover
 * {@link TRICKY_COVERAGE} of its weight (at most {@link TRICKY_MAX_MOVES}), each scored by the
 * engine at the scan depth.
 */
async function isTricky(run: Run, index: number): Promise<boolean> {
  const output = run.maia.get(index);
  if (!output) return false;
  const fen = run.positions[index].fen;
  let covered = 0;
  let losing = 0;
  let scored = 0;
  for (const { uci, prob } of rankedMoves(output.policy)) {
    if (scored >= TRICKY_MAX_MOVES || covered >= TRICKY_COVERAGE) break;
    covered += prob;
    scored += 1;
    const loss = await moveLoss(run, index, standardCastlingUci(fen, uci));
    if (loss !== null && loss >= MISTAKE_LOSS) losing += prob;
  }
  return losing >= TRICKY_WEIGHT;
}

/** The win-% the mover gives up with `uci` (searched alone at the scan depth); null if illegal. */
async function moveLoss(run: Run, index: number, uci: string): Promise<number | null> {
  const position = run.positions[index];
  if (uci === run.scan[index].bestMove) return 0;
  if (uci === position.played) return lossAt(run, index);
  const move = parseUci(uci);
  if (!move || !positionFromFen(position.fen).isLegal(move)) return null;
  const lines = await run.search(position.fen, {
    depth: run.input.depths.scan,
    multipv: 1,
    searchmoves: [uci]
  });
  const line = lines.at(0);
  return line ? Math.max(0, run.wins[index] - sideToMoveWin(line.score)) : null;
}

/** Whether the played move meets an attempt's demand, given the deep check's best move. */
function playedFits(attempt: Attempt, played: string, best: string): boolean {
  if (attempt.played === "best") return played === best;
  return attempt.played === "any" || played !== best;
}

/**
 * The deep check (MultiPV 2 at the verify depth): the best move must be clear-cut. Then the
 * candidate's attempts in priority order, the first whose played-move demand holds and whose
 * solution builds making the puzzle.
 */
async function checkCandidate(run: Run, candidate: Candidate): Promise<GeneratedPuzzle | null> {
  const position = run.positions[candidate.index];
  const depth = run.input.depths.verify;
  const lines = await run.search(position.fen, { depth, multipv: 2 });
  const best = lines.at(0)?.pv.at(0);
  if (!best || !position.played) return null;
  const at = { fen: position.fen, legal: position.legal, depth, first: true };
  if (!(await isClearCut(run.search, at, lines))) return null;
  const solutions = new Map<SolutionRules, string[] | null>();
  for (const attempt of candidate.attempts) {
    if (!playedFits(attempt, position.played, best)) continue;
    let solution = solutions.get(attempt.rules);
    if (solution === undefined) {
      solution = await buildSolution(
        run.search,
        { fen: position.fen, depth },
        lines,
        attempt.rules
      );
      solutions.set(attempt.rules, solution);
    }
    if (solution && !isRecapture(run, candidate.index, solution))
      return makePuzzle(run, candidate, attempt.kind, solution);
  }
  return null;
}

/**
 * A one-move solution that only takes back what the move before it captured (same square): too
 * plain to be a puzzle.
 */
function isRecapture(run: Run, index: number, solution: readonly string[]): boolean {
  const previous = index > 0 ? run.positions[index - 1] : null;
  const setup = previous?.played;
  if (solution.length !== 1 || !previous || !setup) return false;
  const square = setup.slice(2, 4);
  const target = parseSquare(square);
  const captured = target !== undefined && positionFromFen(previous.fen).board.has(target);
  return captured && solution[0].slice(2, 4) === square;
}

async function makePuzzle(
  run: Run,
  candidate: Candidate,
  kind: GamePuzzleKind,
  solution: string[]
): Promise<GeneratedPuzzle> {
  const { input, positions, wins } = run;
  const index = candidate.index;
  const position = positions[index];
  const previous = index > 0 ? positions[index - 1] : null;
  const difficulty = input.maia
    ? await puzzleDifficulty(
        input.maia,
        { fen: position.fen, solution },
        input.ratings[input.userSide],
        input.signal
      )
    : { difficulty: null, difficultyCapped: false, userChance: null, chanceRating: null };
  return {
    ply: rootPly(input.rootFen) + index + 1,
    kind,
    tags: candidate.applicable.filter((tag) => tag !== kind),
    solverSide: position.turn,
    startFen: previous ? previous.fen : position.fen,
    setupMove: previous ? previous.played : null,
    solution,
    playedMove: position.played ?? "",
    winBefore: round1(wins[index]),
    winAfter: round1(100 - wins[index + 1]),
    ...difficulty,
    themes: solutionThemes(position.fen, solution),
    positionKey: positionKey(position.fen),
    generatorVersion: GAME_PUZZLE_GENERATOR_VERSION,
    depths: { scan: input.depths.scan, verify: input.depths.verify }
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * A saved review's evaluations as the generator's scan (the review hook: only the deep check then
 * runs): one entry per position of `moves`, the end position too, from each move's best line (or
 * stored evaluation). A position the review has no evaluation for is null (it is scanned). Null
 * when the review isn't of these moves.
 */
export function scanFromReview(
  review: Pick<GameReview, "moves">,
  moves: readonly string[]
): (PuzzleScanEntry | null)[] | null {
  const reviewed = [...review.moves].sort((a, b) => a.ply - b.ply);
  if (reviewed.length !== moves.length) return null;
  const same = reviewed.every(
    (move, index) =>
      standardCastlingUci(move.fenBefore, move.playedMove) ===
      standardCastlingUci(move.fenBefore, moves[index] ?? "")
  );
  if (!same) return null;
  const last = reviewed.at(-1);
  return [...reviewed.map(entryBefore), last ? entryAfter(last) : null];
}

function bestLine(lines: readonly PuzzleEngineLine[] | undefined): PuzzleEngineLine | undefined {
  return [...(lines ?? [])]
    .filter((line) => line.pv.length)
    .sort((a, b) => a.multipv - b.multipv)
    .at(0);
}

function turnOf(fen: string): Color {
  return positionFromFen(fen).turn;
}

/** The position before a reviewed move: its best line, else its stored evaluation. */
function entryBefore(move: MoveReview): PuzzleScanEntry | null {
  const line = bestLine(move.topLines);
  if (line) return { score: line.score, bestMove: move.bestMove ?? line.pv.at(0) ?? null };
  if (!move.evalBefore) return null;
  return {
    score: scoreFromWhitePerspective(move.evalBefore, turnOf(move.fenBefore)),
    bestMove: move.bestMove
  };
}

/** The position after the game's last reviewed move: the best reply's line, else its evaluation. */
function entryAfter(move: MoveReview): PuzzleScanEntry | null {
  const line = bestLine(move.replyLines);
  if (line) return { score: line.score, bestMove: line.pv.at(0) ?? null };
  if (!move.evalAfter || move.terminal) return null;
  return {
    score: scoreFromWhitePerspective(move.evalAfter, turnOf(move.fenAfter)),
    bestMove: null
  };
}

/**
 * The user's side in a game: the side whose player name matches one of the connected accounts'
 * usernames (case-insensitive). Null when neither matches, or both do.
 */
export function userSideOfGame(
  players: { white?: string | null; black?: string | null },
  usernames: readonly string[]
): Color | null {
  const names = new Set(usernames.map((name) => name.trim().toLowerCase()).filter(Boolean));
  const matches = (name: string | null | undefined) =>
    Boolean(name?.trim()) && names.has(name?.trim().toLowerCase() ?? "");
  const white = matches(players.white);
  const black = matches(players.black);
  if (white === black) return null;
  return white ? "white" : "black";
}
