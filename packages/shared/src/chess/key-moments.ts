/**
 * The focused summary of a reviewed game: its few strongest lessons (key moments), chosen from the
 * marked moves. Every move and every error stays in the full review; this only decides what the
 * review leads with.
 */
import type { MoveAnnotation, MoveAssessment, MoveReview } from "../types/engine";
import { SEVERITY_THRESHOLDS } from "./move-assessment";

export type KeyMoment = {
  nodeId: string;
  ply: number;
  annotation: MoveAnnotation;
  /** How much the moment teaches (roughly winning-chance points at stake); higher leads. */
  weight: number;
};

/** The focused summary starts with this many moments (fewer when the game has fewer)… */
export const MIN_KEY_MOMENTS = 3;
/** …and grows to this many when the game has that many strong ones. */
export const MAX_KEY_MOMENTS = 5;
/** Moments at least this heavy (a Mistake's worth) are strong. */
const STRONG_WEIGHT = SEVERITY_THRESHOLDS.mistake;

/** Marks that are a success worth leading with when the game has one. */
const SUCCESSES: ReadonlySet<MoveAnnotation> = new Set(["brilliant", "great", "excellent"]);

/**
 * How much a marked move teaches; null for an unmarked one and for a book move (opening theory is
 * no moment, and isn't listed with the marks).
 */
export function momentWeight(assessment: MoveAssessment | null | undefined): number | null {
  const annotation = assessment?.annotation;
  if (!assessment || !annotation) return null;
  const loss = assessment.winLoss ?? 0;
  const gap = Math.max(0, assessment.alternativeGap ?? 0);
  switch (annotation) {
    case "book":
      return null;
    case "brilliant":
      return 25 + gap;
    case "great":
      return Math.max(SEVERITY_THRESHOLDS.mistake, gap);
    case "excellent":
      return 0.75 * Math.max(SEVERITY_THRESHOLDS.inaccuracy, gap);
    case "good":
      return SEVERITY_THRESHOLDS.inaccuracy;
    case "miss":
      return 5 + Math.max(loss, SEVERITY_THRESHOLDS[assessment.severity ?? "mistake"]);
    case "inaccuracy":
      return 0.5 * Math.max(loss, SEVERITY_THRESHOLDS.inaccuracy);
    case "mistake":
    case "blunder":
      // A mate allowed or let slip can cost few points on the scale; its severity is the floor.
      return Math.max(loss, SEVERITY_THRESHOLDS[annotation]);
  }
}

/** Every marked move, heaviest first (earlier first on ties). */
export function rankedMoments(moves: readonly MoveReview[]): KeyMoment[] {
  const moments: KeyMoment[] = [];
  for (const move of moves) {
    const annotation = move.assessment?.annotation;
    const weight = momentWeight(move.assessment);
    if (annotation && weight !== null)
      moments.push({ nodeId: move.nodeId, ply: move.ply, annotation, weight });
  }
  return moments.sort((a, b) => b.weight - a.weight || a.ply - b.ply);
}

/**
 * The key moments, in game order: the heaviest marked moves, one per tactical sequence (a move and
 * the reply to it are one lesson; the heavier one stands for both), 3 to 5 of them (5 only when
 * the game has that many strong ones), and the game's best success when it has one, even if it
 * answered a moment already chosen.
 */
export function keyMoments(
  moves: readonly MoveReview[],
  limits: { min?: number; max?: number } = {}
): KeyMoment[] {
  const min = limits.min ?? MIN_KEY_MOMENTS;
  const max = Math.max(min, limits.max ?? MAX_KEY_MOMENTS);
  const ranked = rankedMoments(moves);
  const distinct: KeyMoment[] = [];
  for (const moment of ranked) {
    if (!distinct.some((picked) => Math.abs(picked.ply - moment.ply) <= 1)) distinct.push(moment);
  }
  const strong = distinct.filter((moment) => moment.weight >= STRONG_WEIGHT).length;
  const chosen = distinct.slice(0, Math.min(max, Math.max(min, strong)));
  const success = ranked.find((moment) => SUCCESSES.has(moment.annotation));
  if (success && !chosen.some((moment) => SUCCESSES.has(moment.annotation))) {
    if (chosen.length >= max) chosen.pop();
    chosen.push(success);
  }
  return chosen.sort((a, b) => a.ply - b.ply);
}

/**
 * The moment to go to from `ply` (0 = the start), forwards or backwards; null when there is none
 * that way.
 */
export function adjacentMoment(
  moments: readonly KeyMoment[],
  ply: number,
  direction: "next" | "previous"
): KeyMoment | null {
  if (direction === "next") return moments.find((moment) => moment.ply > ply) ?? null;
  return [...moments].reverse().find((moment) => moment.ply < ply) ?? null;
}
