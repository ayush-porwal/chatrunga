import { useId, useState, type ReactNode } from "react";
import { BookOpen, Dumbbell, Play, Plus } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { card } from "@/lib/ui";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useMinuteClock } from "@/lib/use-minute-clock";
import { cn } from "@/lib/utils";
import { isOneOf } from "@chaturanga/shared/types/guards";
import {
  INSIGHTS_LINE_MOVES,
  type InsightsComparerStatus,
  type InsightsForgotSpot,
  type InsightsMove,
  type InsightsOpeningRow,
  type InsightsOutcome,
  type InsightsReport as Report,
  type InsightsScore,
  type InsightsScoreLine,
  type InsightsUnpreparedReply
} from "@chaturanga/shared/types/repertoire-insights";
import { CardTitleBar } from "../../play/card-title";
import { relativeDay } from "../repertoire-chapters";
import {
  afterBookText,
  comparingText,
  gamesCount,
  lineLabels,
  plyAfter,
  plyMoveLabel,
  scoreText
} from "./insights-format";
import type { InsightsActions } from "./insights-actions";

/** "Moves you forgot" shows this many until Show all. */
const TOP_FORGOT = 8;

const TITLE_ID = "insights-report-title";

const BAR_SEGMENTS: readonly {
  key: keyof Report["bar"];
  label: string;
  className: string;
  outcomes: InsightsOutcome[];
}[] = [
  { key: "forgot", label: "Forgot a move", className: "bg-danger", outcomes: ["forgot"] },
  { key: "newReply", label: "Unprepared reply", className: "bg-warn", outcomes: ["new-reply"] },
  {
    key: "stayedInBook",
    label: "Stayed in book",
    className: "bg-accent",
    outcomes: ["in-book", "ended-in-book"]
  },
  {
    key: "otherOpenings",
    label: "Other openings",
    className: "bg-fg-subtle/50",
    outcomes: ["not-covered", "no-repertoire"]
  }
];

/**
 * Insights' Report card (§5.2): the games by what happened, the moves forgotten, the replies not
 * prepared, the openings outside the repertoire, and the score by line.
 */
export function InsightsReportCard({
  report,
  status,
  lineMove,
  onLineMoveChange,
  practiseAllReady,
  actions
}: {
  report: UseQueryResult<Report>;
  status: InsightsComparerStatus | undefined;
  lineMove: number;
  onLineMoveChange: (lineMove: number) => void;
  /** Practice weak spots (every repertoire's) can start: the repertoires are read. */
  practiseAllReady: boolean;
  actions: InsightsActions;
}) {
  const data = report.data;
  let body: ReactNode;
  if (report.isPending) {
    body = <ReportSkeleton />;
  } else if (report.isError) {
    body = (
      <Notice
        tone="danger"
        className="m-4 w-auto"
        action={
          <Button type="button" size="xs" variant="outline" onClick={() => void report.refetch()}>
            Try again
          </Button>
        }
      >
        {ipcErrorMessage(report.error) || "The report couldn't be read."}
      </Notice>
    );
  } else if (!data?.games) {
    body = status?.running ? null : (
      <EmptyState
        title="No games to compare yet"
        description="Connect Lichess or Chess.com, or import your games, and they're compared with your repertoires here."
        action={
          <Button type="button" variant="primary" size="sm" onClick={actions.openSettings}>
            Open Settings
          </Button>
        }
      />
    );
  } else {
    body = (
      <div className="grid gap-6 px-4 pb-4">
        <OutcomeBar report={data} onShowGames={actions.showGames} />
        <ForgotSection spots={data.forgot} actions={actions} />
        <UnpreparedSection replies={data.unprepared} actions={actions} />
        <OpeningsSection openings={data.openings} />
        <ScoreByLineSection
          lines={data.scoreByLine}
          lineMove={lineMove}
          onLineMoveChange={onLineMoveChange}
          actions={actions}
        />
      </div>
    );
  }
  return (
    <section aria-labelledby={TITLE_ID} className={card}>
      <CardTitleBar
        id={TITLE_ID}
        title="Report"
        count={data?.games ?? null}
        actions={
          <Button
            type="button"
            variant="primary"
            size="xs"
            disabled={!data?.forgot.length || !practiseAllReady}
            onClick={() => actions.practise(null)}
          >
            <Dumbbell />
            Practice weak spots
          </Button>
        }
      />
      {status?.running ? (
        <p className="px-4 pb-3 text-xs text-fg-muted" role="status">
          {comparingText(status.done, status.total)}
        </p>
      ) : null}
      {body}
    </section>
  );
}

