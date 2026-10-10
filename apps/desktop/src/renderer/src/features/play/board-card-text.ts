import type { PuzzleSample } from "@chaturanga/shared/types/database";
import type {
  RepertoireColor,
  RepertoireDueSummary,
  RepertoireNextDue
} from "@chaturanga/shared/types/repertoire";

/** "Italian Game · White". */
export function repertoireTitle(name: string, color: RepertoireColor): string {
  return `${name} · ${color === "white" ? "White" : "Black"}`;
}

/**
 * The opponent's move into the due position as a scoresheet move ("3…Nf6", "4. Bc4"); null at a
 * chapter root, where there is no move before yours.
 */
export function repertoireMoveLabel(lastMove: RepertoireNextDue["lastMove"]): string | null {
  if (!lastMove) return null;
  return lastMove.color === "black"
    ? `${lastMove.moveNumber}…${lastMove.san}`
    : `${lastMove.moveNumber}. ${lastMove.san}`;
}

/**
 * What the Repertoire card offers, first match wins: the next due position (Review now), else an
 * unfinished practice session (Resume practice), else the last study place (Continue study). Null
 * hides the card. A session's board is the study place's position when that is the same repertoire.
 */
export type RepertoireCardContent =
  | {
      kind: "review";
      next: RepertoireNextDue;
      dueCount: number;
      alsoDue: RepertoireDueSummary["alsoDue"];
    }
  | {
      kind: "resume";
      resume: NonNullable<RepertoireDueSummary["resume"]>;
      fen: string | null;
    }
  | { kind: "study"; target: NonNullable<RepertoireDueSummary["continue"]> };

export function repertoireCardContent(
  due:
    | Pick<RepertoireDueSummary, "dueCount" | "next" | "alsoDue" | "resume" | "continue">
    | null
    | undefined
): RepertoireCardContent | null {
  if (!due) return null;
  if (due.next) {
    return {
      kind: "review",
      next: due.next,
      dueCount: Math.max(due.dueCount, due.next.dueCount),
      alsoDue: due.alsoDue
    };
  }
  if (due.resume) {
    const study = due.continue;
    return {
      kind: "resume",
      resume: due.resume,
      fen: study && study.repertoireId === due.resume.repertoireId ? study.fen : null
    };
  }
  if (due.continue) return { kind: "study", target: due.continue };
  return null;
}

/** "12 positions due" (singular for one). */
export function positionsDue(count: number): string {
  return `${count} ${count === 1 ? "position" : "positions"} due`;
}

/** "White to move" for the solver's side. */
export function puzzleTitle(sample: Pick<PuzzleSample, "sideToMove">): string {
  return sample.sideToMove === "white" ? "White to move" : "Black to move";
}

/** "Rating 1724"; "Difficulty 3" for a position set without ratings; null when it has neither. */
export function puzzleDetail(sample: Pick<PuzzleSample, "rating" | "difficulty">): string | null {
  if (typeof sample.rating === "number" && Number.isFinite(sample.rating)) {
    return `Rating ${Math.round(sample.rating)}`;
  }
  if (typeof sample.difficulty === "number" && Number.isFinite(sample.difficulty)) {
    return `Difficulty ${sample.difficulty}`;
  }
  return null;
}

/** The local calendar day as "YYYY-MM-DD" (the puzzle of the day changes at local midnight). */
export function localDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Milliseconds from `now` to the next local midnight. */
export function msUntilNextDay(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(1, next.getTime() - now.getTime());
}
