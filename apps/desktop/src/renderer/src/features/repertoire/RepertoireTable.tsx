import { memo, useMemo, type ReactNode } from "react";
import { GraduationCap, Play, RotateCcw } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import { START_FEN } from "@chaturanga/shared/chess/position";
import type { RepertoireSummary } from "@chaturanga/shared/types/repertoire";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OverflowMenu, type MenuItem } from "@/components/ui/menu";
import { Notice } from "@/components/ui/notice";
import { SideDot } from "@/components/ui/side-dot";
import { Skeleton } from "@/components/ui/skeleton";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { cn } from "@/lib/utils";
import { BoardThumbnail } from "../settings/board-thumbnail";
import { COLOR_LABELS, relativeDay, type ResumePracticeTarget } from "./repertoire-chapters";

/** One grid for the header and the rows: thumbnail, name, five facts, then the row's actions. */
const columns =
  "grid grid-cols-[5.5rem_minmax(0,1.8fr)_repeat(5,minmax(0,1fr))_minmax(9.5rem,auto)] gap-x-4 pr-3 [&>*:nth-child(n+3)]:justify-self-start";

/**
 * The hub's table (laid out as Play's Recent games): a board thumbnail (the first chapter's
 * starting position, facing the repertoire's side), the name, colour,
 * chapters, positions (trainable decisions), due count and last studied. The whole row opens
 * Study; Practice (with the due count) and the ⋯ menu sit at its end, always visible. Rows are
 * memoised: give them stable `actionsFor`, `onStudy` and `onPractice`.
 */
export function RepertoireTable({
  list,
  now,
  labelledBy,
  resume,
  actionsFor,
  onStudy,
  onPractice,
  empty
}: {
  list: UseQueryResult<RepertoireSummary[]>;
  /** When the hub opened: "Last studied" is relative to it. */
  now: number;
  /** The card title's id (the list is named by it). */
  labelledBy: string;
  /** The unfinished session its row's Practice resumes instead of starting a new one. */
  resume: ResumePracticeTarget | null;
  /** A row's ⋯ menu (a builder: each row asks for its own items). */
  actionsFor: (item: RepertoireSummary) => (MenuItem | false)[];
  onStudy: (repertoireId: string) => void;
  onPractice: (item: RepertoireSummary) => void;
  empty: ReactNode;
}) {
  return (
    <>
      <div
        aria-hidden="true"
        className={cn(
          columns,
          "h-9 shrink-0 items-center border-y border-b-line border-t-line-subtle bg-surface-sunken text-xs font-medium text-fg-muted"
        )}
      >
        <span />
        <span>Repertoire</span>
        <span>Colour</span>
        <span>Chapters</span>
        <span>Positions</span>
        <span>Due</span>
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
          {list.data.map((item) => (
            <RepertoireRow
              key={item.id}
              item={item}
              now={now}
              resumeDescription={resume?.repertoireId === item.id ? resume.description : null}
              actionsFor={actionsFor}
              onStudy={onStudy}
              onPractice={onPractice}
            />
          ))}
        </ul>
      ) : (
        empty
      )}
    </>
  );
}

function SkeletonRow() {
  return (
    <div className={cn(columns, "h-22 items-center border-b border-line-subtle last:border-0")}>
      <Skeleton className="size-full rounded-none" />
      <span className="grid gap-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-3 w-24" />
      </span>
    </div>
  );
}

const RepertoireRow = memo(function RepertoireRow({
  item,
  now,
  resumeDescription,
  actionsFor,
  onStudy,
  onPractice
}: {
  item: RepertoireSummary;
  now: number;
  /** Practice resumes the unfinished session this describes (null: it starts one). */
  resumeDescription: string | null;
  actionsFor: (item: RepertoireSummary) => (MenuItem | false)[];
  onStudy: (repertoireId: string) => void;
  onPractice: (item: RepertoireSummary) => void;
}) {
  const archived = item.archivedAt !== null;
  const actions = useMemo(() => actionsFor(item), [actionsFor, item]);
  return (
    <li
      className={cn(
        columns,
        // Hover fills the row edge to edge; the last row's corners are the table's. A row with its
        // ⋯ menu open is lifted over the rows below it.
        "group/row relative h-22 items-center border-b border-line-subtle transition-colors duration-micro last:rounded-b-[11px] last:border-b-transparent hover:bg-control focus-within:bg-control has-[[aria-expanded=true]]:z-20"
      )}
    >
      <div className="relative h-full overflow-hidden group-last/row:rounded-bl-[11px]">
        <BoardThumbnail
          fen={item.firstChapterFen ?? START_FEN}
          orientation={item.color}
          className="h-full w-auto [&>div]:rounded-none"
        />
      </div>
      {/* The row's own action: the button covers the whole row (other controls sit above it). */}
      <button
        type="button"
        onClick={() => onStudy(item.id)}
        aria-label={`Study ${item.name}`}
        className="grid min-w-0 content-center gap-1 text-left outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-accent/50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-fg">{item.name}</span>
          {archived ? <Badge>Archived</Badge> : null}
        </span>
        {item.tags.length ? (
          <span className="truncate text-xs text-fg-subtle">{item.tags.join(" · ")}</span>
        ) : null}
      </button>
      <span className="flex items-center gap-1.5 text-xs text-fg-secondary">
        <SideDot color={item.color} />
        {COLOR_LABELS[item.color]}
      </span>
      <Fact value={item.chapterCount} />
      <Fact value={item.decisionCount} />
      <span className="text-xs tabular-nums">
        {item.dueCount ? (
          <span className="font-semibold text-accent">{item.dueCount}</span>
        ) : (
          <span className="text-fg-subtle">–</span>
        )}
      </span>
      <span className="truncate text-xs text-fg-muted">{relativeDay(item.lastStudiedAt, now)}</span>
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
    </li>
  );
});

function Fact({ value }: { value: number }) {
  return <span className="text-xs text-fg-secondary tabular-nums">{value}</span>;
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