function ReportSkeleton() {
  return (
    <div className="grid gap-3 px-4 pb-4" aria-busy="true" aria-label="Loading the report">
      <Skeleton className="h-3 w-full rounded-full" />
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}

/** The 4-segment bar and its legend; a segment or legend entry lists those games. */
function OutcomeBar({
  report,
  onShowGames
}: {
  report: Report;
  onShowGames: InsightsActions["showGames"];
}) {
  const total = report.games || 1;
  return (
    <div className="grid gap-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-control">
        {BAR_SEGMENTS.map((segment) =>
          report.bar[segment.key] ? (
            <button
              key={segment.key}
              type="button"
              aria-label={`${segment.label}: ${gamesCount(report.bar[segment.key])}`}
              className={cn(
                "h-full outline-none hover:opacity-80 focus-visible:opacity-80",
                segment.className
              )}
              style={{ width: `${(report.bar[segment.key] / total) * 100}%` }}
              onClick={() => onShowGames({ outcomes: segment.outcomes })}
            />
          ) : null
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
        {BAR_SEGMENTS.map((segment) => (
          <button
            key={segment.key}
            type="button"
            className="inline-flex items-center gap-1.5 rounded outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/70"
            onClick={() => onShowGames({ outcomes: segment.outcomes })}
          >
            <span aria-hidden="true" className={cn("size-2 rounded-full", segment.className)} />
            {segment.label}
            <span className="tabular-nums text-fg-secondary">
              {report.bar[segment.key].toLocaleString()}
            </span>
          </button>
        ))}
        {report.noUserSide ? (
          <span title="Neither player is one of your connected accounts.">
            {gamesCount(report.noUserSide)} without your account aren't counted
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SectionTitle({ children, id }: { children: ReactNode; id: string }) {
  return (
    <h3 id={id} className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
      {children}
    </h3>
  );
}

/** A line's moves, with the move the row is about (`highlight`) after them in the accent colour. */
function LineText({
  rootFen,
  line,
  highlight
}: {
  rootFen: string;
  line: readonly InsightsMove[];
  highlight: string | null;
}) {
  const labels = lineLabels(rootFen, line);
  return (
    <span className="min-w-0 truncate font-mono text-xs text-fg-secondary">
      {labels.join(" ")}
      {highlight ? (
        <>
          {labels.length ? " " : null}
          <span className="font-semibold text-accent-fg">
            {plyMoveLabel(plyAfter(rootFen, line), highlight)}
          </span>
        </>
      ) : null}
    </span>
  );
}

function ScoreCell({ score }: { score: InsightsScore }) {
  const text = scoreText(score);
  return (
    <span className="tabular-nums text-xs text-fg-secondary" title={text.detail}>
      {text.percent}
    </span>
  );
}

function AfterBookCell({ afterBook }: { afterBook: InsightsForgotSpot["afterBook"] }) {
  const text = afterBookText(afterBook);
  return text ? (
    <span className="tabular-nums text-xs text-fg-muted" title={text.title}>
      {text.text}
    </span>
  ) : null;
}

function GamesLink({ games, onClick }: { games: number; onClick: () => void }) {
  return (
    <Button type="button" variant="link" size="xs" className="tabular-nums" onClick={onClick}>
      {gamesCount(games)}
    </Button>
  );
}

const rowClass =
  "grid grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-line-subtle py-2 first:border-t-0";

function ForgotSection({
  spots,
  actions
}: {
  spots: InsightsForgotSpot[];
  actions: InsightsActions;
}) {
  const id = useId();
  const [showAll, setShowAll] = useState(false);
  const now = useMinuteClock();
  if (!spots.length) return null;
  const shown = showAll ? spots : spots.slice(0, TOP_FORGOT);
  return (
    <section aria-labelledby={id} className="grid gap-1">
      <SectionTitle id={id}>Moves you forgot</SectionTitle>
      <ul>
        {shown.map((spot) => (
          <li key={`${spot.repertoireId}:${spot.positionKey}`} className={rowClass}>
            <GamesLink
              games={spot.games}
              onClick={() =>
                actions.showGames({
                  repertoireId: spot.repertoireId,
                  positionKey: spot.positionKey,
                  outcomes: ["forgot"]
                })
              }
            />
            <div className="grid min-w-0 gap-0.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-xs font-medium text-fg">{spot.repertoireName}</span>
                <LineText
                  rootFen={spot.rootFen}
                  line={spot.line}
                  highlight={spot.expected[0]?.san ?? null}
                />
              </div>
              <p className="flex flex-wrap gap-x-3 text-xs text-fg-muted">
                <span>
                  You played{" "}
                  {spot.played
                    .map(
                      (move) =>
                        `${plyMoveLabel(plyAfter(spot.rootFen, spot.line), move.san)} (${move.games})`
                    )
                    .join(", ")}
                </span>
                <ScoreCell score={spot.score} />
                <span>Last seen {relativeDay(spot.lastSeenAt, now).toLowerCase()}</span>
                <AfterBookCell afterBook={spot.afterBook} />
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => actions.practise(spot)}
              >
                <Dumbbell />
                Practise
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={!spot.study}
                title={spot.study ? undefined : "No chapter has this position now"}
                onClick={() => actions.studyForgot(spot)}
              >
                <BookOpen />
                Open in Study
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {spots.length > TOP_FORGOT ? (
        <Button
          type="button"
          variant="link"
          size="xs"
          className="justify-self-start"
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? "Show fewer" : `Show all ${spots.length}`}
        </Button>
      ) : null}
    </section>
  );
}

function UnpreparedSection({
  replies,
  actions
}: {
  replies: InsightsUnpreparedReply[];
  actions: InsightsActions;
}) {
  const id = useId();
  const now = useMinuteClock();
  if (!replies.length) return null;
  return (
    <section aria-labelledby={id} className="grid gap-1">
      <SectionTitle id={id}>Replies you haven't prepared</SectionTitle>
      <ul>
        {replies.map((reply) => (
          <li
            key={`${reply.repertoireId}:${reply.positionKey}:${reply.reply.uci}`}
            className={rowClass}
          >
            <GamesLink
              games={reply.games}
              onClick={() =>
                actions.showGames({
                  repertoireId: reply.repertoireId,
                  positionKey: reply.positionKey,
                  uci: reply.reply.uci,
                  outcomes: ["new-reply"]
                })
              }
            />
            <div className="grid min-w-0 gap-0.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-xs font-medium text-fg">{reply.repertoireName}</span>
                <LineText rootFen={reply.rootFen} line={reply.line} highlight={reply.reply.san} />
              </div>
              <p className="flex flex-wrap gap-x-3 text-xs text-fg-muted">
                <ScoreCell score={reply.score} />
                <span>Last seen {relativeDay(reply.lastSeenAt, now).toLowerCase()}</span>
                <AfterBookCell afterBook={reply.afterBook} />
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={!reply.study}
                title={reply.study ? undefined : "No chapter has this position now"}
                onClick={() => actions.prepare(reply)}
              >
                <Plus />
                Prepare
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() =>
                  actions.reviewGame({
                    gameId: reply.latestGameId,
                    ply: reply.ply,
                    repertoireId: reply.repertoireId,
                    color: reply.color
                  })
                }
              >
                <Play />
                Review game
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const OPENING_COLUMNS: readonly { key: keyof Report["openings"]; title: string }[] = [
  { key: "opponentsChose", title: "Your opponents chose" },
  { key: "youChose", title: "You chose" },
  { key: "noRepertoire", title: "No repertoire for this colour" }
];

function OpeningsSection({ openings }: { openings: Report["openings"] }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const counts = OPENING_COLUMNS.map((column) =>
    openings[column.key].reduce((sum, row) => sum + row.games, 0)
  );
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (!total) return null;
  return (
    <section aria-labelledby={id} className="grid gap-2">
      <SectionTitle id={id}>Openings not in your repertoire</SectionTitle>
      <div className="flex flex-wrap items-center gap-x-3 text-xs text-fg-muted">
        <span>
          {gamesCount(total)}: opponents chose another opening in {counts[0].toLocaleString()}, you
          did in {counts[1].toLocaleString()}, and {counts[2].toLocaleString()} had no repertoire
          for your colour.
        </span>
        <Button type="button" variant="link" size="xs" onClick={() => setOpen((value) => !value)}>
          {open ? "Hide" : "See all"}
        </Button>
      </div>
      {open ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {OPENING_COLUMNS.map((column) => (
              <OpeningColumn key={column.key} title={column.title} rows={openings[column.key]} />
            ))}
          </div>
          <p className="text-2xs text-fg-subtle">
            Games that left at the very first moves. Not mistakes: what to prepare next.
          </p>
        </>
      ) : null}
    </section>
  );
}

function OpeningColumn({ title, rows }: { title: string; rows: InsightsOpeningRow[] }) {
  return (
    <div className="grid content-start gap-1">
      <h4 className="text-xs font-medium text-fg-secondary">{title}</h4>
      {rows.length ? (
        <ul className="grid gap-0.5">
          {rows.map((row) => (
            <li
              key={`${row.color}:${row.uci}`}
              className="flex min-w-0 items-baseline justify-between gap-2 text-xs"
            >
              <span className="min-w-0 truncate">
                <span className="font-mono text-fg">{row.san}</span>{" "}
                <span className="text-fg-muted">{row.opening ?? ""}</span>
              </span>
              <span className="tabular-nums text-fg-secondary">{row.games.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-fg-subtle">None</p>
      )}
    </div>
  );
}

function ScoreByLineSection({
  lines,
  lineMove,
  onLineMoveChange,
  actions
}: {
  lines: InsightsScoreLine[];
  lineMove: number;
  onLineMoveChange: (lineMove: number) => void;
  actions: InsightsActions;
}) {
  const id = useId();
  const selectId = useId();
  return (
    <section aria-labelledby={id} className="grid gap-1">
      <div className="flex items-center justify-between gap-2">
        <SectionTitle id={id}>Score by line</SectionTitle>
        <div>
          <label htmlFor={selectId} className="sr-only">
            Lines at move
          </label>
          <Select
            id={selectId}
            className="h-7 w-auto text-xs"
            value={String(lineMove)}
            onChange={(event) => {
              const move = Number(event.target.value);
              if (isOneOf(INSIGHTS_LINE_MOVES, move)) onLineMoveChange(move);
            }}
          >
            {INSIGHTS_LINE_MOVES.map((move) => (
              <option key={move} value={move}>
                Lines at move {move}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {lines.length ? (
        <ul>
          {lines.map((line) => (
            <li
              key={`${line.repertoireId}:${line.moves.map((move) => move.uci).join(" ")}`}
              className="grid grid-cols-[minmax(0,1fr)_5rem_3.5rem_8rem_auto] items-center gap-3 border-t border-line-subtle py-1.5 first:border-t-0"
            >
              <LineText rootFen={line.rootFen} line={line.moves} highlight={null} />
              <span className="tabular-nums text-xs text-fg-secondary">
                {gamesCount(line.games)}
              </span>
              <ScoreCell score={line.score} />
              <span className="text-xs text-fg-muted">
                {afterBookText(line.afterBook)?.text ?? "—"}
              </span>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={!line.study}
                onClick={() => {
                  if (line.study) actions.study({ repertoireId: line.repertoireId, ...line.study });
                }}
              >
                Open
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-2 text-xs text-fg-muted">
          No games were still in your repertoire at move {lineMove}.
        </p>
      )}
    </section>
  );
}
