/**
 * Pure parsing of puzzle / training-position CSV rows into `PuzzleSample`s,
 * applying the user's filters. No file system access.
 */
import { fenAfterUci, statusForFen } from "@chaturanga/shared/chess/position";
import type {
  InstalledDatabase,
  PuzzleSample,
  PuzzleSampleInput
} from "@chaturanga/shared/types/database";

/** Column order of the 0/1 tag flags in the position-training CSV. */
const POSITION_TAGS = [
  "initiative",
  "development",
  "endgame",
  "space",
  "trading",
  "prophylaxis",
  "coordination",
  "exploitingWeakness",
  "kingSafety",
  "restriction",
  "fixingStructure",
  "centreControl"
];

/** Which CSV layout a row has: the Lichess puzzle database, or the position-training set. */
export type PuzzleRowKind = "lichess" | "position";

/** The row layout of a catalogued source's file. */
export function rowKindForSource(sourceId: string): PuzzleRowKind {
  return sourceId === "lichess-puzzles" ? "lichess" : "position";
}

/**
 * The header each layout starts with: the columns the row parsers below read by position (the
 * position set's tag columns after `difficulty` aren't required, so a new tag doesn't break it).
 */
const HEADER_COLUMNS: Record<PuzzleRowKind, readonly string[]> = {
  lichess: [
    "PuzzleId",
    "FEN",
    "Moves",
    "Rating",
    "RatingDeviation",
    "Popularity",
    "NbPlays",
    "Themes",
    "GameUrl",
    "OpeningTags"
  ],
  position: [
    "internal_id",
    "lichess_game_id",
    "move_number",
    "lichess_url",
    "fen",
    "best_move",
    "difficulty"
  ]
};

/** The header columns a file of this layout must start with, for error messages. */
export function expectedHeader(kind: PuzzleRowKind): string {
  return HEADER_COLUMNS[kind].join(",");
}

/** Whether a file's first line is the header of this layout (case and a leading BOM ignored). */
export function headerMatches(kind: PuzzleRowKind, line: string): boolean {
  const columns = parseCsvLine(line.replace(/^\uFEFF/, "").trim()).map((column) =>
    column.trim().toLowerCase()
  );
  return HEADER_COLUMNS[kind].every((column, index) => columns[index] === column.toLowerCase());
}

const words = (value: string | undefined) => (value ? value.split(/\s+/).filter(Boolean) : []);
const finiteOrNull = (value: number) => (Number.isFinite(value) ? value : null);
/** A numeric CSV field; null when empty or not a number (`Number("")` would be 0). */
const numberOrNull = (value: string | undefined) =>
  value?.trim() ? finiteOrNull(Number(value)) : null;

/** Splits one CSV line, honouring double-quoted fields and `""` escapes. */
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

type LichessFilters = NonNullable<PuzzleSampleInput["lichess"]>;
type PositionFilters = NonNullable<PuzzleSampleInput["position"]>;

/** A rating or popularity that isn't a number passes (the file doesn't say). */
function passesLichessNumbers(
  filters: LichessFilters,
  rating: number,
  popularity: number
): boolean {
  if (Number.isFinite(rating) && (rating < filters.ratingMin || rating > filters.ratingMax))
    return false;
  return !(Number.isFinite(popularity) && popularity < filters.popularityMin);
}

/** Every theme asked for, and one of the lengths asked for (lengths are themes in the file). */
function passesLichessThemes(filters: LichessFilters, themes: readonly string[]): boolean {
  if (filters.themes.length && !filters.themes.every((theme) => themes.includes(theme)))
    return false;
  return !filters.lengths.length || filters.lengths.some((length) => themes.includes(length));
}

/** One of the openings asked for; the row's tags are split only when some are. */
function passesLichessOpenings(filters: LichessFilters, openingsRaw: string | undefined): boolean {
  if (!filters.openings.length) return true;
  const openingTags = words(openingsRaw);
  return filters.openings.some((opening) => openingTags.includes(opening));
}

const activeTagsOf = (tagValues: readonly string[]) =>
  POSITION_TAGS.filter((_, index) => tagValues[index] === "1");

/** The difficulty band (a difficulty that isn't a number passes) and every tag asked for. */
function passesPositionFilters(
  filters: PositionFilters,
  difficulty: number,
  tagValues: readonly string[]
): boolean {
  if (
    Number.isFinite(difficulty) &&
    (difficulty < filters.difficultyMin || difficulty > filters.difficultyMax)
  )
    return false;
  if (!filters.tags.length) return true;
  const activeTags = activeTagsOf(tagValues);
  return filters.tags.every((tag) => activeTags.includes(tag));
}

/**
 * The filters that need no chess (rating, popularity, themes, openings, length, side, difficulty,
 * tags), checked on the raw row before any position is computed. A row that passes still goes
 * through `sampleFromLichessRow` / `sampleFromPositionRow`, which also validate its moves.
 */
export function matchesCheapFilters(
  kind: PuzzleRowKind,
  row: string[],
  input: PuzzleSampleInput
): boolean {
  return kind === "lichess"
    ? lichessRowMatches(row, input.lichess)
    : positionRowMatches(row, input.position);
}

