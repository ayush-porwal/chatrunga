import type { ReactNode } from "react";
import { BookOpen, Download, GraduationCap, Library, LogIn, Play, Puzzle } from "lucide-react";
import { START_FEN } from "@chaturanga/shared/chess/position";
import type { Color } from "@chaturanga/shared/types/chess";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  resumePracticeTarget,
  type ResumePracticeTarget,
  type StudyTarget
} from "../repertoire/repertoire-chapters";
import { BoardThumbnail } from "../settings/board-thumbnail";
import {
  fillerCaption,
  positionsDue,
  puzzleDetail,
  puzzleTitle,
  repertoireMoveLabel,
  repertoireTitle,
  type RepertoireCardContent
} from "./board-card-text";
import type { InProgressCard as InProgress } from "./in-progress";
import { footButton } from "./play-card-parts";
import { PiecePair } from "./piece-art";

/** Every top-row card's shell: a bordered surface at the row's height. */
const cardShell = "min-w-0 rounded-xl border border-line bg-surface leading-[1.43]";

/**
 * One board card: the position, a tag, a title and a detail, and its action pinned to the bottom.
 * The whole card is its button (the button's area covers it); it lifts a little on hover.
 */
function BoardCard({
  fen,
  orientation,
  lastMove,
  tag,
  title,
  children,
  action
}: {
  fen: string;
  orientation: Color;
  lastMove?: string | null;
  tag: ReactNode;
  title: string;
  /** The detail lines under the title. */
  children: ReactNode;
  action: {
    label: string;
    icon: ReactNode;
    variant: "primary" | "outline";
    onClick: () => void;
  };
}) {
  return (
    <article className={cn(cardShell, "play-bcard group/bcard relative flex flex-col gap-3 p-3")}>
      <BoardThumbnail
        fen={fen}
        orientation={orientation}
        lastMove={lastMove}
        rounded="md"
        className="play-bcard-board shrink-0"
      />
      <div className="grid min-w-0 gap-0.5 px-0.5">
        {tag}
        <b className="truncate text-sm font-semibold text-fg">{title}</b>
        {children}
      </div>
      <Button
        type="button"
        variant={action.variant}
        // The press doesn't scale: the button's ::after covers the card, and a scaled button
        // would shrink it under the pointer mid-click.
        className={cn(
          footButton,
          "mt-auto active:scale-100 after:absolute after:inset-0 after:rounded-xl after:content-['']",
          action.variant === "outline" && "text-fg group-hover/bcard:bg-control"
        )}
        onClick={action.onClick}
      >
        {action.icon}
        {action.label}
      </Button>
    </article>
  );
}

function Tag({
  dot,
  icon,
  children
}: {
  dot?: "accent" | "info";
  icon?: ReactNode;
  children: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-2xs font-medium",
        dot ? "text-fg-muted" : "text-fg-subtle [&>svg]:size-3"
      )}
    >
      {dot ? (
        <i
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full",
            dot === "info"
              ? "bg-info shadow-[0_0_0_3px_rgb(96_165_250/0.2)]"
              : "bg-accent shadow-[0_0_0_3px_rgb(143_182_111/0.2)]"
          )}
        />
      ) : (
        icon
      )}
      {children}
    </span>
  );
}

function Detail({ children }: { children: ReactNode }) {
  return <span className="truncate text-xs text-fg-subtle">{children}</span>;
}

/** The game to get back to: live on Lichess, the engine match on the board, or a saved one. */
export function InProgressBoardCard({
  card,
  onRejoin
}: {
  card: InProgress;
  onRejoin: () => void;
}) {
  return (
    <BoardCard
      fen={card.fen}
      orientation={card.orientation}
      lastMove={card.lastMove}
      tag={<Tag dot={card.live ? "info" : "accent"}>{card.tag}</Tag>}
      title={card.title}
      action={{
        label: "Rejoin",
        icon: <LogIn />,
        variant: "primary",
        onClick: onRejoin
      }}
    >
      <Detail>{card.detail}</Detail>
    </BoardCard>
  );
}

