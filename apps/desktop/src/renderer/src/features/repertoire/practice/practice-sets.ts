import type { RepertoireColor } from "@chaturanga/shared/types/repertoire";
import type {
  MasteryCounts,
  PracticeOverview,
  RepertoirePracticeStats
} from "@chaturanga/shared/types/repertoire-practice";
import type { PracticePreset } from "../practice-setup";
import { COLOR_LABELS, plural } from "../repertoire-chapters";

/**
 * The Practice tab's sets and their actions (docs/repertoire-games-and-practice.md §4): Everything,
 * each colour, and each repertoire, with what is due, new and learning; Review when anything is
 * due, else Practice early while some are learning; Learn new while new positions remain and
 * today's limit isn't reached. Pure.
 */

export type PracticeSetCard = MasteryCounts & {
  key: string;
  title: string;
  /** "3 repertoires · 446 moves" or "7 chapters · 118 moves". */
  subtitle: string;
  repertoireIds: string[];
  due: number;
  learningNotDue: number;
  nextDueAt: number | null;
  /** The first repertoire's first chapter position (the card's thumbnail). */
  thumbnail: { fen: string | null; color: RepertoireColor };
};

function setOf(
  key: string,
  title: string,
  subtitle: string,
  items: readonly RepertoirePracticeStats[]
): PracticeSetCard {
  const sum = (pick: (item: RepertoirePracticeStats) => number) =>
    items.reduce((total, item) => total + pick(item), 0);
  const next = items
    .map((item) => item.nextDueAt)
    .filter((at): at is number => at !== null)
    .sort((a, b) => a - b)
    .at(0);
  return {
    key,
    title,
    subtitle,
    repertoireIds: items.map((item) => item.repertoireId),
    due: sum((item) => item.due),
    new: sum((item) => item.new),
    learning: sum((item) => item.learning),
    mastered: sum((item) => item.mastered),
    learningNotDue: sum((item) => item.learningNotDue),
    nextDueAt: next ?? null,
    thumbnail: { fen: items[0]?.firstChapterFen ?? null, color: items[0]?.color ?? "white" }
  };
}

const movesText = (items: readonly RepertoirePracticeStats[]) =>
  plural(
    items.reduce((total, item) => total + item.decisions, 0),
    "move"
  );

/** Everything, then each colour with repertoires, then each repertoire. */
export function practiceSets(overview: PracticeOverview): PracticeSetCard[] {
  const all = overview.repertoires;
  if (!all.length) return [];
  const sets = [
    setOf("all", "Everything", `${plural(all.length, "repertoire")} · ${movesText(all)}`, all)
  ];
  for (const color of ["white", "black"] as const) {
    const items = all.filter((item) => item.color === color);
    if (!items.length) continue;
    sets.push(
      setOf(
        color,
        `All ${COLOR_LABELS[color]}`,
        `${plural(items.length, "repertoire")} · ${movesText(items)}`,
        items
      )
    );
  }
  for (const item of all) {
    sets.push(
      setOf(
        item.repertoireId,
        `${item.name} (${COLOR_LABELS[item.color]})`,
        `${plural(item.chapterCount, "chapter")} · ${movesText([item])}`,
        [item]
      )
    );
  }
  return sets;
}

/** What a set card offers. */
export type SetActions = {
  /** Review (due count), else Practice early (learning count), else neither. */
  main: { kind: "review"; count: number } | { kind: "early"; count: number } | null;
  /** "Nothing due. Next review in 3 days" when there is no main action. */
  nothingDue: string | null;
  /** Learn new: absent when nothing is new; disabled (with why) once today's limit is reached. */
  learnNew: { count: number; disabledReason: string | null } | null;
};

export function setActions(
  set: PracticeSetCard,
  overview: Pick<PracticeOverview, "newToday" | "newPerDay">,
  now: number
): SetActions {
  const main =
    set.due > 0
      ? ({ kind: "review", count: set.due } as const)
      : set.learningNotDue > 0
        ? ({ kind: "early", count: set.learningNotDue } as const)
        : null;
  const left =
    overview.newPerDay === null ? Infinity : Math.max(0, overview.newPerDay - overview.newToday);
  return {
    main,
    nothingDue: main
      ? null
      : set.nextDueAt === null
        ? "Nothing due."
        : `Nothing due. Next review ${whenText(set.nextDueAt, now)}`,
    learnNew: set.new
      ? {
          count: Math.min(set.new, left),
          disabledReason:
            left === 0 ? `Daily limit reached, ${overview.newToday} of ${overview.newPerDay}` : null
        }
      : null
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "in 10 minutes", "in 3 hours", "tomorrow", "in 5 days". */
export function whenText(at: number, now: number): string {
  const wait = at - now;
  if (wait <= MINUTE) return "now";
  if (wait < HOUR) return `in ${plural(Math.round(wait / MINUTE), "minute")}`;
  if (wait < DAY) return `in ${plural(Math.round(wait / HOUR), "hour")}`;
  const days = Math.round(wait / DAY);
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

/** The session a set's action starts: its repertoires (a set of several), Back to Practice. */
export function setPreset(
  set: Pick<PracticeSetCard, "repertoireIds">,
  action: "review" | "early" | "learn"
): PracticePreset {
  const several = set.repertoireIds.length > 1 ? { repertoireIds: [...set.repertoireIds] } : {};
  const base = { ...several, returnTab: "practice" as const };
  if (action === "review") return { ...base, dueOnly: true };
  return { ...base, mode: action === "early" ? "practice-early" : "learn-new" };
}

/** A colour's mastery bar: its repertoires' counts, and how many are learned. */
export function colorMastery(
  overview: PracticeOverview,
  color: RepertoireColor
): (MasteryCounts & { learned: number; total: number }) | null {
  const items = overview.repertoires.filter((item) => item.color === color);
  if (!items.length) return null;
  const sum = (pick: (item: RepertoirePracticeStats) => number) =>
    items.reduce((total, item) => total + pick(item), 0);
  return {
    mastered: sum((item) => item.mastered),
    learning: sum((item) => item.learning),
    new: sum((item) => item.new),
    learned: sum((item) => item.learned),
    total: sum((item) => item.decisions)
  };
}
