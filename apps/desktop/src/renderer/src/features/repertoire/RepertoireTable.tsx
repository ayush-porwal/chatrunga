import { Fragment, memo, useCallback, useId, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, GraduationCap, Play, RotateCcw } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { RepertoireSummary } from "@chaturanga/shared/types/repertoire";
import type { RepertoirePracticeStats } from "@chaturanga/shared/types/repertoire-practice";
import { START_FEN } from "@chaturanga/shared/chess/position";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OverflowMenu, type MenuItem } from "@/components/ui/menu";
import { Notice } from "@/components/ui/notice";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { eyebrow } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { BoardThumbnail } from "../settings/board-thumbnail";
import { colorGroups, learnedText } from "./hub-groups";
import { HubChapterList } from "./HubChapterList";
import { COLOR_LABELS, relativeDay, type ResumePracticeTarget } from "./repertoire-chapters";

/**
 * The one grid of the header, the colour groups and the rows, so every label sits over its values:
 * board · repertoire · chapters · learned · last studied · actions.
 */
const columns =
  "grid grid-cols-[5.5rem_minmax(0,2fr)_minmax(0,0.7fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(10rem,auto)] items-center gap-x-4 pr-3";
/** The board and the name: one Study button over both columns, on the same tracks. */
const studyColumns = "col-span-2 grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-4";
const cell = "min-w-0 text-[0.8125rem] tabular-nums text-fg-muted";

/** A repertoire row's chapters, opened in the hub (Study at a chapter, or practise it). */
export type HubChapterActions = {
  onStudyChapter: (repertoireId: string, chapterId: string) => void;
  onPractiseChapter: (repertoireId: string, chapterId: string) => void;
};

/**
 * The hub's table (laid out as Play's Recent games), in White and Black groups (a colour without
 * repertoires has none). A row: the board (the first chapter's start, facing the repertoire's
 * side) and the name, which open Study; its chapters, which open the list of chapters by opening
 * family under the row; learned (stage 1 or more) of your moves; last studied; Practice (with the
 * due count, or Resume) and the ⋯ menu. Every control is its own button, always visible. Rows are
 * memoised: give them stable `actionsFor`, `onStudy`, `onPractice` and `chapters`.
 */
export function RepertoireTable({
  list,
  now,
  labelledBy,
  resume,
  stats,
  actionsFor,
  onStudy,
  onPractice,
  chapters,
  empty
}: {
  list: UseQueryResult<RepertoireSummary[]>;
  /** When the hub opened: "Last studied" is relative to it. */
  now: number;
  /** The id of what names the list (the Repertoires tab). */
  labelledBy: string;
  /** The unfinished session its row's Practice resumes instead of starting a new one. */
  resume: ResumePracticeTarget | null;
  /** Each repertoire's practice standing (learned, chapters' moves), by id; missing while loading. */
  stats: ReadonlyMap<string, RepertoirePracticeStats>;
  /** A row's ⋯ menu (a builder: each row asks for its own items). */
  actionsFor: (item: RepertoireSummary) => (MenuItem | false)[];
  onStudy: (repertoireId: string) => void;
  onPractice: (item: RepertoireSummary) => void;
  chapters: HubChapterActions;
  empty: ReactNode;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback(
    (id: string) =>
      setExpanded((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    []
  );
  return (
    <>
      <div
        aria-hidden="true"
        className={cn(
          columns,
          "h-9 shrink-0 border-b border-line bg-surface-sunken text-xs font-medium text-fg-muted"
        )}
      >
        <span />
        <span>Repertoire</span>
        <span>Chapters</span>
        <span>Learned</span>
        <span>Last studied</span>
        <span />
      </div>
      {list.isPending ? (
        <RepertoireTableSkeleton label="Loading repertoires" />
      ) : list.isError ? (
        <div className="p-3">
          <Notice
            tone="danger"
            title="Couldn't load your repertoires"
            action={
              <Button type="button" variant="outline" size="xs" onClick={() => void list.refetch()}>
                <RotateCcw />
                Try again
              </Button>
            }
          >
            {ipcErrorMessage(list.error)}
          </Notice>
        </div>
      ) : list.data.length ? (
        <ul aria-labelledby={labelledBy}>
          {colorGroups(list.data)
            .filter((group) => group.items.length)
            .map((group, index) => (
              <Fragment key={group.color}>
                {/* The group's heading (text only, not a repertoire), over the names. */}
                <li
                  role="presentation"
                  className={cn(
                    columns,
                    eyebrow,
                    "h-8 border-b border-line-subtle bg-surface-sunken",
                    index > 0 && "border-t"
                  )}
                >
                  <span />
                  <span className="flex items-center gap-1.5">
                    {COLOR_LABELS[group.color]}
                    <span className="tabular-nums text-fg-subtle">{group.items.length}</span>
                  </span>
                </li>
                {group.items.map((item) => (
                  <RepertoireRow
                    key={item.id}
                    item={item}
                    now={now}
                    stats={stats.get(item.id)}
                    expanded={expanded.has(item.id)}
                    resumeDescription={resume?.repertoireId === item.id ? resume.description : null}
                    actionsFor={actionsFor}
                    onToggle={toggle}
                    onStudy={onStudy}
                    onPractice={onPractice}
                    chapters={chapters}
                  />
                ))}
              </Fragment>
            ))}
        </ul>
      ) : (
        empty
      )}
    </>
  );
}

/** The table's placeholder rows while it loads (and while a hub tab's code loads). */
export function RepertoireTableSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label}>
      {[0, 1, 2].map((index) => (
        <div key={index} className={cn(columns, "h-22 border-b border-line-subtle last:border-0")}>
          <Skeleton className="h-22 w-full rounded-none" />
          <span className="grid gap-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-24" />
          </span>
        </div>
      ))}
    </div>
  );
}