/** Repertoire: the next position due (Review now), else practice to resume, else study to continue. */
export function RepertoireBoardCard({
  content,
  onReview,
  onResume,
  onStudy
}: {
  content: RepertoireCardContent;
  onReview: (repertoireId: string) => void;
  onResume: (target: ResumePracticeTarget) => void;
  onStudy: (target: StudyTarget) => void;
}) {
  const tag = <Tag icon={<Library aria-hidden="true" />}>Repertoire</Tag>;
  if (content.kind === "review") {
    const { next, dueCount, alsoDue } = content;
    const move = repertoireMoveLabel(next.lastMove);
    return (
      <BoardCard
        fen={next.fen}
        orientation={next.color}
        lastMove={next.lastMove?.uci}
        tag={tag}
        title={repertoireTitle(next.repertoireName, next.color)}
        action={{
          label: "Review now",
          icon: <GraduationCap />,
          variant: "outline",
          onClick: () => onReview(next.repertoireId)
        }}
      >
        <span className="truncate text-[0.78125rem] tabular-nums text-fg-muted">
          {move ? (
            <>
              <em className="font-medium not-italic text-fg">{move}</em> — your move
            </>
          ) : (
            "Your move"
          )}
        </span>
        <span
          className="mt-0.5 flex min-w-0 items-center gap-1 text-[0.71875rem] text-fg-subtle"
          aria-label={
            alsoDue
              ? `${positionsDue(dueCount)}, ${alsoDue.dueCount} in ${alsoDue.name}`
              : positionsDue(dueCount)
          }
        >
          <span className="inline-grid h-4.5 min-w-5 place-items-center rounded-full bg-accent/15 px-1.25 text-2xs font-semibold tabular-nums text-accent-fg">
            {dueCount}
          </span>
          <span className="shrink-0">{dueCount === 1 ? "position due" : "positions due"}</span>
          {alsoDue ? (
            <>
              <span
                aria-hidden="true"
                className="mx-1 size-0.75 shrink-0 rounded-full bg-line-strong"
              />
              <span className="truncate">
                <span className="tabular-nums">{alsoDue.dueCount}</span> in {alsoDue.name}
              </span>
            </>
          ) : null}
        </span>
      </BoardCard>
    );
  }
  if (content.kind === "resume") {
    const { resume, fen } = content;
    return (
      <BoardCard
        fen={fen ?? START_FEN}
        orientation={resume.color}
        tag={tag}
        title={repertoireTitle(resume.repertoireName, resume.color)}
        action={{
          label: "Resume practice",
          icon: <Play />,
          variant: "outline",
          onClick: () => {
            const target = resumePracticeTarget({ resume });
            if (target) onResume(target);
          }
        }}
      >
        <Detail>Practice session in progress</Detail>
      </BoardCard>
    );
  }
  const { target } = content;
  return (
    <BoardCard
      fen={target.fen}
      orientation={target.color}
      tag={tag}
      title={repertoireTitle(target.repertoireName, target.color)}
      action={{
        label: "Continue study",
        icon: <BookOpen />,
        variant: "outline",
        onClick: () =>
          onStudy({
            repertoireId: target.repertoireId,
            chapterId: target.chapterId,
            nodeId: target.nodeId
          })
      }}
    >
      <Detail>{target.chapterTitle}</Detail>
    </BoardCard>
  );
}

/** Puzzle of the day: the position from the solver's side, with the move that set it up. */
export function PuzzleOfTheDayCard({
  puzzle,
  onSolve
}: {
  puzzle: PuzzleSample;
  onSolve: (puzzle: PuzzleSample) => void;
}) {
  const detail = puzzleDetail(puzzle);
  return (
    <BoardCard
      fen={puzzle.initialFen}
      orientation={puzzle.sideToMove}
      lastMove={puzzle.opponentMove}
      tag={<Tag icon={<Puzzle aria-hidden="true" />}>Puzzle of the day</Tag>}
      title={puzzleTitle(puzzle)}
      action={{
        label: "Solve puzzle",
        icon: <Puzzle />,
        variant: "outline",
        onClick: () => onSolve(puzzle)
      }}
    >
      <Detail>{detail ?? puzzle.sourceName}</Detail>
    </BoardCard>
  );
}

/**
 * The columns nothing else takes: a white and a black knight facing each other, and what would show
 * there (fillerCaption). The knights scale down with the card (one column in a small window).
 */
export function FillerCard({
  span,
  firstRun,
  puzzleDatabase,
  onOpenDatabases
}: {
  span: number;
  firstRun: boolean;
  puzzleDatabase: boolean;
  onOpenDatabases: () => void;
}) {
  const caption = fillerCaption({ firstRun, puzzleDatabase });
  return (
    <div
      className={cn(
        cardShell,
        "flex items-center justify-center px-6 py-4 [container-type:inline-size]"
      )}
      style={{ gridColumn: `span ${span}` }}
    >
      <div className="flex flex-col items-center gap-3.5 text-center">
        <PiecePair piece="knight" pieceClassName="size-[min(8.25rem,44cqw)]" gapClassName="gap-2" />
        <span className="max-w-64 text-balance text-[0.9375rem] font-medium tracking-[-0.005em] text-fg-secondary">
          {caption.text}
        </span>
        {caption.downloadPuzzles ? (
          <Button type="button" variant="ghost" size="xs" onClick={onOpenDatabases}>
            <Download />
            Download
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** A board card's footprint while the page's first data arrives. */
export function BoardCardSkeleton() {
  return (
    <div className={cn(cardShell, "flex flex-col gap-3 p-3")}>
      <Skeleton className="aspect-square w-full rounded-md" />
      <div className="grid gap-2 px-0.5 py-0.5">
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="mt-auto h-8.5 w-full rounded-lg" />
    </div>
  );
}

/** The Play card's footprint while the page's first data arrives. */
export function PlayCardSkeleton() {
  return (
    <div className={cn(cardShell, "flex flex-col gap-4 p-4")}>
      <div className="flex flex-1 items-center justify-center gap-8">
        <Skeleton className="size-24 rounded-[22px]" />
        <Skeleton className="size-24 rounded-[22px]" />
      </div>
      <Skeleton className="h-27 w-full rounded-xl" />
      <Skeleton className="h-8.5 w-full rounded-lg" />
    </div>
  );
}
