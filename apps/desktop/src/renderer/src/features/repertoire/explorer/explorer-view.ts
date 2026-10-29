/**
 * What Study's Explorer and Insights' Repertoire health card say (docs/repertoire-games-and-
 * practice.md §6, UI §2c and §2f): the filters line, Maia's heading and Prepare marks, the fix a
 * health flag stages, and the health queue's state.
 */
import type { ExplorerMaiaMove } from "@chaturanga/shared/types/repertoire-explorer";
import type {
  RepertoireHealthFlag,
  RepertoireHealthQueueStatus,
  RepertoireHealthSummary
} from "@chaturanga/shared/types/repertoire-health";
import {
  INSIGHTS_ACCOUNTS,
  type InsightsFilters
} from "@chaturanga/shared/types/repertoire-insights";
import { RATING_MODES, RATING_MODE_LABELS } from "@chaturanga/shared/types/ratings";
import { ACCOUNT_LABELS } from "../insights/insights-format";

const PERIODS: Record<Exclude<InsightsFilters["period"], "since">, string> = {
  all: "all time",
  "3m": "last 3 months",
  "6m": "last 6 months",
  "1y": "last 12 months",
  "2y": "last 2 years"
};

/** "Filters: last 12 months · all time controls (set in Insights)". */
export function filtersLine(filters: InsightsFilters): string {
  const parts = [
    filters.period === "since" ? `since ${filters.since ?? "a date"}` : PERIODS[filters.period],
    filters.timeControls.length === RATING_MODES.length
      ? "all time controls"
      : filters.timeControls.map((mode) => RATING_MODE_LABELS[mode].toLowerCase()).join(", ") ||
        "no time controls"
  ];
  if (filters.ratedOnly) parts.push("rated only");
  if (filters.accounts.length !== INSIGHTS_ACCOUNTS.length)
    parts.push(
      filters.accounts.map((account) => ACCOUNT_LABELS[account]).join(", ") || "no accounts"
    );
  return `Filters: ${parts.join(" · ")} (set in Insights)`;
}

/** Maia's heading: what the opponent may play here, or what players around the rating play. */
export function maiaHeading(rating: number, opponentToMove: boolean): string {
  return opponentToMove
    ? `What players at ${rating} play here`
    : `Players rated ${rating - 100}–${rating + 100} play:`;
}

/** Maia marks an opponent's likely move the repertoire doesn't cover (10% or more) to prepare. */
const PREPARE_SHARE = 0.1;

export function shouldPrepare(move: ExplorerMaiaMove, opponentToMove: boolean): boolean {
  return opponentToMove && !move.inRepertoire && move.probability >= PREPARE_SHARE;
}

/**
 * The line Add stages for a flag, from its own position (only there): the engine's move instead
 * of the weak one, the uncovered reply (the user then plays their answer), or the common mistake
 * and its punishment. Null where it has nothing to stage.
 */
export function flagFix(flag: RepertoireHealthFlag): string[] | null {
  switch (flag.kind) {
    case "engine-disagrees":
      return flag.bestUci ? [flag.bestUci] : null;
    case "no-answer":
      return [flag.uci];
    case "common-mistake":
      return flag.bestUci ? [flag.uci, flag.bestUci] : [flag.uci];
  }
}

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** The card's badges: "3 weak moves", "5 no answer", "2 traps" (kinds with flags only). */
export function healthCountBadges(summary: RepertoireHealthSummary): string[] {
  const { counts } = summary;
  return [
    counts["engine-disagrees"]
      ? plural(counts["engine-disagrees"], "weak move", "weak moves")
      : null,
    counts["no-answer"] ? `${counts["no-answer"].toLocaleString()} no answer` : null,
    counts["common-mistake"] ? plural(counts["common-mistake"], "trap", "traps") : null
  ].filter((badge) => badge !== null);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function since(at: number, now: number): string {
  const days = Math.floor((now - at) / DAY_MS);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** A repertoire's queue state on the card: being checked, waiting, failed, checked, or never. */
export function healthStateText(
  summary: RepertoireHealthSummary,
  status: RepertoireHealthQueueStatus | undefined,
  now: number
): string {
  if (status?.current?.repertoireId === summary.repertoireId) return "Checking…";
  if (summary.state === "queued" || status?.queued.includes(summary.repertoireId))
    return status?.paused ? "Paused" : "Waiting";
  if (summary.state === "failed") return `Check failed: ${summary.error ?? "unknown error"}`;
  if (summary.checkedAt !== null) return `Checked ${since(summary.checkedAt, now)}`;
  return "Not checked";
}

/** The queue's one line: what it is doing, or why it waits. Null when it is idle. */
export function queueHeadline(status: RepertoireHealthQueueStatus): string | null {
  const waiting = status.queued.length;
  if (status.paused && (waiting || status.current))
    return `Paused · ${plural(waiting, "repertoire", "repertoires")} waiting`;
  if (status.current) {
    const { name, done, total } = status.current;
    if (status.waitingForEngine) return `Waiting while your engine is in use (${name})`;
    if (status.waitingForPuzzles) return `Waiting for puzzle generation to finish (${name})`;
    return total ? `Checking ${name}… ${done} of ${total}` : `Checking ${name}…`;
  }
  if (waiting && !status.problem) return `${plural(waiting, "repertoire", "repertoires")} waiting`;
  return null;
}
