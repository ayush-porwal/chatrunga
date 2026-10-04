/**
 * The review summary's figures (the side panel's first screen after a review): each side's
 * accuracy, the marks each side earned, accuracy by phase, the opening, and the puzzle themes
 * behind the reviewed side's errors. Pure; ReviewSummary.tsx draws them.
 */
import type { Color } from "@chaturanga/shared/types/chess";
import type { GameOpening, MoveAnnotation, MoveReview } from "@chaturanga/shared/types/engine";
import { fenAfterUci } from "@chaturanga/shared/chess/position";
import { analyzeTacticsForPosition } from "@chaturanga/shared/chess/tactics";
import { phaseOfPly, type GamePhase, type GamePhases } from "@chaturanga/shared/chess/game-phases";

const GAME_PHASES: readonly GamePhase[] = ["opening", "middlegame", "endgame"];

/** The scoreboard's mark rows, best to worst (Book first). */
export const SCOREBOARD_MARKS: readonly MoveAnnotation[] = [
  "book",
  "brilliant",
  "great",
  "excellent",
  "good",
  "inaccuracy",
  "mistake",
  "blunder",
  "miss"
];

/** The side that played a move (from its position, so a game set up with Black to move counts right). */
export function moverOf(move: Pick<MoveReview, "fenBefore">): Color {
  return move.fenBefore.split(" ")[1] === "b" ? "black" : "white";
}

export type ScoreboardRow = { annotation: MoveAnnotation; white: number; black: number };

/** How many moves each side has of each mark; only the marks the game has, best to worst. */
export function scoreboardRows(moves: readonly MoveReview[]): ScoreboardRow[] {
  const counts = new Map<MoveAnnotation, ScoreboardRow>();
  for (const move of moves) {
    const annotation = move.assessment?.annotation;
    if (!annotation) continue;
    const row = counts.get(annotation) ?? { annotation, white: 0, black: 0 };
    row[moverOf(move)] += 1;
    counts.set(annotation, row);
  }
  return SCOREBOARD_MARKS.flatMap((annotation) => {
    const row = counts.get(annotation);
    return row ? [row] : [];
  });
}

/**
 * A set of moves' accuracy, by the review's formula (100 − average loss in centipawns ÷ 8, held to
 * 0–100), to one decimal; null when none of them has a loss.
 */
export function movesAccuracy(moves: readonly Pick<MoveReview, "evalLoss">[]): number | null {
  const losses = moves
    .map((move) => move.evalLoss)
    .filter((value): value is number => value !== null);
  if (!losses.length) return null;
  const average = losses.reduce((sum, value) => sum + value, 0) / losses.length;
  return Math.round(Math.max(0, Math.min(100, 100 - average / 8)) * 10) / 10;
}

/** One side's accuracy over the game (see {@link movesAccuracy}). */
export function sideAccuracy(moves: readonly MoveReview[], side: Color): number | null {
  return movesAccuracy(moves.filter((move) => moverOf(move) === side));
}

export type PhaseAccuracy = { phase: GamePhase; white: number | null; black: number | null };

/**
 * Each side's accuracy in the opening, middlegame and endgame (the shared split the charts use;
 * the same formula as the game's, whole percents); a phase the game never reached is left out,
 * and the endgame is listed whenever the split has one.
 */
export function phaseAccuracy(moves: readonly MoveReview[], phases: GamePhases): PhaseAccuracy[] {
  return GAME_PHASES.flatMap((phase) => {
    const inPhase = moves.filter((move) => phaseOfPly(move.ply, phases) === phase);
    // The endgame shows whenever the game reached one (as the charts mark it), even unreviewed.
    const reached = phase === "endgame" ? phases.endgameStart !== null : inPhase.length > 0;
    if (!reached) return [];
    const of = (side: Color) => {
      const accuracy = movesAccuracy(inPhase.filter((move) => moverOf(move) === side));
      return accuracy === null ? null : Math.round(accuracy);
    };
    return [{ phase, white: of("white"), black: of("black") }];
  });
}

/** "4. g3" / "4… g3" for a move by its ply. */
export function plyLabel(ply: number, san: string): string {
  const number = Math.ceil(ply / 2);
  return ply % 2 === 1 ? `${number}. ${san}` : `${number}… ${san}`;
}

/** The opening's second line: "Book until move 3 · left theory with 4. g3". */
export function openingBookLine(opening: GameOpening): string {
  const until = `Book until move ${Math.max(1, Math.ceil(opening.bookEndPly / 2))}`;
  const left = opening.firstNonBookMove;
  return left ? `${until} · left theory with ${plyLabel(left.ply, left.san)}` : until;
}

/**
 * An opening name as a Lichess puzzle OpeningTags key: accents dropped, spaces as underscores,
 * anything but letters, digits, `_` and `-` removed ("King's Gambit" → "Kings_Gambit").
 */
