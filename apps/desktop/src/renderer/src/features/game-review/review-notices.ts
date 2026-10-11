import { fullMoveCount } from "../board/move-counter";

/**
 * The review panel's notices, one band each in their own section between the tab bar and the tab
 * content (the same on every tab):
 * - a run that failed: its error (danger);
 * - a run the user stopped: how far it got, "Analysis stopped at move 9 of 21." (warn);
 * - moves the shown analysis no longer covers (warn);
 * - marks worked out again from an older analysis's saved evaluations (info).
 * Each says what would fix it, Analyze again, offered once: on the first band only, and only when
 * the game can be analysed now.
 */
export type ReviewNotice = {
  key: "error" | "stopped" | "outdated" | "recomputed";
  tone: "danger" | "warn" | "info";
  text: string;
  /** Offers Analyze again (the first notice only). */
  analyze: boolean;
};

export type ReviewNoticeInput = {
  /** The review store's status: a stopped run is `cancelled`, a failed one `error`. */
  status: "idle" | "running" | "ready" | "error" | "cancelled";
  error: string | null;
  /** Plies the stopped run analysed, and the plies of the main line it was analysing. */
  analysedPlies: number;
  totalPlies: number;
  /** The game opens with Black's move (the move numbers count from it). */
  blackFirst: boolean;
  /** Full moves the shown analysis no longer covers. */
  outdatedMoves: number;
  /** The shown analysis's marks were worked out again (it predates the current ones). */
  recomputed: boolean;
  /** Analyze again would start a run now (the game is loaded and has moves). */
  canAnalyze: boolean;
};

export function reviewNotices(input: ReviewNoticeInput): ReviewNotice[] {
  if (input.status === "running") return [];
  const notices: Omit<ReviewNotice, "analyze">[] = [];
  if (input.status === "error" && input.error)
    notices.push({ key: "error", tone: "danger", text: input.error });
  if (input.status === "cancelled") notices.push(stoppedNotice(input));
  if (input.outdatedMoves > 0)
    notices.push({
      key: "outdated",
      tone: "warn",
      text: `The moves changed after this analysis, so it no longer covers ${
        input.outdatedMoves === 1 ? "1 move" : `${input.outdatedMoves} moves`
      }.`
    });
  if (input.recomputed)
    notices.push({
      key: "recomputed",
      tone: "info",
      text: "Marked again with today's rules. Great and Brilliant need a new analysis."
    });
  return notices.map((notice, index) => ({ ...notice, analyze: input.canAnalyze && index === 0 }));
}

/**
 * Where a stopped run got to, in full moves as the progress caption counts them: the move it was
 * analysing when stopped (the one after those it finished), out of the main line's.
 */
function stoppedNotice({
  analysedPlies,
  totalPlies,
  blackFirst
}: ReviewNoticeInput): Omit<ReviewNotice, "analyze"> {
  const at = fullMoveCount(Math.min(analysedPlies + 1, totalPlies), blackFirst);
  const total = fullMoveCount(totalPlies, blackFirst);
  return { key: "stopped", tone: "warn", text: `Analysis stopped at move ${at} of ${total}.` };
}
