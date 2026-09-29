/**
 * Pure parsing of puzzle / training-position CSV rows into `PuzzleSample`s,
 * applying the user's filters. No file system access.
 */
import { fenAfterUci, statusForFen } from "@chaturanga/shared/chess/position";
import type { InstalledDatabase, PuzzleSample, PuzzleSampleInput } from "@chaturanga/shared/types/database";

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

const words = (value: string | undefined) => (value ? value.split(/\s+/).filter(Boolean) : []);
const finiteOrNull = (value: number) => (Number.isFinite(value) ? value : null);

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

/**
 * The filters that need no chess (rating, popularity, themes, openings, length, side, difficulty,
 * tags), checked on the raw row before any position is computed. A row that passes still goes
 * through `sampleFromLichessRow` / `sampleFromPositionRow`, which also validate its moves.
 */
export function matchesCheapFilters(kind: PuzzleRowKind, row: string[], input: PuzzleSampleInput): boolean {
  if (kind === "lichess") {
    const [id, fenBefore, movesRaw, ratingRaw, , popularityRaw, , themesRaw, , openingsRaw] = row;
    if (!id || !fenBefore || !movesRaw) return false;
    const filters = input.lichess;
    if (!filters) return true;
    const rating = Number(ratingRaw);
    if (Number.isFinite(rating) && (rating < filters.ratingMin || rating > filters.ratingMax)) return false;
    const popularity = Number(popularityRaw);
    if (Number.isFinite(popularity) && popularity < filters.popularityMin) return false;
    const themes = words(themesRaw);
    if (filters.themes.length && !filters.themes.every((theme) => themes.includes(theme))) return false;
    if (filters.lengths.length && !filters.lengths.some((length) => themes.includes(length))) return false;
    if (filters.openings.length) {
      const openingTags = words(openingsRaw);
      if (!filters.openings.some((opening) => openingTags.includes(opening))) return false;
    }
    // The FEN is before the opponent's move: the solver is the other side.
    if (filters.side !== "any") {
      const solver = fenBefore.split(" ")[1] === "w" ? "black" : "white";
      if (filters.side !== solver) return false;
    }
    return true;
  }
  const [internalId, , , , fen, bestMove, difficultyRaw, ...tagValues] = row;
  if (!internalId || !fen || !bestMove) return false;
  const filters = input.position;
  if (!filters) return true;
  const difficulty = Number(difficultyRaw);
  if (Number.isFinite(difficulty) && (difficulty < filters.difficultyMin || difficulty > filters.difficultyMax)) return false;
  if (filters.tags.length) {
    const activeTags = POSITION_TAGS.filter((_, index) => tagValues[index] === "1");
    if (!filters.tags.every((tag) => activeTags.includes(tag))) return false;
  }
  return true;
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
  const [id, fenBefore, movesRaw, ratingRaw, , popularityRaw, , themesRaw, gameUrl, openingsRaw] = row;
  if (!id || !fenBefore || !movesRaw) return null;
  const moves = words(movesRaw);
  if (moves.length < 2) return null;
  const rating = Number(ratingRaw);
  const popularity = Number(popularityRaw);
  const themes = words(themesRaw);
  const openingTags = words(openingsRaw);
  const initialFen = fenAfterUci(fenBefore, moves[0]);
  if (!initialFen) return null;
  const sideToMove = statusForFen(initialFen).turn;

  const filters = input.lichess;
  if (filters) {
    if (Number.isFinite(rating) && (rating < filters.ratingMin || rating > filters.ratingMax)) return null;
    if (Number.isFinite(popularity) && popularity < filters.popularityMin) return null;
    if (filters.themes.length && !filters.themes.every((theme) => themes.includes(theme))) return null;
    if (filters.openings.length && !filters.openings.some((opening) => openingTags.includes(opening))) return null;
    if (filters.lengths.length && !filters.lengths.some((length) => themes.includes(length))) return null;
    if (filters.side !== "any" && filters.side !== sideToMove) return null;
  }
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
  const difficulty = Number(difficultyRaw);
  const activeTags = POSITION_TAGS.filter((_, index) => tagValues[index] === "1");

  const filters = input.position;
  if (filters) {
    if (Number.isFinite(difficulty) && (difficulty < filters.difficultyMin || difficulty > filters.difficultyMax)) {
      return null;
    }
    if (filters.tags.length && !filters.tags.every((tag) => activeTags.includes(tag))) return null;
  }
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