export function lichessOpeningKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\w-]/g, "");
}

/**
 * The Lichess puzzle OpeningTags for an opening name: its family ("Sicilian_Defense") and, when the
 * name has one, its variation ("Sicilian_Defense_Najdorf_Variation" for "Sicilian Defense: Najdorf
 * Variation, English Attack"). Lichess tags a puzzle with both.
 */
export function lichessOpeningTags(name: string): { family: string; variation: string | null } {
  const [familyName = "", rest] = name.split(":");
  const family = lichessOpeningKey(familyName);
  const variationName = rest?.split(",")[0]?.trim();
  return {
    family,
    variation: variationName ? lichessOpeningKey(`${familyName} ${variationName}`) : null
  };
}

/** The Lichess puzzle themes the summary can recognise reliably. */
export type PracticeTheme =
  | "hangingPiece"
  | "fork"
  | "pin"
  | "skewer"
  | "mateIn1"
  | "mateIn2"
  | "mateIn3"
  | "mateIn4"
  | "mateIn5"
  | "mate";

const THEME_LABELS: Record<PracticeTheme, string> = {
  hangingPiece: "Hanging piece",
  fork: "Fork",
  pin: "Pin",
  skewer: "Skewer",
  mateIn1: "Mate in 1",
  mateIn2: "Mate in 2",
  mateIn3: "Mate in 3",
  mateIn4: "Mate in 4",
  mateIn5: "Mate in 5",
  mate: "Mate"
};

export function practiceThemeLabel(theme: PracticeTheme): string {
  return THEME_LABELS[theme];
}

/** Lichess's mate-in-N themes (N = index + 1); a longer mate is "mate". */
const MATE_IN: readonly PracticeTheme[] = ["mateIn1", "mateIn2", "mateIn3", "mateIn4", "mateIn5"];

/** The marks that are the mover's errors. */
const ERROR_MARKS: ReadonlySet<MoveAnnotation> = new Set([
  "inaccuracy",
  "mistake",
  "blunder",
  "miss"
]);

/**
 * The puzzle theme an error gave the opponent, read from the position after it and the engine's
 * best reply (a Lichess puzzle starts there): a forced mate; a fork, skewer or pin the reply makes;
 * or a piece the error left hanging that the reply takes. Null when it is none of these (or the
 * review has no reply line for it): only motifs the tactics detector finds for certain count.
 */
export function errorTheme(move: MoveReview): PracticeTheme | null {
  const reply = [...(move.replyLines ?? [])].sort((a, b) => a.multipv - b.multipv)[0];
  const replyUci = reply?.pv[0];
  if (!reply || !replyUci) return null;
  if (reply.score.type === "mate" && reply.score.value > 0)
    return MATE_IN[reply.score.value - 1] ?? "mate";
  const mover = moverOf(move);
  const opponent: Color = mover === "white" ? "black" : "white";
  const target = replyUci.slice(2, 4);
  try {
    const afterReply = fenAfterUci(move.fenAfter, replyUci);
    if (afterReply) {
      const made = analyzeTacticsForPosition(afterReply, opponent, { fenBefore: move.fenAfter });
      if (made.some((fact) => fact.kind === "fork" && fact.attacker.square === target))
        return "fork";
      if (made.some((fact) => fact.kind === "skewer" && fact.attacker.square === target))
        return "skewer";
      if (made.some((fact) => fact.kind === "pin" && fact.pinner.square === target)) return "pin";
    }
    const left = analyzeTacticsForPosition(move.fenAfter, mover, { fenBefore: move.fenBefore });
    if (left.some((fact) => fact.kind === "hanging" && fact.piece.square === target))
      return "hangingPiece";
  } catch {
    // A position the detector can't read (a custom setup) teaches no theme.
  }
  return null;
}

export type PracticeChip = { theme: PracticeTheme; label: string; count: number };

/** The themes behind `side`'s marked errors, most frequent first (then by first appearance). */
export function practiceChips(moves: readonly MoveReview[], side: Color): PracticeChip[] {
  const chips: PracticeChip[] = [];
  for (const move of moves) {
    const annotation = move.assessment?.annotation;
    if (!annotation || !ERROR_MARKS.has(annotation) || moverOf(move) !== side) continue;
    const theme = errorTheme(move);
    if (!theme) continue;
    const chip = chips.find((item) => item.theme === theme);
    if (chip) chip.count += 1;
    else chips.push({ theme, label: practiceThemeLabel(theme), count: 1 });
  }
  return chips
    .map((chip, order) => ({ chip, order }))
    .sort((a, b) => b.chip.count - a.chip.count || a.order - b.order)
    .map(({ chip }) => chip);
}