const RepertoireRow = memo(function RepertoireRow({
  item,
  now,
  stats,
  expanded,
  resumeDescription,
  actionsFor,
  onToggle,
  onStudy,
  onPractice,
  chapters
}: {
  item: RepertoireSummary;
  now: number;
  stats: RepertoirePracticeStats | undefined;
  expanded: boolean;
  /** Practice resumes the unfinished session this describes (null: it starts one). */
  resumeDescription: string | null;
  actionsFor: (item: RepertoireSummary) => (MenuItem | false)[];
  onToggle: (repertoireId: string) => void;
  onStudy: (repertoireId: string) => void;
  onPractice: (item: RepertoireSummary) => void;
  chapters: HubChapterActions;
}) {
  const archived = item.archivedAt !== null;
  const actions = useMemo(() => actionsFor(item), [actionsFor, item]);
  const chapterStats = useMemo(
    () => new Map(stats?.chapters.map((chapter) => [chapter.chapterId, chapter])),
    [stats]
  );
  const listId = useId();
  // Imported from a book (linked to it in main; a copy isn't): its badge says so.
  const fromBook = item.bookId !== null;
  return (
    <li className="border-b border-line-subtle last:border-b-transparent">
      <div
        className={cn(
          columns,
          "h-22 transition-colors duration-micro hover:bg-control focus-within:bg-control"
        )}
      >
        <button
          type="button"
          onClick={() => onStudy(item.id)}
          aria-label={`Study ${item.name}`}
          className={cn(
            studyColumns,
            "h-full text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
          )}
        >
          <BoardThumbnail
            fen={item.firstChapterFen ?? START_FEN}
            orientation={item.color}
            className="h-22 w-22 [&>div]:rounded-none"
          />
          <span className="grid min-w-0 gap-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium text-fg">{item.name}</span>
              {fromBook ? <Badge>Book</Badge> : null}
              {archived ? <Badge>Archived</Badge> : null}
            </span>
            {item.tags.length ? (
              <span className="truncate text-xs text-fg-subtle">{item.tags.join(" · ")}</span>
            ) : null}
          </span>
        </button>
        <button
          type="button"
          aria-label={expanded ? "Hide chapters" : "Show chapters"}
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => onToggle(item.id)}
          className={cn(
            cell,
            "-ml-1.5 flex w-fit items-center gap-1 rounded-md px-1.5 py-1 outline-none hover:bg-control-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50"
          )}
        >
          {item.chapterCount}
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "size-3.5 text-fg-subtle transition-transform duration-standard ease-enter",
              expanded && "rotate-90"
            )}
          />
        </button>
        <Learned learned={stats?.learned ?? null} total={item.decisionCount} />
        <span className={cn(cell, "truncate")}>{relativeDay(item.lastStudiedAt, now)}</span>
        <span className="flex items-center justify-end gap-1">
          {archived ? null : (
            <PracticeButton
              item={item}
              resumeDescription={resumeDescription}
              onPractice={onPractice}
            />
          )}
          <OverflowMenu label={`${item.name} actions`} size="icon-xs" items={actions} />
        </span>
      </div>
      {expanded ? (
        <div id={listId}>
          <HubChapterList
            repertoireId={item.id}
            name={item.name}
            chapterCount={item.chapterCount}
            stats={chapterStats}
            onStudyChapter={(chapterId) => chapters.onStudyChapter(item.id, chapterId)}
            onPractiseChapter={(chapterId) => chapters.onPractiseChapter(item.id, chapterId)}
          />
        </div>
      ) : null}
    </li>
  );
});

/** "Learned": a bar and "4 of 7,496" (stage 1 or more); a dash until the numbers load. */
function Learned({ learned, total }: { learned: number | null; total: number }) {
  if (learned === null || !total) return <span className={cn(cell, "text-fg-subtle")}>–</span>;
  return (
    <span className="grid w-full max-w-36 gap-1" title={learnedText(learned, total)}>
      <Progress value={(learned / total) * 100} aria-label={learnedText(learned, total)} />
      <span className="text-2xs text-fg-subtle tabular-nums">
        {learned.toLocaleString()} of {total.toLocaleString()}
      </span>
    </span>
  );
}

/** Practice (due cards first, then new ones), with the due count; Resume for an unfinished session. */
function PracticeButton({
  item,
  resumeDescription,
  onPractice
}: {
  item: RepertoireSummary;
  resumeDescription: string | null;
  onPractice: (item: RepertoireSummary) => void;
}) {
  const resuming = resumeDescription !== null;
  return (
    <Button
      type="button"
      variant={item.dueCount || resuming ? "primary" : "outline"}
      size="xs"
      aria-label={
        resuming
          ? `Resume practising ${item.name}`
          : `Practice ${item.name}${item.dueCount ? `, ${item.dueCount} due` : ""}`
      }
      title={resumeDescription ?? "Due positions first, then new ones"}
      onClick={() => onPractice(item)}
    >
      {resuming ? <Play /> : <GraduationCap />}
      {resuming ? "Resume" : "Practice"}
      {!resuming && item.dueCount ? (
        <span className="inline-grid h-4.5 min-w-5 place-items-center rounded-full bg-accent/20 px-1.5 text-2xs font-semibold tabular-nums">
          {item.dueCount}
        </span>
      ) : null}
    </Button>
  );
}