function lichessRowMatches(row: string[], filters: LichessFilters | undefined): boolean {
  const [id, fenBefore, movesRaw, ratingRaw, , popularityRaw, , themesRaw, , openingsRaw] = row;
  // The opponent's move and at least one reply, as `sampleFromLichessRow` needs: a row that can't
  // make a puzzle mustn't take a place in a scan's sample.
  if (!id || !fenBefore || words(movesRaw).length < 2) return false;
  if (!filters) return true;
  if (!passesLichessNumbers(filters, Number(ratingRaw), Number(popularityRaw))) return false;
  if (!passesLichessThemes(filters, words(themesRaw))) return false;
  if (!passesLichessOpenings(filters, openingsRaw)) return false;
  if (filters.side === "any") return true;
  // The FEN is before the opponent's move: the solver is the other side.
  return filters.side === (fenBefore.split(" ")[1] === "w" ? "black" : "white");
}

function positionRowMatches(row: string[], filters: PositionFilters | undefined): boolean {
  const [internalId, , , , fen, bestMove, difficultyRaw, ...tagValues] = row;
  if (!internalId || !fen || !bestMove) return false;
  return !filters || passesPositionFilters(filters, Number(difficultyRaw), tagValues);
}

/**
 * Whether every move of `moves` (UCI) can be played in turn from `fen`. Checked only for the row
 * being served, never during a scan (the scan applies `matchesCheapFilters` alone).
 */
function playsThrough(fen: string, moves: string[]): boolean {
  let position: string | null = fen;
  for (const move of moves) {
    position = position ? fenAfterUci(position, move) : null;
  }
  return position !== null;
}

/**
 * Whether a puzzle read back from storage can still be played, by the rules its scan applied: its
 * position parses, the whole solution plays from it, and the side to move is the position's.
 */
export function isPlayablePuzzle(
  sample: Pick<PuzzleSample, "initialFen" | "solutionMoves" | "sideToMove">
): boolean {
  try {
    return (
      playsThrough(sample.initialFen, sample.solutionMoves) &&
      statusForFen(sample.initialFen).turn === sample.sideToMove
    );
  } catch {
    return false; // An unreadable position.
  }
}

/**
 * Lichess puzzle CSV: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,
 * NbPlays,Themes,GameUrl,OpeningTags. The FEN is before the opponent's move;
 * the puzzle starts after `Moves[0]`.
 */
export function sampleFromLichessRow(
  database: InstalledDatabase,
  row: string[],
  input: PuzzleSampleInput
): PuzzleSample | null {
  const [
    id,
    fenBefore,
    movesRaw,
    ratingRaw,
    deviationRaw,
    popularityRaw,
    playsRaw,
    themesRaw,
    gameUrl,
    openingsRaw
  ] = row;
  if (!id || !fenBefore || !movesRaw) return null;
  const moves = words(movesRaw);
  if (moves.length < 2) return null;
  const rating = Number(ratingRaw);
  const popularity = Number(popularityRaw);
  const themes = words(themesRaw);
  const openingTags = words(openingsRaw);
  const initialFen = fenAfterUci(fenBefore, moves[0]);
  if (!initialFen) return null;
  // The whole line must play: a scripted reply that can't be made would leave the puzzle stuck.
  if (!playsThrough(initialFen, moves.slice(1))) return null;
  const sideToMove = statusForFen(initialFen).turn;

  const filters = input.lichess;
  if (
    filters &&
    !(
      passesLichessNumbers(filters, rating, popularity) &&
      passesLichessThemes(filters, themes) &&
      passesLichessOpenings(filters, openingsRaw) &&
      (filters.side === "any" || filters.side === sideToMove)
    )
  )
    return null;
  return {
    id,
    databaseId: database.id,
    sourceId: database.sourceId,
    sourceName: database.name,
    initialFen,
    fenBefore,
    opponentMove: moves[0],
    solutionMoves: moves.slice(1),
    rating: finiteOrNull(rating),
    ratingDeviation: numberOrNull(deviationRaw),
    plays: numberOrNull(playsRaw),
    popularity: finiteOrNull(popularity),
    themes,
    gameUrl: gameUrl || null,
    openingTags,
    sideToMove,
    difficulty: null
  };
}

/** Position-training CSV: id,,,lichessUrl,fen,bestMove,difficulty,<tag flags...>. */
export function sampleFromPositionRow(
  database: InstalledDatabase,
  row: string[],
  input: PuzzleSampleInput
): PuzzleSample | null {
  const [internalId, , , lichessUrl, fen, bestMove, difficultyRaw, ...tagValues] = row;
  if (!internalId || !fen || !bestMove) return null;
  if (!playsThrough(fen, [bestMove])) return null;
  const difficulty = Number(difficultyRaw);
  if (input.position && !passesPositionFilters(input.position, difficulty, tagValues)) return null;
  const activeTags = activeTagsOf(tagValues);
  return {
    id: internalId,
    databaseId: database.id,
    sourceId: database.sourceId,
    sourceName: database.name,
    initialFen: fen,
    opponentMove: null,
    solutionMoves: [bestMove],
    rating: null,
    popularity: null,
    themes: activeTags,
    gameUrl: lichessUrl || null,
    openingTags: [],
    sideToMove: statusForFen(fen).turn,
    difficulty: finiteOrNull(difficulty)
  };
}
