import { Fragment, memo, useCallback, useId, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, GraduationCap, Play, RotateCcw } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { RepertoireSummary } from "@chaturanga/shared/types/repertoire";
import type { RepertoirePracticeStats } from "@chaturanga/shared/types/repertoire-practice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { OverflowMenu, type MenuItem } from "@/components/ui/menu";
import { Notice } from "@/components/ui/notice";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { cn } from "@/lib/utils";
import { colorGroups, learnedText } from "./hub-groups";
import { HubChapterList } from "./HubChapterList";
import { COLOR_LABELS, relativeDay, type ResumePracticeTarget } from "./repertoire-chapters";

/**
 * One grid for the header and the rows: the name (after the chapters expander), chapters, learned,
 * last studied, then the row's actions.
 */
const columns =
  "grid grid-cols-[minmax(0,2fr)_minmax(0,0.6fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(9.5rem,auto)] gap-x-4 pr-3 pl-2 [&>*:nth-child(n+2)]:justify-self-start";

/** A repertoire row's chapters, opened in the hub (Study at a chapter, or practise it). */
export type HubChapterActions = {
  onStudyChapter: (repertoireId: string, chapterId: string) => void;
  onPractiseChapter: (repertoireId: string, chapterId: string) => void;
};

/**
 * The hub's table (laid out as Play's Recent games), in White and Black groups (a colour without
 * repertoires has none): the name with an expander listing the chapters by opening family,
 * chapters, learned (stage 1 or more) of your moves, and last studied. The whole row opens Study;
 * Practice (with the due count) and the ⋯ menu sit at its end, always visible. Rows are memoised:
 * give them stable `actionsFor`, `onStudy`, `onPractice` and `chapters`.
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
          "h-9 shrink-0 items-center border-b border-line bg-surface-sunken text-xs font-medium text-fg-muted"
        )}
      >
        {/* Past the expander, over the names. */}
        <span className="pl-8">Repertoire</span>
        <span>Chapters</span>
        <span>Learned</span>
        <span>Last studied</span>
        <span />
      </div>
      {list.isPending ? (
        <div aria-busy="true" aria-label="Loading repertoires">
          {[0, 1, 2].map((index) => (
            <SkeletonRow key={index} />
          ))}
        </div>
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
          {colorGroups(list.data).map((group) =>
            group.items.length ? (
              <Fragment key={group.color}>
                {/* The group's heading: text only, not a repertoire of the list. */}
                <li
                  role="presentation"
                  className="flex h-8 items-center border-b border-line-subtle bg-surface-sunken px-4 text-xs font-medium text-fg-muted"
                >
                  {COLOR_LABELS[group.color]} · {group.items.length}
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
            ) : null
          )}
        </ul>
      ) : (
        empty
      )}
    </>
  );
}

function SkeletonRow() {
  return (
    <div className={cn(columns, "h-14 items-center border-b border-line-subtle last:border-0")}>
      <span className="grid gap-2 pl-8">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-3 w-24" />
      </span>
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
    <li className="border-b border-line-subtle last:rounded-b-[11px] last:border-b-transparent">
      <div
        className={cn(
          columns,
          // Hover fills the row edge to edge; the last row's corners are the table's. A row with its
          // ⋯ menu open is lifted over the rows below it.
          "group/row relative h-14 items-center transition-colors duration-micro hover:bg-control focus-within:bg-control has-[[aria-haspopup][aria-expanded=true]]:z-20"
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <IconButton
            label={expanded ? "Hide chapters" : "Show chapters"}
            icon={expanded ? <ChevronDown /> : <ChevronRight />}
            size="icon-xs"
            className="relative z-10 shrink-0"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => onToggle(item.id)}
          />
          {/* The row's own action: the button covers the whole row (other controls sit above it). */}
          <button
            type="button"
            onClick={() => onStudy(item.id)}
            aria-label={`Study ${item.name}`}
            className="grid min-w-0 content-center gap-0.5 text-left outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-accent/50"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium text-fg">{item.name}</span>
              {fromBook ? <Badge>Book</Badge> : null}
              {archived ? <Badge>Archived</Badge> : null}
            </span>
            {item.tags.length ? (
              <span className="truncate text-xs text-fg-subtle">{item.tags.join(" · ")}</span>
            ) : null}
          </button>
        </span>
        <span className="text-xs text-fg-secondary tabular-nums">{item.chapterCount}</span>
        <Learned learned={stats?.learned ?? null} total={item.decisionCount} />
        <span className="truncate text-xs text-fg-muted">
          {relativeDay(item.lastStudiedAt, now)}
        </span>
        <span className="relative z-10 flex items-center justify-end gap-1 justify-self-end">
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
  if (learned === null || !total) return <span className="text-xs text-fg-subtle">–</span>;
  return (
    <span className="grid w-full max-w-36 gap-1" title={learnedText(learned, total)}>
      <Progress value={(learned / total) * 100} aria-label={learnedText(learned, total)} />
      <span className="text-2xs text-fg-muted tabular-nums">
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
        <span className="rounded-full bg-accent/20 px-1.5 text-2xs font-semibold tabular-nums">
          {item.dueCount}
        </span>
      ) : null}
    </Button>
  );
}
