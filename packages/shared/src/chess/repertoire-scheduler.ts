/**
 * Deterministic repertoire scheduler v1 (design §8.2). Proposed product defaults, versioned by
 * REPERTOIRE_SCHEDULER_VERSION so a later policy can migrate progress explicitly.
 */
import { REPERTOIRE_SCHEDULER_VERSION, type RepertoireProgress } from "../types/repertoire";

/** Review interval of stages 1–6, in days. */
export const STAGE_INTERVALS_DAYS = [1, 3, 7, 14, 30, 60] as const;
export const MAX_STAGE = STAGE_INTERVALS_DAYS.length;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** A lapsed card comes back within the same sitting. */
export const LAPSE_RETRY_MS = 10 * MINUTE_MS;

/**
 * Final first-answer outcome of a card:
 * - `unaided`: the first legal answer was accepted, with no hint before it;
 * - `assisted`: accepted after a hint, with no wrong answer before it;
 * - `wrong`: the first legal answer was outside the repertoire;
 * - `reveal`: the answer was revealed before any accepted legal answer;
 * - `no-change`: nothing gradeable (illegal input, skipped, abandoned).
 */
export type PracticeOutcome = "unaided" | "assisted" | "wrong" | "reveal" | "no-change";

/** The scheduling fields of a progress row (the caller owns ids, fingerprint and suspension). */
export type RepertoireSchedule = Pick<
  RepertoireProgress,
  "stage" | "dueAt" | "lastAttemptAt" | "lapses" | "unaidedSuccesses" | "schedulerVersion"
>;

/**
 * The schedule after a card's final outcome. `progress` null is a card never graded before.
 * `now` is clamped to just after the last stored attempt (`progress.lastAttemptAt`, or the
 * `lastAttemptAt` argument when later), so a clock moved backwards can't schedule into the past and
 * every grade advances `lastAttemptAt` (the main process uses it as the progress version).
 * `no-change` returns the existing schedule unchanged (null for a never-graded card).
 */
export function scheduleAfterOutcome(
  progress: RepertoireSchedule | null,
  outcome: PracticeOutcome,
  now: number,
  lastAttemptAt?: number | null
): RepertoireSchedule | null {
  if (outcome === "no-change") return progress ? { ...progress } : null;

  const floor = Math.max(progress?.lastAttemptAt ?? -Infinity, lastAttemptAt ?? -Infinity);
  const at = Math.max(now, floor + 1);
  const stage = clampStage(progress?.stage ?? 0);
  const base: RepertoireSchedule = {
    stage,
    dueAt: progress?.dueAt ?? null,
    lastAttemptAt: at,
    lapses: progress?.lapses ?? 0,
    unaidedSuccesses: progress?.unaidedSuccesses ?? 0,
    schedulerVersion: REPERTOIRE_SCHEDULER_VERSION
  };

  switch (outcome) {
    case "unaided": {
      const next = Math.min(stage + 1, MAX_STAGE);
      return {
        ...base,
        stage: next,
        dueAt: at + STAGE_INTERVALS_DAYS[next - 1] * DAY_MS,
        unaidedSuccesses: base.unaidedSuccesses + 1
      };
    }
    case "assisted":
      return { ...base, dueAt: at + DAY_MS };
    case "wrong":
    case "reveal":
      return { ...base, stage: 0, dueAt: at + LAPSE_RETRY_MS, lapses: base.lapses + 1 };
  }
}

function clampStage(stage: number): number {
  if (!Number.isFinite(stage)) return 0;
  return Math.min(Math.max(Math.trunc(stage), 0), MAX_STAGE);
}

export type PracticeHistoryAction =
  | { kind: "hint" }
  | { kind: "reveal" }
  | { kind: "skip" }
  | { kind: "attempt"; legal?: boolean; correct?: boolean };

/**
 * Derives a card's final grade from its ordered action history (the main process reconstructs it
 * rather than trusting the client). The first legal attempt decides: accepted → `unaided`, or
 * `assisted` if a hint came before it; outside the repertoire → `wrong`, and later correct retries
 * don't promote it. A reveal before any legal attempt is `reveal`. Illegal attempts are ignored
 * (`legal` defaults to true); a skip, or no decisive action, is `no-change`.
 */
export function firstAnswerOutcome(actions: readonly PracticeHistoryAction[]): PracticeOutcome {
  let hinted = false;
  for (const action of actions) {
    switch (action.kind) {
      case "hint":
        hinted = true;
        break;
      case "reveal":
        return "reveal";
      case "skip":
        return "no-change";
      case "attempt":
        if (action.legal === false) break;
        if (!action.correct) return "wrong";
        return hinted ? "assisted" : "unaided";
    }
  }
  return "no-change";
}

export type QueueCandidate = {
  /** null: never graded (unseen). */
  dueAt: number | null;
  /** Authored ply of the shallowest supporting occurrence. */
  ply: number;
  /** Order of that occurrence's chapter in the repertoire. */
  chapterOrder: number;
};

/**
 * Practice queue order (§8.2): due cards first, most overdue first; then unseen cards by
 * shallowest ply, then chapter order; then (when `now` is given) cards not yet due, soonest
 * first. Ties keep their input order.
 */
export function orderQueue<T extends QueueCandidate>(cards: readonly T[], now?: number): T[] {
  const group = (card: T) => {
    if (card.dueAt === null) return 1;
    return now === undefined || card.dueAt <= now ? 0 : 2;
  };
  return cards
    .map((card, index) => ({ card, index, group: group(card) }))
    .sort((a, b) => {
      if (a.group !== b.group) return a.group - b.group;
      if (a.group === 1) {
        if (a.card.ply !== b.card.ply) return a.card.ply - b.card.ply;
        if (a.card.chapterOrder !== b.card.chapterOrder) {
          return a.card.chapterOrder - b.card.chapterOrder;
        }
      } else if (a.card.dueAt !== b.card.dueAt) {
        return a.card.dueAt! - b.card.dueAt!;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.card);
}
