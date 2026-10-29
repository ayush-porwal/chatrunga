import { useId, useState, type ReactNode } from "react";
import { BookOpen, GraduationCap, Plus } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { SectionHeader } from "@/components/ui/page";
import { Progress } from "@/components/ui/progress";
import { settingsRowSelect } from "@/components/ui/settings-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { fieldHint, fieldLabel } from "@/lib/ui";
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
import { ChessboardIcon } from "../../play/recent-games-controls";
import { plural, relativeDay } from "../repertoire-chapters";
import { ScoreBar } from "../ScoreBar";
import {
  afterBookText,
  comparingText,
  gamesCount,
  lineLabels,
  plyAfter,
  plyMoveLabel
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
    className: "bg-fg-subtle",
    outcomes: ["not-covered", "no-repertoire"]
  }
];

/**
 * Insights' Report section (§5.2): the games by what happened, the moves forgotten, the replies not
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
        title="Couldn't load the report"
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
    <section aria-labelledby={TITLE_ID}>
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
            <GraduationCap />
            Practice weak spots
          </Button>
        }
      />
      {status?.running ? (
        <div className="grid animate-fade-in gap-1.5 px-4 pb-3" role="status">
          <span className="truncate text-xs tabular-nums text-fg-muted">
            {comparingText(status.done, status.total)}
          </span>
          <Progress
            value={status.total ? (status.done / status.total) * 100 : null}
            aria-label={comparingText(status.done, status.total)}
          />
        </div>
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

/** The 4-part meter and its legend; a legend entry lists those games. */
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
      <div aria-hidden="true" className="flex h-1.5 w-full overflow-hidden rounded-full bg-control">
        {BAR_SEGMENTS.map((segment) =>
          report.bar[segment.key] ? (
            <span
              key={segment.key}
              title={`${segment.label}: ${gamesCount(report.bar[segment.key])}`}
              className={cn("h-full", segment.className)}
              style={{ width: `${(report.bar[segment.key] / total) * 100}%` }}
            />
          ) : null
        )}
      </div>
      <div className="-mx-2 flex flex-wrap items-center gap-x-1 text-xs">
        {BAR_SEGMENTS.map((segment) => (
          <button
            key={segment.key}
            type="button"
            className="flex h-7 items-center gap-1.5 rounded-md px-2 text-fg-secondary outline-none transition-colors duration-micro hover:bg-control hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/70"
            onClick={() => onShowGames({ outcomes: segment.outcomes })}
          >
            <span aria-hidden="true" className={cn("size-2 rounded-full", segment.className)} />
            {segment.label}
            <span className="tabular-nums text-fg-muted">
              {report.bar[segment.key].toLocaleString()}
            </span>
          </button>
        ))}
        {report.noUserSide ? (
          <span
            className="px-2 text-fg-muted"
            title="Neither player is one of your connected accounts."
          >
            {gamesCount(report.noUserSide)} without your account aren't counted
          </span>
        ) : null}
      </div>
    </div>
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
  return (
    <span className="text-fg-secondary">
      <ScoreBar
        wins={score.wins}
        draws={score.draws}
        losses={score.losses}
        score={`${score.percent}%`}
      />
    </span>
  );
}

/** Why a row's Study action can't run. */
const NO_CHAPTER = "No chapter has this position now";

/**
 * A row action that can't run now stays hoverable (`aria-disabled`, not `disabled`) so its tooltip
 * says why, as IconButton's `disabledReason` does; a click then does nothing.
 */
function RowAction({
  unavailable,
  onClick,
  className,
  ...props
}: Omit<ButtonProps, "disabled" | "title" | "size"> & {
  /** Why it can't run now (null: it can). */
  unavailable: string | null;
}) {
  const button = (
    <Button
      type="button"
      size="xs"
      aria-disabled={unavailable ? true : undefined}
      className={cn(
        unavailable && "cursor-not-allowed opacity-50 hover:bg-transparent active:scale-100",
        className
      )}
      onClick={unavailable ? undefined : onClick}
      {...props}
    />
  );
  if (!unavailable) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="bottom">{unavailable}</TooltipContent>
    </Tooltip>
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
      <SectionHeader id={id} as="h3" title="Moves you forgot" />
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
                <GraduationCap />
                Practice
              </Button>
              <RowAction
                variant="ghost"
                unavailable={spot.study ? null : NO_CHAPTER}
                onClick={() => actions.studyForgot(spot)}
              >
                <BookOpen />
                Open in Study
              </RowAction>
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
      <SectionHeader id={id} as="h3" title="Replies you haven't prepared" />
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
              <RowAction
                variant="outline"
                unavailable={reply.study ? null : NO_CHAPTER}
                onClick={() => actions.prepare(reply)}
              >
                <Plus />
                Prepare
              </RowAction>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() =>
                  actions.reviewGame({
                    gameId: reply.latestGameId,
                    ply: reply.ply,
                    repertoireId: reply.repertoireId,
                    color: reply.color,
                    focus: {
                      outcome: "new-reply",
                      repertoireId: reply.repertoireId,
                      repertoireName: reply.repertoireName,
                      color: reply.color,
                      issue: {
                        ply: reply.ply,
                        played: reply.reply.san,
                        playedUci: reply.reply.uci,
                        expected: [],
                        expectedUcis: [],
                        positionKey: reply.positionKey,
                        study: reply.study
                      }
                    }
                  })
                }
              >
                <ChessboardIcon />
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
  const counts = OPENING_COLUMNS.map((column) =>
    openings[column.key].reduce((sum, row) => sum + row.games, 0)
  );
  const total = counts.reduce((sum, count) => sum + count, 0);
  const rowCount = OPENING_COLUMNS.reduce((sum, column) => sum + openings[column.key].length, 0);
  if (!total) return null;
  return (
    <section aria-labelledby={id} className="grid gap-2">
      <SectionHeader id={id} as="h3" title="Openings not in your repertoire" />
      <p className="text-xs text-fg-muted">
        {gamesCount(total)}: opponents chose another opening in {counts[0].toLocaleString()}, you
        did in {counts[1].toLocaleString()}, and {counts[2].toLocaleString()} had no repertoire for
        your colour.
      </p>
      <Disclosure title="See all" summary={plural(rowCount, "opening")}>
        <div className="grid gap-2">
          <div className="grid gap-4 sm:grid-cols-3">
            {OPENING_COLUMNS.map((column) => (
              <OpeningColumn key={column.key} title={column.title} rows={openings[column.key]} />
            ))}
          </div>
          <p className={fieldHint}>
            Games that left at the very first moves. Not mistakes: what to prepare next.
          </p>
        </div>
      </Disclosure>
    </section>
  );
}

function OpeningColumn({ title, rows }: { title: string; rows: InsightsOpeningRow[] }) {
  return (
    <div className="grid content-start gap-1">
      <h4 className={fieldLabel}>{title}</h4>
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
      <SectionHeader
        id={id}
        as="h3"
        title="Score by line"
        actions={
          <>
            <label htmlFor={selectId} className="sr-only">
              Lines at move
            </label>
            <Select
              id={selectId}
              className={settingsRowSelect}
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
          </>
        }
      />
      {lines.length ? (
        <ul>
          {lines.map((line) => (
            <li
              key={`${line.repertoireId}:${line.moves.map((move) => move.uci).join(" ")}`}
              className="grid grid-cols-[minmax(0,1fr)_5rem_6.25rem_8rem_auto] items-center gap-3 border-t border-line-subtle py-1.5 text-xs first:border-t-0"
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
        <EmptyState compact title={`No games were still in your repertoire at move ${lineMove}.`} />
      )}
    </section>
  );
}
